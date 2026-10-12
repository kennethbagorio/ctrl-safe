/**
 * Evaluation harness (stretch goal) — runs the bot over evals/dataset.json
 * and records an experiment in LangSmith with four scores per question:
 *
 *   correctness   LLM-as-judge: does the answer match the reference? (0/1)
 *   groundedness  LLM-as-judge: is every claim supported by retrieved text? (0/1)
 *   citations     has at least one [p. N] citation when retrieval was used (0/1)
 *   tool_use      retrieval happened iff the dataset expected it (0/1)
 *
 * Run: npm run eval
 * Needs LANGSMITH_API_KEY (and LANGSMITH_ENDPOINT if your workspace is
 * outside the US region) in .env.local.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFile } from "node:fs/promises";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { generateText } from "ai";
import { answerQuestion, chatModel } from "../lib/rag";
import type { Source } from "../lib/vector";

const DATASET = process.env.LANGSMITH_DATASET ?? "ctrl-safe-eval";

type Example = { question: string; expect_retrieval: boolean; reference: string };
type KV = Record<string, unknown>;
type EvalArgs = { inputs: KV; outputs: KV; referenceOutputs?: KV };

async function ensureDataset(client: Client, examples: Example[]) {
  if (await client.hasDataset({ datasetName: DATASET })) return;
  const ds = await client.createDataset(DATASET, {
    description: "CTRL+SAFE demo questions with reference answers",
  });
  await client.createExamples(
    examples.map((e) => ({
      dataset_id: ds.id,
      inputs: { question: e.question },
      outputs: { reference: e.reference, expect_retrieval: e.expect_retrieval },
    }))
  );
  console.log(`Created dataset "${DATASET}" with ${examples.length} examples`);
}

/** Ask the chat model to judge; returns 1 for YES, 0 otherwise. */
async function judge(prompt: string): Promise<{ score: number; comment: string }> {
  const { text } = await generateText({
    model: chatModel(),
    system:
      "You are a strict evaluator. Answer with exactly one line: 'YES: <reason>' or 'NO: <reason>'.",
    prompt,
  });
  const yes = /^\s*YES/i.test(text);
  return { score: yes ? 1 : 0, comment: text.trim().slice(0, 300) };
}

async function main() {
  if (!process.env.LANGSMITH_API_KEY) throw new Error("Missing LANGSMITH_API_KEY");
  const examples: Example[] = JSON.parse(
    await readFile("evals/dataset.json", "utf8")
  );
  const client = new Client();
  await ensureDataset(client, examples);

  // evaluate() traces each call of the target as a run in the experiment.
  const target = async (inputs: KV): Promise<KV> =>
    answerQuestion(String(inputs.question));

  const results = await evaluate(target, {
    data: DATASET,
    client,
    experimentPrefix: "ctrl-safe",
    maxConcurrency: 2,
    metadata: {
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      topK: process.env.RAG_TOP_K ?? "5",
    },
    evaluators: [
      async ({ inputs, outputs, referenceOutputs }: EvalArgs) => {
        const r = await judge(
          `Question: ${inputs.question}\n\nReference answer: ${referenceOutputs?.reference}\n\nBot answer: ${outputs.answer}\n\nDoes the bot answer convey the same substance as the reference (allowing different wording)?`
        );
        return { key: "correctness", ...r };
      },
      async ({ outputs }: EvalArgs) => {
        if (!outputs.usedRetrieval) {
          return { key: "groundedness", score: 1, comment: "no retrieval — n/a" };
        }
        const context = (outputs.sources as Source[])
          .map((s) => `[${s.section} · p. ${s.page}] ${s.snippet}`)
          .join("\n\n");
        const r = await judge(
          `Retrieved passages:\n${context}\n\nBot answer: ${outputs.answer}\n\nIs every factual claim in the bot answer supported by the retrieved passages, with no invented details or page numbers?`
        );
        return { key: "groundedness", ...r };
      },
      ({ outputs }: EvalArgs) => {
        if (!outputs.usedRetrieval) return { key: "citations", score: 1, comment: "no retrieval — n/a" };
        const has = /\[(?:[A-Za-z0-9 .-]{1,24}[, ]+)?p\.?\s?\d+/.test(String(outputs.answer));
        return { key: "citations", score: has ? 1 : 0, comment: has ? "has [p. N]" : "no page citation" };
      },
      ({ outputs, referenceOutputs }: EvalArgs) => {
        const expected = Boolean(referenceOutputs?.expect_retrieval);
        const ok = outputs.usedRetrieval === expected;
        return {
          key: "tool_use",
          score: ok ? 1 : 0,
          comment: `expected retrieval=${expected}, got=${outputs.usedRetrieval}`,
        };
      },
    ],
  });

  // Console summary
  const totals: Record<string, { sum: number; n: number }> = {};
  for (const row of results.results) {
    for (const ev of row.evaluationResults.results) {
      const t = (totals[ev.key] ??= { sum: 0, n: 0 });
      t.sum += Number(ev.score ?? 0);
      t.n += 1;
    }
  }
  console.log("\nExperiment:", results.experimentName);
  for (const [k, t] of Object.entries(totals)) {
    console.log(`  ${k.padEnd(13)} ${Math.round((100 * t.sum) / t.n)}%  (${t.sum}/${t.n})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
