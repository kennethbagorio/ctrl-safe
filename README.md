# CTRL+SAFE — Can I share this to AI?

A public RAG chatbot for working professionals who are about to paste something into an AI tool and want to know what the risks are first. Answers are grounded in two authoritative documents and every answer carries page-level citations.

Built for the AIM Postgraduate Certificate in Generative & Agentic AI — Week 14 Graded Mini Project 14.3 ("Ship Your Own RAG").

- **Live app:** https://ctrl-safe-zeta.vercel.app/
- **Stack:** Next.js 15 · Vercel AI SDK 5 · OpenAI-compatible chat + embedding models (gpt-4o-mini, text-embedding-3-small) · Upstash Vector · Tailwind 4 · LangSmith (evaluation)

## Corpus and attribution

| Document | Publisher | Date | Pages | Why it's here |
| --- | --- | --- | --- | --- |
| NIST AI 600-1, *Artificial Intelligence Risk Management Framework: Generative AI Profile* | US National Institute of Standards and Technology | July 2024 | 64 | The "why": twelve generative-AI risk categories and suggested actions. US government work, public domain. |
| *Guidance on privacy and the use of commercially available AI products* | Office of the Australian Information Commissioner (OAIC) | October 2024 | 38 (printed) | The "what to do": practical privacy guidance for organisations using AI products, including publicly available chatbots. Published by the OAIC under its website licence (Creative Commons Attribution); reused here with attribution. |

NIST describes the risks; OAIC gives the practical guidance. Together they answer "can I share this?" better than either alone.

## How it works

1. `scripts/seed.ts` extracts text from every PDF in `data/` page by page, splits it into section-aware chunks, embeds them with `text-embedding-3-small`, and upserts them to Upstash Vector with `source`, `page`, `section` and `text` metadata.
2. `app/api/chat/route.ts` streams a response with `streamText`. Retrieval is a **tool call** (`searchCorpus`, defined once in `lib/rag.ts`): the model decides when to search. Greetings, small talk and questions about the bot itself skip retrieval.
3. The UI (`app/page.tsx`) renders the streamed answer with inline citations like `[OAIC p. 5]`, and a Sources panel listing document, section and page for every retrieved chunk — click a row to read the passage.

## Chunking choices

- **Page-aware:** a chunk never crosses a page boundary, so every citation has an exact page.
- **Section-aware:** numbered headings ("2.4. Data Privacy") and the AI RMF rows in NIST's Suggested Actions table ("MEASURE 2.13") are detected and stored as metadata, so sources read as *section · page* rather than a bare chunk id. 67 sections are detected in NIST alone.
- **Size:** ~1,200 characters (~300 tokens) with a one-sentence overlap. Smaller chunks cut mid-argument; larger ones dilute retrieval on dense policy prose.
- **topK = 5** (`RAG_TOP_K`): enough to cover a risk plus its suggested actions. Known trade-off: "list all twelve risks" questions can come back incomplete because the enumerating chunk competes with chunks about individual risks (see Evaluation).

Run `npm run seed:dry` to preview chunks and sections without uploading.

## Evaluation harness (stretch goal)

`npm run eval` runs the bot over the 12 questions in `evals/dataset.json` and records an experiment in LangSmith with four scores per question:

| Score | How it's measured |
| --- | --- |
| `correctness` | LLM-as-judge against a reference answer |
| `groundedness` | LLM-as-judge: every claim supported by the retrieved passages, no invented pages |
| `citations` | Regex: at least one `[DOC p. N]` citation when retrieval was used |
| `tool_use` | Retrieval happened if and only if the dataset expected it (greetings and off-topic questions must skip it) |

The harness calls the same `lib/rag.ts` the chat route uses, so it measures the deployed bot, not a copy.

Results from two experiments on the same dataset:

| Experiment | correctness | groundedness | citations | tool_use |
| --- | --- | --- | --- | --- |
| Baseline prompt | 83% | 100% | 58% | 92% |
| After standardising the citation format to `[NIST p. N]` / `[OAIC p. N]` | 83% | 83% | 92% | 100% |

The citation fix was the main finding: with two documents in the corpus the model varied its citation style, which the UI could not highlight. The two remaining correctness misses are the "list all twelve risks" question (retrieval returns chunks about individual risks ahead of the chunk that enumerates them) and the deliberately off-corpus EU AI Act question. Groundedness and correctness are judged by an LLM on 12 examples, so single-run differences of one or two points are within judge variance.

## Multi-PDF support (stretch goal)

Drop another PDF into `data/` and run `npm run seed:reset`. Each chunk carries its source document; the Sources panel names the document whenever an answer draws on more than one, and the system prompt tells the model to cite by document.

## Run locally

```bash
git clone <your-repo-url> ctrl-safe
cd ctrl-safe
npm install
cp .env.example .env.local   # fill in the values
npm run seed                 # one-time: embed and index the PDFs (seed:reset to re-index)
npm run dev                  # http://localhost:3000
```

### Environment variables

| Name | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Chat and embedding key (OpenAI or an OpenAI-compatible proxy) |
| `OPENAI_BASE_URL` | API base URL, e.g. `https://api.openai.com/v1` or your proxy |
| `OPENAI_MODEL` | Defaults to `gpt-4o-mini` |
| `EMBEDDING_MODEL` | Defaults to `text-embedding-3-small` (1536 dims) |
| `UPSTASH_VECTOR_REST_URL` | From the Upstash console |
| `UPSTASH_VECTOR_REST_TOKEN` | From the Upstash console |
| `RAG_TOP_K` | Chunks per search, default 5 |
| `LANGSMITH_API_KEY` | Only for `npm run eval` |
| `LANGSMITH_ENDPOINT` | Only for `npm run eval`, and only if your LangSmith workspace is outside the US region |

Create the Upstash index as **Custom · 1536 dimensions · Cosine** — the app embeds text itself and sends vectors.

All secrets are read server-side only (`lib/vector.ts`, `lib/rag.ts`, `app/api/chat/route.ts`). Nothing is prefixed `NEXT_PUBLIC_`, and `.env*` files are git-ignored.

## Deploy to Vercel

1. Push to GitHub.
2. Import the repo in Vercel.
3. Add the environment variables above (the LangSmith ones are not needed on the server).
4. Deploy, then test in an incognito window.

Seeding runs locally, not on Vercel — the index persists in Upstash.

## Demo questions

1. Can I paste a client contract into ChatGPT to summarise it?
2. What does the OAIC recommend about entering personal information into public AI chatbots?
3. What does NIST say about data privacy risks in generative AI?
4. What is confabulation and how should teams manage it?
5. What should an organisation do before adopting a commercially available AI product?
6. What are the EU AI Act penalty tiers? _(not in the corpus — the bot should say so)_
7. Hi! _(no retrieval should happen)_

## Project structure

```
app/            Next.js app: page.tsx (chat UI), api/chat/route.ts (streaming + tool call)
lib/rag.ts      System prompt, retrieval tool, model factory, non-streaming answerQuestion()
lib/vector.ts   Upstash client, embeddings, searchCorpus()
scripts/        seed.ts (index PDFs), eval.ts (LangSmith harness), test-search.ts
evals/          dataset.json — eval questions with reference answers
data/           Source PDFs
```

Guidance from these documents is not legal advice. Check your organisation's own AI use policy before sharing data.
