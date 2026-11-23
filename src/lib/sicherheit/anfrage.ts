import "server-only";
import { NextResponse } from "next/server";
import { clientIp, erlaubt } from "./ratelimit";
import { SITZUNGS_COOKIE, authKonfig, gueltigeSitzung } from "./sitzung";

/** Kennung für Rate-Limits: angemeldeter Benutzer, sonst IP. */
export async function anfrageKennung(req: Request): Promise<string> {
  const konf = authKonfig();
  if (konf.aktiv) {
    const cookie = req.headers.get("cookie") ?? "";
    const token = cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${SITZUNGS_COOKIE}=`))
      ?.slice(SITZUNGS_COOKIE.length + 1);
    const s = await gueltigeSitzung(token, konf);
    if (s) return `u:${s.u}`;
  }
  return `ip:${clientIp(req)}`;
}

/** Prüft Rate-Limit; liefert eine 429-Antwort oder null. */
export async function rateLimit(req: Request, bereich: string, max: number, fensterMs: number): Promise<NextResponse | null> {
  const r = erlaubt(`${bereich}:${await anfrageKennung(req)}`, max, fensterMs);
  if (r.ok) return null;
  return NextResponse.json(
    { error: `Zu viele Anfragen – bitte in ${Math.ceil(r.wartenSek / 60)} Minute(n) erneut versuchen.` },
    { status: 429, headers: { "Retry-After": String(r.wartenSek) } },
  );
}

/** Lehnt zu große Anfragen ab, bevor sie gelesen werden. */
export function groesseOk(req: Request, maxBytes: number): boolean {
  const laenge = Number(req.headers.get("content-length") ?? "0");
  return Number.isFinite(laenge) && laenge <= maxBytes;
}

/** Dateityp anhand der ersten Bytes prüfen (nicht nur dem angegebenen MIME-Typ vertrauen). */
export function dateitypAusInhalt(b: Uint8Array): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "application/pdf" | null {
  const s = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && s(1, 3) === "PNG") return "image/png";
  if (s(0, 4) === "GIF8") return "image/gif";
  if (s(0, 4) === "RIFF" && s(8, 4) === "WEBP") return "image/webp";
  if (s(0, 5) === "%PDF-") return "application/pdf";
  return null;
}
