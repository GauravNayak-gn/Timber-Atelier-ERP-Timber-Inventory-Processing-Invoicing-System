import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import ZAI from "z-ai-web-dev-sdk";
import {
  TOOL_SELECTION_SYSTEM_PROMPT,
  SYNTHESIS_SYSTEM_PROMPT,
  FALLBACK_NO_TOOL_ANSWER,
} from "@/lib/ai/prompts";
import { executeTool, AVAILABLE_TOOLS, type ToolName, type ToolCall } from "@/lib/ai/tools";

export const maxDuration = 120;

const bodySchema = z.object({
  query: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(12)
    .optional(),
});

function extractJson(raw: string): ToolCall | null {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (parsed && typeof parsed === "object" && "tool" in parsed) {
      const tool = parsed.tool as ToolName;
      if (AVAILABLE_TOOLS.includes(tool)) {
        // LLMs sometimes flatten arguments at the top level
        // (e.g. {"tool":"trace_backward","query":"INV-0001"}) — merge them.
        const { tool: _t, arguments: nested, ...rest } = parsed as Record<string, unknown>;
        const args =
          nested && typeof nested === "object" && Object.keys(nested).length > 0
            ? nested
            : rest;
        return { tool, arguments: args as ToolCall["arguments"] };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "query is required (1-2000 chars)" }, { status: 400 });
  }

  const { query, history } = parsed.data;

  let zai: Awaited<ReturnType<typeof ZAI.create>>;
  try {
    zai = await ZAI.create();
  } catch (err) {
    console.error("AI SDK init failed:", err);
    return NextResponse.json(
      { answer: FALLBACK_NO_TOOL_ANSWER, toolsUsed: [] },
      { status: 200 }
    );
  }

  const toolsUsed: string[] = [];
  let toolData: Record<string, unknown> | null = null;

  // ── Phase 1: tool routing ──
  try {
    const routing = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: TOOL_SELECTION_SYSTEM_PROMPT },
        ...(history ?? []).slice(-6).map((h) => ({ role: h.role, content: h.content })),
        { role: "user", content: query },
      ],
      thinking: { type: "disabled" },
    });

    const rawChoice = routing.choices[0]?.message?.content ?? "";
    const call = extractJson(rawChoice);
    if (call && call.tool !== "none") {
      toolsUsed.push(call.tool);
      toolData = await executeTool(call.tool, call.arguments);
    }
  } catch (err) {
    console.error("AI routing phase failed:", err);
    return NextResponse.json({ answer: FALLBACK_NO_TOOL_ANSWER, toolsUsed }, { status: 200 });
  }

  // ── Phase 2: synthesis with tool data ──
  try {
    const synthesisMessages: { role: "user" | "assistant"; content: string }[] = [
      { role: "assistant", content: SYNTHESIS_SYSTEM_PROMPT },
    ];
    if (toolData) {
      synthesisMessages.push({
        role: "user",
        content: `User question: ${query}\n\nTOOL_DATA (authoritative, JSON):\n${JSON.stringify(toolData)}`,
      });
    } else {
      synthesisMessages.push({
        role: "user",
        content: `User question: ${query}\n\n(No tool was used. Answer generally — explain capabilities, never invent operational data. If the user asks for live data, invite them to retry or use the dashboard.)`,
      });
    }

    const final = await zai.chat.completions.create({
      messages: synthesisMessages,
      thinking: { type: "disabled" },
    });

    const answer = final.choices[0]?.message?.content?.trim();
    return NextResponse.json({
      answer: answer || FALLBACK_NO_TOOL_ANSWER,
      toolsUsed,
    });
  } catch (err) {
    console.error("AI synthesis phase failed:", err);
    // Graceful degradation: if a tool ran, return a compact deterministic digest.
    if (toolData) {
      return NextResponse.json({
        answer: `Here is the verified data I retrieved:\n\n\`\`\`json\n${JSON.stringify(toolData, null, 2).slice(0, 2400)}\n\`\`\``,
        toolsUsed,
      });
    }
    return NextResponse.json({ answer: FALLBACK_NO_TOOL_ANSWER, toolsUsed }, { status: 200 });
  }
}
