import { describe, expect, it, vi } from "vitest";
import { dateitypAusInhalt } from "./anfrage";
import { hashePasswort, pruefePasswort } from "./passwort";
import { erlaubt, ipGekuerzt } from "./ratelimit";
import { authKonfig, pruefeSitzung, signiereSitzung } from "./sitzung";

const GEHEIM = "x".repeat(40);
const jetzt = () => Math.floor(Date.now() / 1000);

describe("Sitzungs-Token", () => {
  it("gültiges Token wird akzeptiert", async () => {
    const t = await signiereSitzung({ u: "anna", iat: jetzt(), exp: jetzt() + 60 }, GEHEIM);
    expect((await pruefeSitzung(t, GEHEIM))?.u).toBe("anna");
  });
  it("manipuliertes, abgelaufenes oder fremd signiertes Token wird abgelehnt", async () => {
    const t = await signiereSitzung({ u: "anna", iat: jetzt(), exp: jetzt() + 60 }, GEHEIM);
    const [nutz, sig] = t.split(".");
    const gefaelscht = Buffer.from(JSON.stringify({ u: "admin", iat: jetzt(), exp: jetzt() + 60 })).toString("base64url");
    expect(await pruefeSitzung(`${gefaelscht}.${sig}`, GEHEIM)).toBeNull();
    expect(await pruefeSitzung(`${nutz}.${sig}x`, GEHEIM)).toBeNull();
    expect(await pruefeSitzung(t, "y".repeat(40))).toBeNull();
    const alt = await signiereSitzung({ u: "anna", iat: jetzt() - 100, exp: jetzt() - 1 }, GEHEIM);
    expect(await pruefeSitzung(alt, GEHEIM)).toBeNull();
    expect(await pruefeSitzung(undefined, GEHEIM)).toBeNull();
    expect(await pruefeSitzung("a.b.c", GEHEIM)).toBeNull();
  });
});

describe("Passwort-Hash", () => {
  it("prüft richtig und falsch, Hash enthält kein $", async () => {
    const h = await hashePasswort("korrekt-pferd-batterie");
    expect(h).toMatch(/^scrypt\.32768\.8\.1\.[\w-]+\.[\w-]+$/);
    expect(await pruefePasswort("korrekt-pferd-batterie", h)).toBe(true);
    expect(await pruefePasswort("falsch", h)).toBe(false);
    expect(await pruefePasswort("x", "kaputt")).toBe(false);
  });
});

describe("Anmelde-Konfiguration", () => {
  it("ist in Produktion ohne Benutzer gesperrt, mit Benutzern aktiv", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STEUERBOT_BENUTZER", "");
    vi.stubEnv("STEUERBOT_SESSION_SECRET", "");
    expect(authKonfig()).toMatchObject({ aktiv: false, fehlkonfiguriert: true });
    vi.stubEnv("STEUERBOT_BENUTZER", "anna=scrypt.1.1.1.a.b");
    vi.stubEnv("STEUERBOT_SESSION_SECRET", "kurz");
    expect(authKonfig().fehlkonfiguriert).toBe(true);
    vi.stubEnv("STEUERBOT_SESSION_SECRET", GEHEIM);
    expect(authKonfig()).toMatchObject({ aktiv: true, fehlkonfiguriert: false });
    vi.stubEnv("STEUERBOT_AUTH", "aus");
    expect(authKonfig()).toMatchObject({ aktiv: false, fehlkonfiguriert: false });
    vi.unstubAllEnvs();
  });
});

describe("Rate-Limit und Hilfsfunktionen", () => {
  it("sperrt nach max Ereignissen im Fenster", () => {
    const k = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(erlaubt(k, 3, 60_000).ok).toBe(true);
    expect(erlaubt(k, 3, 60_000).ok).toBe(false);
  });
  it("kürzt IPs für Protokolle", () => {
    expect(ipGekuerzt("203.0.113.77")).toBe("203.0.113.0");
    expect(ipGekuerzt("2001:db8:abcd:1:2:3:4:5")).toBe("2001:db8:abcd::");
  });
  it("erkennt Dateitypen am Inhalt", () => {
    expect(dateitypAusInhalt(new TextEncoder().encode("%PDF-1.7 ..."))).toBe("application/pdf");
    expect(dateitypAusInhalt(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(dateitypAusInhalt(new TextEncoder().encode("<html><script>"))).toBeNull();
  });
});
