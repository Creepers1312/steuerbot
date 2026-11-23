import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Für den Container-Healthcheck – ohne Anmeldung, ohne Details. */
export function GET() {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
