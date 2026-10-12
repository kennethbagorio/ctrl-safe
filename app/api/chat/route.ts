import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { chatModel, MAX_STEPS, ragTools, SYSTEM_PROMPT } from "@/lib/rag";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: chatModel(),
    system: SYSTEM_PROMPT,
    messages: convertToModelMessages(messages),
    tools: ragTools(),
    stopWhen: stepCountIs(MAX_STEPS),
  });

  return result.toUIMessageStreamResponse();
}
