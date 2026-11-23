import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { chatTurn, type ChatEvent } from "@/lib/assistant/claude";
import { parseTaxInput } from "@/lib/tax/schema";

export const runtime = "nodejs";
// Vercel Hobby erlaubt bis zu 60 s pro Anfrage; bei Pro kann der Wert erhöht werden
export const maxDuration = 60;

const BodySchema = z.object({
  message: z.string().min(1).max(4_000),
  history: z.array(z.any()).max(400).default([]),
  input: z.unknown(),
});

export async function POST(req: Request) {
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });

  let input;
  try {
    input = parseTaxInput(body.data.input);
  } catch {
    return NextResponse.json({ error: "Ungültiger Datenstand" }, { status: 400 });
  }

  const history = body.data.history as Anthropic.Beta.BetaMessageParam[];
  const message = body.data.message;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: ChatEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await chatTurn(history, message, input, emit);
      } catch (error) {
        emit({ type: "error", error: describeError(error) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "Claude-API-Schlüssel fehlt oder ist ungültig (ANTHROPIC_API_KEY).";
  if (error instanceof Anthropic.RateLimitError) return "Zu viele Anfragen – bitte kurz warten.";
  if (error instanceof Anthropic.BadRequestError) return `Anfrage abgelehnt: ${error.message}`;
  if (error instanceof Anthropic.APIError) return `Claude-API-Fehler (${error.status ?? "?"})`;
  if (error instanceof Error && /api key|apiKey|authentication/i.test(error.message)) {
    return "Claude-API-Schlüssel fehlt (ANTHROPIC_API_KEY in .env.local setzen).";
  }
  return "Unerwarteter Fehler beim Assistenten.";
}
