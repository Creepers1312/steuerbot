import { NextResponse } from "next/server";
import { z } from "zod";
import { benutzerListe, dummyHash, pruefePasswort } from "@/lib/sicherheit/passwort";
import { anzahl, clientIp, erlaubt, ipGekuerzt, protokoll, zuruecksetzen } from "@/lib/sicherheit/ratelimit";
import { SITZUNGS_COOKIE, authKonfig, fingerabdruck, signiereSitzung } from "@/lib/sicherheit/sitzung";

export const runtime = "nodejs";

const Body = z.object({ benutzer: z.string().min(1).max(64), passwort: z.string().min(1).max(256) });

const FEHLVERSUCHE_MAX = 5;
const FENSTER_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  const konf = authKonfig();
  if (!konf.aktiv) return NextResponse.json({ error: "Anmeldung ist nicht aktiviert." }, { status: 400 });

  const ip = clientIp(req);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  const benutzer = body.data.benutzer.trim().toLowerCase();

  // Sperre nach zu vielen Fehlversuchen – je IP und je Benutzerkonto
  const kIp = `login-ip:${ip}`;
  const kUser = `login-user:${benutzer}`;
  if (anzahl(kIp, FENSTER_MS) >= FEHLVERSUCHE_MAX * 4 || anzahl(kUser, FENSTER_MS) >= FEHLVERSUCHE_MAX) {
    protokoll("login_gesperrt", { benutzer, ip: ipGekuerzt(ip) });
    return NextResponse.json({ error: "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen." }, { status: 429 });
  }

  const hash = benutzerListe().get(benutzer);
  const ok = await pruefePasswort(body.data.passwort, hash ?? (await dummyHash()));
  if (!hash || !ok) {
    erlaubt(kIp, Number.MAX_SAFE_INTEGER, FENSTER_MS);
    erlaubt(kUser, Number.MAX_SAFE_INTEGER, FENSTER_MS);
    protokoll("login_fehlgeschlagen", { benutzer, ip: ipGekuerzt(ip) });
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
    return NextResponse.json({ error: "Benutzername oder Passwort falsch." }, { status: 401 });
  }

  zuruecksetzen(kUser);
  const jetzt = Math.floor(Date.now() / 1000);
  const token = await signiereSitzung(
    { u: benutzer, iat: jetzt, exp: jetzt + konf.sitzungStunden * 3600, h: fingerabdruck(hash) },
    konf.geheimnis,
  );
  protokoll("login_erfolgreich", { benutzer, ip: ipGekuerzt(ip) });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SITZUNGS_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: konf.sitzungStunden * 3600,
  });
  return res;
}
