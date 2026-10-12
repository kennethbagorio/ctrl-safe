/**
 * Shared RAG definition: system prompt + retrieval tool + model factory.
 * Used by the streaming chat route (app/api/chat/route.ts) and by the
 * evaluation harness (scripts/eval.ts) so both run the exact same bot.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { searchCorpus, type Source } from "@/lib/vector";

export const SYSTEM_PROMPT = `You are CTRL+SAFE, an assistant that helps working professionals decide whether it is safe to share information with generative AI tools, and understand generative AI risks more broadly.

Your only knowledge source is the document corpus available through the searchCorpus tool. It contains two documents: NIST AI 600-1 (the Generative AI Risk Management Profile, July 2024), which describes generative AI risks and suggested actions; and the OAIC "Guidance on privacy and the use of commercially available AI products" (Australia, October 2024), which gives practical privacy guidance including that organisations should not enter personal or sensitive information into publicly available generative AI tools. When a question is about whether to share something, draw on both: OAIC for the practical guidance, NIST for the underlying risks. You answer from retrieved passages only.

Rules:
1. For any substantive question about AI risk, data privacy, confidentiality, sharing data with AI, bias, confabulation/hallucination, security, intellectual property, content provenance, or responsible AI use: call the searchCorpus tool FIRST, then answer from what it returns.
2. Do NOT call the tool for greetings, thanks, small talk, or questions about what you are or how to use you. Answer those directly in one or two sentences.
3. GGround every claim in the retrieved passages. Cite inline after the claim using exactly this format: [NIST p. 14] or [OAIC p. 5] — square brackets, document name, then page. Never invent page numbers.
4. If the retrieved passages do not support an answer, say plainly that the corpus does not cover it, and do not guess or fall back on general knowledge.
5. When someone asks "can I share X with AI", frame the answer as the risks identified and the suggested actions, not as a yes/no verdict. Suggest they check their organisation's own policy.
6. Be concise and practical. Short paragraphs. Use a bulleted list only when listing distinct risks or actions.`;

export const TOOL_DESCRIPTION =
  "Semantic search over the CTRL+SAFE corpus: NIST AI 600-1 (Generative AI Risk Management Profile) plus any added guidance documents. Call this for ANY substantive question about AI risks, data privacy, sharing information with AI tools, confidentiality, bias, confabulation, security, IP, or responsible AI practices. Returns the most relevant passages with document, section and page. Do NOT call for greetings, small talk, or questions about the assistant itself.";

export function chatModel() {
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL, // Vocareum proxy or https://api.openai.com/v1
  });
  // .chat() forces the Chat Completions endpoint, which proxies support.
  return openai.chat(process.env.OPENAI_MODEL ?? "gpt-4o-mini");
}

export function ragTools() {
  return {
    searchCorpus: tool({
      description: TOOL_DESCRIPTION,
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "A focused search query in plain English, e.g. 'risks of sharing confidential data with generative AI'"
          ),
      }),
      execute: async ({ query }) => {
        const sources = await searchCorpus(query);
        return { query, sources };
      },
    }),
  };
}

export const MAX_STEPS = 3; // tool call -> answer; prevents runaway loops

export type RagAnswer = {
  answer: string;
  sources: Source[];
  usedRetrieval: boolean;
};

/** Non-streaming run of the bot, used by the evaluation harness. */
export async function answerQuestion(question: string): Promise<RagAnswer> {
  const messages: ModelMessage[] = [{ role: "user", content: question }];
  const result = await generateText({
    model: chatModel(),
    system: SYSTEM_PROMPT,
    messages,
    tools: ragTools(),
    stopWhen: stepCountIs(MAX_STEPS),
  });

  const sources: Source[] = [];
  for (const step of result.steps) {
    for (const tr of step.toolResults) {
      if (tr.toolName === "searchCorpus") {
        sources.push(...(tr.output as { sources: Source[] }).sources);
      }
    }
  }
  return { answer: result.text, sources, usedRetrieval: sources.length > 0 };
}
