import "server-only";
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Passwort-Hashes mit scrypt (speicherhart).
 * Format: scrypt.<N>.<r>.<p>.<salt base64url>.<hash base64url> – ohne „$“, damit .env/Compose nichts ersetzt.
 */
const N = 2 ** 15;
const R = 8;
const P = 1;
const LAENGE = 32;

function scryptAsync(pw: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((res, rej) => scrypt(pw, salt, LAENGE, opts, (e, k) => (e ? rej(e) : res(k))));
}

export async function hashePasswort(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pw.normalize("NFC"), salt, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return ["scrypt", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join(".");
}

export async function pruefePasswort(pw: string, gespeichert: string): Promise<boolean> {
  const teile = gespeichert.split(".");
  if (teile.length !== 6 || teile[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = teile;
  const soll = Buffer.from(hashB64, "base64url");
  const ist = await scryptAsync(pw.normalize("NFC"), Buffer.from(saltB64, "base64url"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return ist.length === soll.length && timingSafeEqual(ist, soll);
}

/** STEUERBOT_BENUTZER="anna=scrypt.…,ben=scrypt.…" */
export function benutzerListe(): Map<string, string> {
  const m = new Map<string, string>();
  for (const eintrag of (process.env.STEUERBOT_BENUTZER ?? "").split(",")) {
    const i = eintrag.indexOf("=");
    if (i <= 0) continue;
    m.set(eintrag.slice(0, i).trim().toLowerCase(), eintrag.slice(i + 1).trim());
  }
  return m;
}

/** Ein fester Dummy-Hash, damit unbekannte Benutzer gleich lange brauchen (kein Benutzer-Raten über die Antwortzeit). */
let dummy: Promise<string> | undefined;
export function dummyHash() {
  dummy ??= hashePasswort(randomBytes(12).toString("hex"));
  return dummy;
}
