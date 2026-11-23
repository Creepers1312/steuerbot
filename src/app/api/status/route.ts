import { NextResponse } from "next/server";
import { authKonfig } from "@/lib/sicherheit/sitzung";

export const dynamic = "force-dynamic";

/** Ob KI-Funktionen (Chat, Belegerkennung) verfügbar sind – ohne den Schlüssel preiszugeben. */
export function GET() {
  return NextResponse.json({
    ki: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    anmeldung: authKonfig().aktiv,
  });
}
