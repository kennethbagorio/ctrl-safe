"use client";

import { useChat } from "@ai-sdk/react";
import type { UIDataTypes, UIMessage } from "ai";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Source } from "@/lib/vector";

const SUGGESTED = [
  "Can I paste a client contract into ChatGPT to summarise it?",
  "What does NIST say about data privacy risks in generative AI?",
  "What is confabulation and how should teams manage it?",
  "Is it safe to share internal meeting notes with an AI assistant?",
];

type ChatTools = {
  searchCorpus: {
    input: { query: string };
    output: { query: string; sources: Source[] };
  };
};
type ChatMessage = UIMessage<unknown, UIDataTypes, ChatTools>;
type SearchPart = Extract<ChatMessage["parts"][number], { type: "tool-searchCorpus" }>;

function isSearchPart(part: ChatMessage["parts"][number]): part is SearchPart {
  return part.type === "tool-searchCorpus";
}

export default function Home() {
  const { messages, sendMessage, status, error } = useChat<ChatMessage>();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  function ask(text: string) {
    if (busy) return;
    sendMessage({ text });
  }

  return (
    <div className="flex h-full min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-6 px-4 py-3">
          <span className="font-mono text-base font-semibold tracking-tight text-text">
            CTRL
            <span className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">+</span>
            SAFE
          </span>
          <span className="whitespace-nowrap text-sm text-muted">Can I share this to AI?</span>
          <span className="ml-auto hidden truncate text-right text-xs text-muted lg:inline">
            Grounded in NIST AI 600-1 and the AU OAIC Guidance
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-32 pt-6">
        {messages.length === 0 ? (
          <EmptyState onPick={ask} />
        ) : (
          <div className="space-y-6">
            {messages.map((m) => (
              <Message key={m.id} message={m} />
            ))}
            {status === "submitted" && <Thinking label="Reading your question" />}
            {error && (
              <div className="rounded-md border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                Something went wrong: {error.message}. Check the server logs and
                environment variables, then try again.
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </main>

      <form
        onSubmit={submit}
        className="fixed inset-x-0 bottom-0 border-t border-line bg-bg-deep/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 py-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) submit(e);
            }}
            rows={1}
            placeholder="Ask whether something is safe to share with an AI tool…"
            className="min-h-[44px] max-h-40 flex-1 resize-none rounded-md border border-line bg-surface px-3 py-2.5 text-[15px] leading-6 text-text placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="h-[44px] rounded-md bg-gradient-to-r from-accent to-accent-2 px-5 text-sm font-semibold text-accent-ink shadow-[0_0_24px_rgba(95,196,255,0.35)] transition hover:brightness-110 disabled:opacity-60 disabled:shadow-none"
          >
            Ask
          </button>
        </div>
      </form>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <section className="pt-10">
      <h1 className="font-mono text-4xl font-semibold tracking-tight sm:text-5xl">
        CTRL
        <span className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">+</span>
        SAFE
      </h1>
      <p className="mt-3 text-xl text-text">Can I share this to AI?</p>
      <p className="mt-4 max-w-xl leading-7 text-muted">
        Ask about sharing documents, data, or conversations with AI tools.
      </p>

      <p className="mt-10 text-sm text-muted">Try one of these</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {SUGGESTED.map((q) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            className="rounded-md border border-line bg-surface px-4 py-3 text-left text-sm leading-6 text-text hover:border-accent hover:bg-surface-2 focus:border-accent focus:outline-none"
          >
            {q}
          </button>
        ))}
      </div>

      <p className="mt-10 text-xs text-muted">
        Covers risks, not rules. For a yes/no decision, check your
        organisation&apos;s AI use policy.
      </p>
    </section>
  );
}

function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-user px-4 py-2.5 text-[15px] leading-6">
          {text}
        </div>
      </div>
    );
  }

  const searchParts = message.parts.filter(isSearchPart);
  const textParts = message.parts.filter((p) => p.type === "text") as {
    type: "text";
    text: string;
  }[];
  const text = textParts.map((p) => p.text).join("");
  const searching = searchParts.some((p) => p.state !== "output-available");
  const sources = searchParts.flatMap((p) =>
    p.state === "output-available" ? p.output.sources : []
  );

  return (
    <div className="border-l-2 border-accent/60 pl-4">
      {searching && <Thinking label="Searching NIST AI 600-1" />}
      {text && (
        <div className="answer text-[15px] leading-7 text-text">
          {renderAnswer(text)}
        </div>
      )}
      {sources.length > 0 && <Sources sources={sources} />}
    </div>
  );
}

function prettyName(file: string) {
  return file.replace(/\.pdf$/i, "").replace(/_+/g, " ").trim();
}

function Sources({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const docs = Array.from(new Set(sources.map((s) => prettyName(s.source))));
  const multi = docs.length > 1;
  return (
    <div className="mt-4 rounded-md border border-line bg-surface/60">
      <div className="flex items-baseline justify-between gap-3 px-3 py-2">
        <span className="text-sm font-medium text-text">Sources</span>
        <span className="truncate text-xs text-muted">{docs.join(" · ")}</span>
      </div>
      <ul className="divide-y divide-line">
        {sources.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => setOpen(open === s.id ? null : s.id)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2"
              aria-expanded={open === s.id}
            >
              <span className="min-w-0 truncate text-text">
                {s.section}
                {multi && (
                  <span className="ml-2 text-xs text-muted">{prettyName(s.source)}</span>
                )}
              </span>
              <span className="shrink-0 font-mono text-xs text-accent">
                p. {s.page}
              </span>
            </button>
            {open === s.id && (
              <p className="border-t border-line/60 px-3 py-2 text-[13px] leading-6 text-muted">
                {s.snippet}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Thinking({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-sm text-muted">
      <span>{label}</span>
      <span className="flex gap-1">
        <span className="dot h-1.5 w-1.5 rounded-full bg-accent" />
        <span className="dot h-1.5 w-1.5 rounded-full bg-accent" />
        <span className="dot h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
    </div>
  );
}

/* Tiny renderer: paragraphs, "- " bullets, **bold**, and [p. N] citations. */
function renderAnswer(text: string) {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, bi) => {
    const lines = block.split("\n");
    const isList = lines.every((l) => /^\s*[-*•]\s+/.test(l) || !l.trim());
    if (isList) {
      return (
        <ul key={bi}>
          {lines
            .filter((l) => l.trim())
            .map((l, li) => (
              <li key={li}>{inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>
            ))}
        </ul>
      );
    }
    return <p key={bi}>{inline(lines.join(" "))}</p>;
  });
}

function inline(s: string) {
  const CITE = /(\*\*[^*]+\*\*|\[(?:[A-Za-z0-9 .-]{1,24}[, ]+)?p\.?\s?\d+(?:[–-]\d+)?\])/g;
  const tokens = s.split(CITE);
  return tokens.map((t, i) => {
    if (/^\*\*[^*]+\*\*$/.test(t)) return <strong key={i}>{t.slice(2, -2)}</strong>;
    if (/^\[.*p\.?\s?\d+.*\]$/.test(t)) return <span key={i} className="cite">{t}</span>;
    return <span key={i}>{t}</span>;
  });
}