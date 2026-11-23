import { describe, expect, it } from "vitest";
import { berechne } from "../tax/engine";
import { defaultInput } from "../tax/schema";
import { beantworten, belegHinzufuegen, fortschritt, naechsterSchritt, sammelnAbschliessen, schritte } from "./ablauf";
import { LEERER_STAND, type InterviewStand } from "./typen";
import type { TaxInput } from "../tax/schema";

/** Beantwortet die nächste Frage und prüft, dass es die erwartete ist. */
function antworte(z: { input: TaxInput; stand: InterviewStand }, id: string, wert: unknown) {
  const s = naechsterSchritt(z.input, z.stand);
  expect(s?.key).toBe(id);
  return beantworten(z.input, z.stand, s!, wert);
}

describe("Fragebogen", () => {
  it("führt eine Single-Person mit Lohnsteuerbescheinigung durch alle Kapitel", () => {
    let z = { input: defaultInput(), stand: LEERER_STAND };
    z = antworte(z, "jahr", "2025");
    z = antworte(z, "bundesland", "BY");
    z = antworte(z, "verheiratet", false);
    z = antworte(z, "name@p0", "Anna");
    z = antworte(z, "kirche@p0", true);
    z = antworte(z, "lohn_quelle@p0", "lstb");
    z = antworte(z, "lstb@p0", { bruttolohn: 45_000, lohnsteuer: 6_000, rvArbeitnehmer: 4_185, rvArbeitgeber: 4_185, kvArbeitnehmer: 3_870, pvArbeitnehmer: 810, avArbeitnehmer: 585, kirchensteuerEinbehalten: 480 });
    z = antworte(z, "lohnersatz@p0", false);
    z = antworte(z, "weg_art@p0", "auto");
    z = antworte(z, "km@p0", 30);
    z = antworte(z, "buerotage@p0", 4);
    z = antworte(z, "homeoffice@p0", 1);
    expect(z.input.personen[0]).toMatchObject({ name: "Anna", entfernungKm: 30, arbeitstageBuero: 184, homeofficeTage: 46, mitPkw: true });
    expect(z.input.jahr).toBe(2025);
    z = antworte(z, "arbeitsmittel@p0", true);
    z = antworte(z, "arbeitsmittel_belege@p0", 600);
    z = antworte(z, "fortbildung@p0", false);
    z = antworte(z, "gewerkschaft@p0", 0);
    z = antworte(z, "sonstige_wk@p0", 0);
    z = antworte(z, "kinder", 0);
    // keine Kinder → keine Kinderfragen
    z = antworte(z, "handwerker", true);
    z = antworte(z, "handwerker_belege", 1_000);
    z = antworte(z, "haushaltsnah", false);
    z = antworte(z, "spenden", false);
    z = antworte(z, "krankheit", false);
    z = antworte(z, "behinderung@p0", false);
    expect(naechsterSchritt(z.input, z.stand)).toBeNull();

    const r = berechne(z.input);
    expect(r.steuerermaessigung35a).toBe(200);
    expect(r.personen[0].werbungskostenAngesetzt).toBeGreaterThan(1_230);
    expect(fortschritt(z.input, z.stand).kapitel.every((k) => k.status === "fertig" || k.status === "leer")).toBe(true);
  });

  it("fragt bei Zusammenveranlagung beide Personen und bei Kindern die Kinderfragen", () => {
    let z = { input: defaultInput(), stand: LEERER_STAND };
    z = antworte(z, "jahr", "2026");
    z = antworte(z, "bundesland", "NW");
    z = antworte(z, "verheiratet", true);
    const keys = schritte(z.input, z.stand).map((s) => s.key);
    expect(keys).toContain("name@p1");
    expect(keys).toContain("lohn_quelle@p1");
    expect(keys).not.toContain("alleinerziehend");
    // Fragen zu einer Person bleiben zusammen: erst alles zu Person 1, dann Person 2
    const lohn = keys.filter((k) => k.startsWith("lohn") || k.startsWith("lstb") || k.startsWith("abrechnung"));
    expect(lohn.indexOf("lohnersatz@p0")).toBeLessThan(lohn.indexOf("lohn_quelle@p1"));
    expect(keys.indexOf("kirche@p0")).toBeLessThan(keys.indexOf("name@p1"));

    // Kinder: Anzahl setzen → Kinderfragen erscheinen
    const kinderSchritt = schritte(z.input, z.stand).find((s) => s.key === "kinder")!;
    z = beantworten(z.input, z.stand, kinderSchritt, 2);
    expect(z.input.kinder).toHaveLength(2);
    const ganzjahr = schritte(z.input, z.stand).find((s) => s.key === "kinder_ganzjahr")!;
    z = beantworten(z.input, z.stand, ganzjahr, false);
    const keys2 = schritte(z.input, z.stand).map((s) => s.key);
    expect(keys2).toContain("kind_monate@k0");
    expect(keys2).toContain("kind_monate@k1");
    expect(keys2).toContain("kita");
  });

  it("Neu-Beantworten überschreibt statt zu addieren", () => {
    let z = { input: defaultInput(), stand: LEERER_STAND };
    const ja = schritte(z.input, z.stand).find((s) => s.key === "handwerker")!;
    z = beantworten(z.input, z.stand, ja, true);
    const belege = schritte(z.input, z.stand).find((s) => s.key === "handwerker_belege")!;
    z = beantworten(z.input, z.stand, belege, 500);
    z = beantworten(z.input, z.stand, belege, 800);
    expect(z.input.handwerkerLohnkosten).toBe(800);
    // Nein setzt zurück, Belegfrage verschwindet
    z = beantworten(z.input, z.stand, ja, false);
    expect(z.input.handwerkerLohnkosten).toBe(0);
    expect(schritte(z.input, z.stand).some((s) => s.key === "handwerker_belege")).toBe(false);
  });

  it("Sammel-Frage: Belege + Eintrag werden summiert", () => {
    let z = { input: defaultInput(), stand: LEERER_STAND };
    z = beantworten(z.input, z.stand, schritte(z.input, z.stand).find((s) => s.key === "spenden")!, true);
    const s = schritte(z.input, z.stand).find((x) => x.key === "spenden_belege")!;
    const beleg = { belegart: "spendenquittung", beschreibung: "Spende Tierheim", steuerjahr: 2026, betragGesamt: 120, lohnkostenAnteil: null, lohnsteuerbescheinigung: null, unsicherheiten: [] };
    const r1 = belegHinzufuegen(z.input, z.stand, s, beleg);
    expect("fehler" in r1).toBe(false);
    if ("fehler" in r1) return;
    expect(r1.input.spenden).toBe(120);
    const r2 = belegHinzufuegen(r1.input, r1.stand, s, { ...beleg, betragGesamt: 80 });
    if ("fehler" in r2) throw new Error(r2.fehler);
    const fertig = sammelnAbschliessen(r2.input, r2.stand, s, 50);
    expect(fertig.input.spenden).toBe(250);
    expect(naechsterSchritt(fertig.input, fertig.stand)?.key).not.toBe("spenden_belege");
  });

  it("Gehaltsabrechnung + Sonderzahlung: erneute Antwort rechnet nur die Differenz", () => {
    let z = { input: defaultInput(), stand: LEERER_STAND };
    const quelle = schritte(z.input, z.stand).find((s) => s.key === "lohn_quelle@p0")!;
    z = beantworten(z.input, z.stand, quelle, "abrechnung");
    const abr = schritte(z.input, z.stand).find((s) => s.key === "abrechnung@p0")!;
    z = beantworten(z.input, z.stand, abr, { monat: 10, brutto: 4_000, lohnsteuer: 550, rv: 372, kv: 340, pv: 72, av: 52 });
    expect(z.input.personen[0].bruttolohn).toBe(48_000);
    const sz = schritte(z.input, z.stand).find((s) => s.key === "sonderzahlung@p0")!;
    z = beantworten(z.input, z.stand, sz, 2_000);
    expect(z.input.personen[0].bruttolohn).toBe(50_000);
    z = beantworten(z.input, z.stand, sz, 3_000);
    expect(z.input.personen[0].bruttolohn).toBe(51_000);
  });

  it("Überspringen lässt den Datenstand unverändert", () => {
    const input = defaultInput();
    const s = naechsterSchritt(input, LEERER_STAND)!;
    const z = beantworten(input, LEERER_STAND, s, null);
    expect(z.input).toEqual(input);
    expect(naechsterSchritt(z.input, z.stand)?.key).toBe("bundesland");
  });
});
