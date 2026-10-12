/**
 * Seed the Upstash Vector index from every PDF in ./data.
 *
 * Chunking strategy (intentional, see README):
 *  - Page-aware: a chunk never crosses a page boundary, so every chunk
 *    carries an exact page number for citations.
 *  - Section-aware: NIST AI 600-1 uses numbered headings ("2.4. Data
 *    Privacy"). We track the most recent heading and attach it as
 *    metadata so the sources panel reads as "2.4 Data Privacy · p. 14".
 *  - Size: ~1,200 characters per chunk (~300 tokens) with a one-sentence
 *    overlap. Policy prose is dense; smaller chunks cut the sentence
 *    that answers the question, larger ones dilute retrieval.
 *
 * Run: npm run seed          (npm run seed:dry previews chunks without uploading)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { extractText } from "unpdf";
import { getIndex, embedTexts, type ChunkMetadata } from "../lib/vector";

const DATA_DIR = path.join(process.cwd(), "data");
const MAX_CHARS = 1200;
const BATCH = 50;

// Matches "2.4. Data Privacy", "3. Suggested Actions", "Appendix B. References"
const HEADING = /^(?:\d+(?:\.\d+)*\.\s+|Appendix\s+[A-Z]\.?\s+)([A-Z][^\n:]{2,60})$/;
// Matches the AI RMF subcategory rows in the Suggested Actions table,
// e.g. "MEASURE 2.13: Effectiveness of ..." (optionally preceded by a page number)
const SUBCATEGORY = /^(?:\d+\s+)?((?:GOVERN|MAP|MEASURE|MANAGE)\s+\d+\.\d+):/;

function cleanPage(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/-\n(?=[a-z])/g, "") // re-join hyphenated line breaks
    .trim();
}

function findSection(line: string): string | null {
  const t = line.trim();
  if (/https?:\/\//.test(t)) return null; // footnotes with URLs
  const sub = t.match(SUBCATEGORY);
  if (sub) return sub[1];
  const m = t.match(HEADING);
  if (!m) return null;
  return t.replace(/^\d+\s+/, "").replace(/\s+/g, " ");
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(["'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type Chunk = ChunkMetadata & { id: string };

function chunkPage(
  source: string,
  pageNo: number,
  pageText: string,
  state: { section: string; counter: number }
): Chunk[] {
  const chunks: Chunk[] = [];
  const paragraphs = pageText.split(/\n\s*\n/);

  let buffer = "";
  let bufferSection = state.section;

  const flush = () => {
    const text = buffer.trim();
    if (text.length < 80) {
      buffer = "";
      return;
    }
    state.counter += 1;
    chunks.push({
      id: `${slug(source)}-p${pageNo}-c${state.counter}`,
      source,
      page: pageNo,
      section: bufferSection,
      text,
    });
    // One-sentence overlap into the next chunk.
    const sentences = splitSentences(text);
    buffer = sentences.length > 1 ? sentences[sentences.length - 1] + " " : "";
  };

  for (const para of paragraphs) {
    const lines = para.split("\n");
    for (const line of lines) {
      const heading = findSection(line);
      if (heading) {
        // New section: close the current chunk so sections stay clean.
        flush();
        state.section = heading;
        bufferSection = heading;
        continue;
      }
      const piece = line.trim();
      if (!piece) continue;
      if ((buffer + piece).length > MAX_CHARS) {
        flush();
        bufferSection = state.section;
      }
      buffer += piece + " ";
    }
    buffer += "\n";
  }
  flush();
  return chunks;
}

/** "NIST_AI_600-1.pdf" -> "NIST AI 600-1" */
function prettyName(file: string) {
  return file.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim();
}

function slug(s: string) {
  return s.toLowerCase().replace(/\.pdf$/, "").replace(/[^a-z0-9]+/g, "-");
}

async function main() {
  const files = (await readdir(DATA_DIR)).filter((f) =>
    f.toLowerCase().endsWith(".pdf")
  );
  if (files.length === 0) throw new Error(`No PDFs found in ${DATA_DIR}`);

  const dry = process.argv.includes("--dry"); // preview chunks, no upload
  const index = dry ? null : getIndex();
  const reset = !dry && process.argv.includes("--reset");
  if (reset) {
    console.log("Resetting index…");
    await index!.reset();
  }

  for (const file of files) {
    const buf = await readFile(path.join(DATA_DIR, file));
    const { totalPages, text } = await extractText(new Uint8Array(buf), {
      mergePages: false,
    });
    console.log(`${file}: ${totalPages} pages`);

    const state = { section: prettyName(file), counter: 0 }; // until the first heading
    const all: Chunk[] = [];
    text.forEach((raw, i) => {
      const page = cleanPage(raw);
      if (!page) return;
      all.push(...chunkPage(file, i + 1, page, state));
    });
    console.log(`  → ${all.length} chunks`);

    if (dry) {
      const sections = new Set(all.map((c) => c.section));
      console.log(`  sections detected: ${sections.size}`);
      for (const c of all.slice(0, 400).filter((_, i) => i % 25 === 0)) {
        console.log(`  [${c.id}] ${c.section} — ${c.text.slice(0, 90).replace(/\n/g, " ")}…`);
      }
      continue;
    }

    for (let i = 0; i < all.length; i += BATCH) {
      const slice = all.slice(i, i + BATCH);
      const vectors = await embedTexts(slice.map((c) => c.text));
      const batch = slice.map(({ id, ...meta }, j) => ({
        id,
        vector: vectors[j],
        metadata: meta,
      }));
      await index!.upsert(batch);
      console.log(`  upserted ${Math.min(i + BATCH, all.length)}/${all.length}`);
    }
  }

  if (index) {
    const info = await index.info();
    console.log(`Done. Index now has ${info.vectorCount} vectors.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
