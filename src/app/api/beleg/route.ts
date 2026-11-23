import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { belegAuslesen } from "@/lib/assistant/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

const ERLAUBT = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"] as const;
type Erlaubt = (typeof ERLAUBT)[number];
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("datei");
  if (!(file instanceof File)) return NextResponse.json({ error: "Keine Datei" }, { status: 400 });
  if (!ERLAUBT.includes(file.type as Erlaubt)) {
    return NextResponse.json({ error: "Nur JPG, PNG, WebP, GIF oder PDF" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Datei zu groß (max. 15 MB)" }, { status: 400 });

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  try {
    const beleg = await belegAuslesen(data, file.type as Erlaubt);
    return NextResponse.json({ beleg });
  } catch (error) {
    const msg =
      error instanceof Anthropic.AuthenticationError
        ? "Claude-API-Schlüssel fehlt oder ist ungültig."
        : error instanceof Anthropic.APIError
          ? `Claude-API-Fehler (${error.status ?? "?"})`
          : error instanceof Error
            ? error.message
            : "Unbekannter Fehler";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
