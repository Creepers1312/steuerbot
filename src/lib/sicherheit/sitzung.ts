/**
 * Signierte Sitzungs-Token (HMAC-SHA-256) – läuft in der Edge-Middleware und in Node.
 * Format: base64url(JSON-Nutzdaten) "." base64url(HMAC)
 */

export const SITZUNGS_COOKIE = "steuerbot_sitzung";

export interface Sitzung {
  /** Benutzername */
  u: string;
  /** Ablauf (Unix-Sekunden) */
  exp: number;
  /** Ausgestellt (Unix-Sekunden) */
  iat: number;
  /** Fingerabdruck des Passwort-Hashes – ändert sich das Passwort oder wird der Benutzer entfernt, endet die Sitzung */
  h?: string;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function vonB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function schluessel(geheimnis: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(geheimnis), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signiereSitzung(s: Sitzung, geheimnis: string): Promise<string> {
  const nutz = b64url(enc.encode(JSON.stringify(s)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await schluessel(geheimnis), enc.encode(nutz)));
  return `${nutz}.${b64url(sig)}`;
}

/** Prüft Signatur (zeitkonstant über WebCrypto verify) und Ablauf. */
export async function pruefeSitzung(token: string | undefined, geheimnis: string): Promise<Sitzung | null> {
  if (!token || token.length > 2048) return null;
  const [nutz, sig, rest] = token.split(".");
  if (!nutz || !sig || rest !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await schluessel(geheimnis), vonB64url(sig) as BufferSource, enc.encode(nutz));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(vonB64url(nutz))) as Sitzung;
    if (typeof s.u !== "string" || typeof s.exp !== "number" || s.exp * 1000 < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export interface AuthKonfig {
  /** Anmeldung erforderlich */
  aktiv: boolean;
  /** Produktion ohne gültige Konfiguration → Zugriff sperren */
  fehlkonfiguriert: boolean;
  geheimnis: string;
  sitzungStunden: number;
  /** Benutzername → Fingerabdruck des aktuellen Passwort-Hashes */
  fingerabdruecke: Map<string, string>;
}

/** Kurzer Fingerabdruck eines gespeicherten Hashes (letzte 16 Zeichen – nicht umkehrbar, kein Rückschluss aufs Passwort). */
export const fingerabdruck = (hash: string) => hash.slice(-16);

/** Liest die Anmelde-Konfiguration aus der Umgebung (sicherer Standard: in Produktion Pflicht). */
export function authKonfig(): AuthKonfig {
  const benutzer = (process.env.STEUERBOT_BENUTZER ?? "").trim();
  const geheimnis = process.env.STEUERBOT_SESSION_SECRET ?? "";
  const aus = process.env.STEUERBOT_AUTH === "aus";
  const produktion = process.env.NODE_ENV === "production";
  const sitzungStunden = Math.min(24, Math.max(1, Number(process.env.STEUERBOT_SITZUNG_STUNDEN) || 8));
  const fingerabdruecke = new Map<string, string>();
  for (const eintrag of benutzer.split(",")) {
    const i = eintrag.indexOf("=");
    if (i > 0) fingerabdruecke.set(eintrag.slice(0, i).trim().toLowerCase(), fingerabdruck(eintrag.slice(i + 1).trim()));
  }
  const konfiguriert = fingerabdruecke.size > 0 && geheimnis.length >= 32;
  const basis = { geheimnis, sitzungStunden, fingerabdruecke };
  if (aus) return { ...basis, aktiv: false, fehlkonfiguriert: false };
  if (konfiguriert) return { ...basis, aktiv: true, fehlkonfiguriert: false };
  // Entwicklung ohne Konfiguration: offen; Produktion ohne Konfiguration: gesperrt
  return { ...basis, aktiv: false, fehlkonfiguriert: produktion };
}

/** Sitzung gilt nur, wenn Signatur, Ablauf UND der aktuelle Passwort-Stand des Benutzers passen. */
export async function gueltigeSitzung(token: string | undefined, konf: AuthKonfig): Promise<Sitzung | null> {
  const s = await pruefeSitzung(token, konf.geheimnis);
  if (!s) return null;
  const fp = konf.fingerabdruecke.get(s.u);
  return fp && s.h === fp ? s : null;
}
