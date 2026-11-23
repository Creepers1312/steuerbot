#!/usr/bin/env node
/**
 * Erzeugt einen Eintrag für STEUERBOT_BENUTZER.
 *   node scripts/passwort-hash.mjs anna
 * Das Passwort wird verdeckt abgefragt (oder per Umgebungsvariable PASSWORT übergeben).
 */
import { randomBytes, scrypt } from "node:crypto";
import { createInterface } from "node:readline";

const name = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[a-z0-9._-]{1,64}$/.test(name)) {
  console.error("Aufruf: node scripts/passwort-hash.mjs <benutzername>   (a–z, 0–9, . _ -)");
  process.exit(1);
}

async function frage(text) {
  if (process.env.PASSWORT) return process.env.PASSWORT;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => rl.output.write(s.includes(text) ? s : "*");
  const antwort = await new Promise((r) => rl.question(text, r));
  rl.close();
  process.stdout.write("\n");
  return antwort;
}

const pw = await frage("Passwort (mind. 12 Zeichen): ");
if (pw.length < 12) {
  console.error("Passwort zu kurz – bitte mindestens 12 Zeichen (BSI empfiehlt lange Passphrasen).");
  process.exit(1);
}
if (!process.env.PASSWORT && pw !== (await frage("Wiederholen: "))) {
  console.error("Passwörter stimmen nicht überein.");
  process.exit(1);
}

const N = 2 ** 15, r = 8, p = 1;
const salt = randomBytes(16);
const hash = await new Promise((res, rej) =>
  scrypt(pw.normalize("NFC"), salt, 32, { N, r, p, maxmem: 128 * N * r * 2 }, (e, k) => (e ? rej(e) : res(k))),
);
console.log(`${name}=scrypt.${N}.${r}.${p}.${salt.toString("base64url")}.${hash.toString("base64url")}`);
