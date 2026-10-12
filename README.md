# CTRL+SAFE — Can I share this to AI?

A public RAG chatbot that answers "is it safe to share this with an AI tool?" questions, grounded in **NIST AI 600-1** (Artificial Intelligence Risk Management Framework: Generative AI Profile, July 2024) with page-level citations.

Built for AIM PG Cert in Generative & Agentic AI — Week 14 Mini Project 14.3.

- **Live:** _add your Vercel URL_
- **Stack:** Next.js 15 · Vercel AI SDK 5 · OpenAI-compatible chat + embedding models (gpt-4o-mini, text-embedding-3-small) · Upstash Vector · Tailwind 4 · LangSmith (evaluation)

## How it works

1. `scripts/seed.ts` extracts text from every PDF in `data/` page by page, splits it into section-aware chunks, embeds them with `text-embedding-3-small`, and upserts them to Upstash Vector.
2. `/api/chat` streams a response with `streamText`. Retrieval is a **tool call** (`searchCorpus`, defined once in `lib/rag.ts`): the model decides when to search. Greetings and meta-questions skip retrieval.
3. The UI renders the streamed answer, inline `[p. N]` citations, and a Sources panel listing section + page for every retrieved chunk.

## Corpus and chunking choices

- **Corpus:** NIST AI 600-1, 64 pages. Chosen because it is authoritative, public, and directly addresses data privacy, confabulation, information security, and IP risks of generative AI — the questions people actually ask before pasting something into a chatbot.
- **Page-aware chunks:** chunks never cross a page boundary, so every citation has an exact page.
- **Section-aware:** numbered headings ("2.4. Data Privacy") are detected and stored as metadata, so sources read as *section · page* instead of a bare chunk id.
- **Size:** ~1,200 characters (~300 tokens) with a one-sentence overlap. Smaller chunks cut mid-argument; larger ones dilute retrieval on a dense policy document.
- **topK = 5** (`RAG_TOP_K`), enough to cover a risk plus its suggested actions without flooding the context.

## Run locally

```bash
git clone <your-repo-url> ctrl-safe
cd ctrl-safe
npm install
cp .env.example .env.local   # fill in the values
npm run seed                 # one-time: index the PDF (use seed:reset to re-index)
npm run dev                  # http://localhost:3000
```

### Environment variables

| Name | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Chat model key (OpenAI or Vocareum proxy) |
| `OPENAI_BASE_URL` | API base URL, e.g. Vocareum proxy URL or `https://api.openai.com/v1` |
| `OPENAI_MODEL` | Defaults to `gpt-4o-mini` |
| `UPSTASH_VECTOR_REST_URL` | From the Upstash console |
| `UPSTASH_VECTOR_REST_TOKEN` | From the Upstash console |
| `EMBEDDING_MODEL` | Defaults to `text-embedding-3-small` (1536 dims) |
| `RAG_TOP_K` | Chunks per search, default 5 |
| `LANGSMITH_API_KEY` | Only for `npm run eval` |
| `LANGSMITH_ENDPOINT` | Only if your LangSmith workspace is outside the US region |

Create the Upstash index as **Custom · 1536 dimensions · Cosine** — the app embeds text itself and sends vectors.

All secrets stay server-side: they are read only in `app/api/chat/route.ts` and `lib/vector.ts`. Nothing is prefixed `NEXT_PUBLIC_`.

## Deploy to Vercel

1. Push to GitHub.
2. Import the repo in Vercel.
3. Add the environment variables above (Production + Preview).
4. Deploy, then test in an incognito window.

Seeding runs locally, not on Vercel — the index persists in Upstash.

## Demo questions

1. Can I paste a client contract into ChatGPT to summarise it?
2. What does NIST say about data privacy risks in generative AI?
3. What is confabulation and how should teams manage it?
4. What are the suggested actions for information security?
5. What are the EU AI Act penalty tiers? _(not in corpus — the bot should say so)_
6. Hi! _(no retrieval should happen)_

## Evaluation harness (stretch goal)

`npm run eval` runs the bot over the 10 questions in `evals/dataset.json` and records an experiment in LangSmith with four scores per question:

| Score | How |
| --- | --- |
| `correctness` | LLM-as-judge against a reference answer |
| `groundedness` | LLM-as-judge: every claim supported by the retrieved passages, no invented pages |
| `citations` | Regex: at least one `[p. N]` when retrieval was used |
| `tool_use` | Retrieval happened if and only if the dataset expected it (greetings and off-topic skip it) |

The harness calls the same `lib/rag.ts` the chat route uses, so the experiment measures the deployed bot, not a copy. Add `LANGSMITH_API_KEY` to `.env.local`, then run it; the dataset is created on first run.

## Multi-PDF support (stretch goal)

Drop any additional PDF into `data/` and run `npm run seed:reset`. Each chunk carries its source document, so the Sources panel shows the document name whenever an answer draws on more than one, and the model names the document on first citation.

## Other polish

- Suggested-prompt chips on the empty state
- Mobile-friendly layout (safe-area insets, single-column, sticky composer)
