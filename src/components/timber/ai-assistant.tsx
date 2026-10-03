"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { CircleAlert, SendHorizontal, Sparkles, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api } from "@/lib/api-client";
import type { AiQueryResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
  error?: boolean;
}

const SUGGESTIONS = [
  "What is my current teak stock?",
  "Trace invoice INV-0001 back to its supplier",
  "How much money is outstanding and who owes it?",
  "How much do I owe suppliers in total?",
  "What is my overall waste percentage?",
  "Which products are low on stock?",
];

export function AiAssistant({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [messages, setMessages] = React.useState<ChatMsg[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const { toast } = useToast();
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || sending) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setSending(true);
    try {
      // Guard against hung dev-server recompiles: abort after 90s.
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 90_000);
      let res: Awaited<ReturnType<typeof api.aiQuery>>;
      try {
        res = await api.aiQuery({ query: text, history }, controller.signal);
      } finally {
        window.clearTimeout(timer);
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.answer, toolsUsed: res.toolsUsed ?? [] },
      ]);
    } catch (e) {
      const msg =
        e instanceof DOMException && e.name === "AbortError"
          ? "The assistant took too long to respond. Please try again."
          : e instanceof Error
            ? e.message
            : "The assistant is unavailable right now.";
      setMessages((prev) => [...prev, { role: "assistant", content: msg, error: true }]);
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        toast({
          title: "AI assistant unavailable",
          description: msg,
          variant: "destructive",
        });
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        aria-describedby={undefined}
      >
        <SheetHeader className="border-b border-border/70 p-4 text-left">
          <SheetTitle className="flex items-center gap-2 font-display text-base">
            <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </span>
            Atelier Assistant
          </SheetTitle>
          <SheetDescription>
            Ask about stock, lots, waste or invoices — grounded in your live ERP data.
          </SheetDescription>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
              <span className="grid size-14 place-items-center rounded-2xl bg-secondary text-muted-foreground">
                <Sparkles className="size-6" />
              </span>
              <div className="space-y-1.5">
                <p className="font-display text-base">How can I help the workshop?</p>
                <p className="max-w-[260px] text-sm text-muted-foreground">
                  Try one of these, or ask anything about your timber operations.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-accent-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((m, i) => (
                <MessageBubble key={i} msg={m} />
              ))}
              {sending && <TypingDots />}
            </div>
          )}
        </div>

        <Separator />

        <form
          className="flex items-center gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about stock, lots, invoices…"
            aria-label="Ask the AI assistant"
            disabled={sending}
          />
          <Button type="submit" size="icon" aria-label="Send message" disabled={sending || !input.trim()}>
            <SendHorizontal className="size-4" />
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function MessageBubble({ msg }: { msg: ChatMsg }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm text-primary-foreground shadow-sm">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex justify-start"
    >
      <div className="max-w-[90%] space-y-2">
        <div
          className={cn(
            "rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm shadow-sm",
            msg.error
              ? "border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
              : "border border-border/70 bg-secondary/80 text-secondary-foreground"
          )}
        >
          {msg.error && (
            <span className="mb-1 flex items-center gap-1.5 text-xs font-medium">
              <CircleAlert className="size-3.5" /> Assistant unavailable
            </span>
          )}
          <p className="whitespace-pre-wrap">{msg.content}</p>
        </div>
        {!msg.error && msg.toolsUsed && msg.toolsUsed.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pl-1">
            {msg.toolsUsed.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
              >
                <Wrench className="size-3" />
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function TypingDots() {
  return (
    <div className="flex justify-start" aria-label="Assistant is typing">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-border/70 bg-secondary/80 px-4 py-3 shadow-sm">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-muted-foreground/70"
            animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
            transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.15, ease: "easeInOut" }}
          />
        ))}
      </div>
    </div>
  );
}
