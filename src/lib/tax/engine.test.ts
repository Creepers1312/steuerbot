import { describe, expect, it } from "vitest";
import { berechne, zumutbareBelastung } from "./engine";
import { PARAMS } from "./params";
import { parseTaxInput } from "./schema";
import { grundtarif, splittingtarif, tarifMitProgressionsvorbehalt } from "./tariff";

const t25 = PARAMS[2025].tariff;
const t26 = PARAMS[2026].tariff;

describe("Grundtarif § 32a EStG", () => {
  it("ist steuerfrei bis zum Grundfreibetrag", () => {
    expect(grundtarif(12_096, t25)).toBe(0);
    expect(grundtarif(12_348, t26)).toBe(0);
    expect(grundtarif(12_300, t26)).toBe(0);
  });

  it("berechnet Zone 3 (2025, zvE 40.000 € → 7.320 €)", () => {
    expect(grundtarif(40_000, t25)).toBe(7_320);
  });

  // Abgleich mit veröffentlichten Einkommensteuertabellen (lohn-info.de, finanztip.de, steuerschroeder.de)
  it.each([
    [2025, 30_000, false, 4_303],
    [2025, 50_000, false, 10_691],
    [2025, 30_000, true, 970],
    [2026, 50_000, false, 10_548],
  ])("Tabellenwert %i: zvE %i € (Splitting: %s) → %i €", (jahr, zvE, splitting, erwartet) => {
    const t = PARAMS[jahr as 2025 | 2026].tariff;
    expect(splitting ? splittingtarif(zvE, t) : grundtarif(zvE, t)).toBe(erwartet);
  });

  it("ist an allen Zonengrenzen stetig (Sprung < 2 €)", () => {
    for (const t of [t25, t26]) {
      for (const g of [t.grundfreibetrag, t.zone2End, t.zone3End, t.zone4End]) {
        expect(Math.abs(grundtarif(g + 1, t) - grundtarif(g, t))).toBeLessThan(2);
      }
    }
  });

  it("2026 entlastet gegenüber 2025", () => {
    for (const zvE of [20_000, 40_000, 60_000, 100_000]) {
      expect(grundtarif(zvE, t26)).toBeLessThan(grundtarif(zvE, t25));
    }
  });

  it("Splitting = 2 × Grundtarif der Hälfte", () => {
    expect(splittingtarif(80_000, t25)).toBe(2 * 7_320);
  });

  it("Progressionsvorbehalt erhöht den Steuersatz", () => {
    const ohne = grundtarif(30_000, t26);
    const mit = tarifMitProgressionsvorbehalt(30_000, 10_000, t26, false);
    expect(mit).toBeGreaterThan(ohne);
    expect(mit).toBeLessThan(grundtarif(40_000, t26));
  });
});

describe("Zumutbare Belastung (stufenweise)", () => {
  it("BFH-Beispiel: GdE 51.835 €, verheiratet, 2 Kinder → 1.408 €", () => {
    expect(zumutbareBelastung(51_835, true, 2)).toBe(1_408);
  });
  it("Single ohne Kinder, GdE 30.000 €", () => {
    // 15.340 × 5 % + 14.660 × 6 % = 767 + 879,6
    expect(zumutbareBelastung(30_000, false, 0)).toBe(1_646);
  });
});

const basisPerson = {
  name: "Test",
  bruttolohn: 45_000,
  lohnsteuer: 6_500,
  rvArbeitnehmer: 4_185,
  rvArbeitgeber: 4_185,
  kvArbeitnehmer: 3_870,
  pvArbeitnehmer: 810,
  avArbeitnehmer: 585,
  kontofuehrungspauschale: false,
};

describe("Gesamtberechnung", () => {
  it("Pauschbetrag greift, wenn keine Werbungskosten vorliegen", () => {
    const r = berechne(parseTaxInput({ jahr: 2026, personen: [basisPerson] }));
    expect(r.personen[0].pauschbetragGenutzt).toBe(true);
    expect(r.personen[0].werbungskostenAngesetzt).toBe(1_230);
    // Vorsorge: RV-AN 4.185 + KV×0,96 3.715,20 + PV 810
    expect(r.vorsorgeaufwendungen).toBeCloseTo(8_710.2, 2);
    expect(r.zvE).toBe(Math.floor(45_000 - 1_230 - 8_710.2 - 36));
  });

  it("2026: 38 Cent ab dem ersten Kilometer, 2025: 30 Cent bis km 20", () => {
    const p = { ...basisPerson, entfernungKm: 25, arbeitstageBuero: 200 };
    const r26 = berechne(parseTaxInput({ jahr: 2026, personen: [p] }));
    const r25 = berechne(parseTaxInput({ jahr: 2025, personen: [p] }));
    expect(r26.personen[0].werbungskostenAngesetzt).toBeCloseTo(200 * 25 * 0.38, 2);
    expect(r25.personen[0].werbungskostenAngesetzt).toBeCloseTo(200 * (20 * 0.3 + 5 * 0.38), 2);
  });

  it("zusätzliche Werbungskosten erhöhen die Erstattung etwa um den Grenzsteuersatz", () => {
    const a = berechne(parseTaxInput({ personen: [{ ...basisPerson, arbeitsmittel: 2_000 }] }));
    const b = berechne(parseTaxInput({ personen: [{ ...basisPerson, arbeitsmittel: 3_000 }] }));
    const diff = b.erstattung - a.erstattung;
    expect(diff).toBeGreaterThan(1_000 * a.grenzsteuersatz * 0.95);
    expect(diff).toBeLessThan(1_000 * a.grenzsteuersatz * 1.1 + 5);
  });

  it("Homeoffice-Pauschale ist auf 210 Tage begrenzt", () => {
    const r = berechne(parseTaxInput({ personen: [{ ...basisPerson, homeofficeTage: 250 }] }));
    expect(r.personen[0].werbungskostenAngesetzt).toBe(1_260);
  });

  it("2026: Gewerkschaftsbeiträge zusätzlich zum Pauschbetrag", () => {
    const p = { ...basisPerson, gewerkschaftsbeitraege: 300 };
    expect(berechne(parseTaxInput({ jahr: 2026, personen: [p] })).personen[0].werbungskostenAngesetzt).toBe(1_530);
    expect(berechne(parseTaxInput({ jahr: 2025, personen: [p] })).personen[0].werbungskostenAngesetzt).toBe(1_230);
  });

  it("Ehepaar: Splitting senkt die Steuer gegenüber zwei Einzelveranlagungen bei ungleichem Einkommen", () => {
    const zusammen = berechne(
      parseTaxInput({
        zusammenveranlagung: true,
        personen: [{ ...basisPerson, bruttolohn: 70_000 }, { name: "B", bruttolohn: 10_000 }],
      }),
    );
    const einzelA = berechne(parseTaxInput({ personen: [{ ...basisPerson, bruttolohn: 70_000 }] }));
    const einzelB = berechne(parseTaxInput({ personen: [{ name: "B", bruttolohn: 10_000 }] }));
    expect(zusammen.splitting).toBe(true);
    expect(zusammen.festzusetzendeESt).toBeLessThan(einzelA.festzusetzendeESt + einzelB.festzusetzendeESt);
  });

  it("Kindergeld ist bei mittlerem Einkommen günstiger, bei hohem der Kinderfreibetrag", () => {
    const mittel = berechne(
      parseTaxInput({ zusammenveranlagung: true, personen: [basisPerson, { name: "B" }], kinder: [{ name: "K" }] }),
    );
    expect(mittel.kinderfreibetragGuenstiger).toBe(false);
    expect(mittel.kindergeldHinzurechnung).toBe(0);

    const hoch = berechne(
      parseTaxInput({
        zusammenveranlagung: true,
        personen: [{ ...basisPerson, bruttolohn: 150_000 }, { name: "B", bruttolohn: 90_000 }],
        kinder: [{ name: "K" }],
      }),
    );
    expect(hoch.kinderfreibetragGuenstiger).toBe(true);
    expect(hoch.kindergeldHinzurechnung).toBe(259 * 12);
  });

  it("§ 35a: Handwerker 20 % der Lohnkosten, max. 1.200 €", () => {
    const a = berechne(parseTaxInput({ personen: [basisPerson] }));
    const b = berechne(parseTaxInput({ personen: [basisPerson], handwerkerLohnkosten: 1_000 }));
    const c = berechne(parseTaxInput({ personen: [basisPerson], handwerkerLohnkosten: 50_000 }));
    expect(b.steuerermaessigung35a).toBe(200);
    expect(c.steuerermaessigung35a).toBe(1_200);
    expect(b.erstattung - a.erstattung).toBeCloseTo(200, 0);
  });

  it("Soli entfällt unterhalb der Freigrenze", () => {
    const r = berechne(parseTaxInput({ personen: [basisPerson] }));
    expect(r.soli).toBe(0);
  });

  it("Soli in der Milderungszone und voll bei hohem Einkommen", () => {
    const hoch = berechne(parseTaxInput({ personen: [{ ...basisPerson, bruttolohn: 200_000 }] }));
    expect(hoch.soli).toBeCloseTo(hoch.festzusetzendeESt * 0.055, 0);
  });

  it("Kirchensteuer 8 % in Bayern, 9 % in NRW", () => {
    const p = { ...basisPerson, kirchenmitglied: true };
    const by = berechne(parseTaxInput({ bundesland: "BY", personen: [p] }));
    const nw = berechne(parseTaxInput({ bundesland: "NW", personen: [p] }));
    expect(by.kirchensteuer / nw.kirchensteuer).toBeCloseTo(8 / 9, 2);
  });

  it("Alleinerziehende erhalten den Entlastungsbetrag", () => {
    const r = berechne(
      parseTaxInput({ alleinerziehend: true, personen: [basisPerson], kinder: [{ name: "A" }, { name: "B" }] }),
    );
    expect(r.entlastungsbetragAlleinerziehende).toBe(4_500);
  });

  it("Erstattung = gezahlt − geschuldet", () => {
    const r = berechne(parseTaxInput({ personen: [basisPerson] }));
    expect(r.erstattung).toBeCloseTo(r.bereitsGezahlt.gesamt - r.steuerGesamt, 2);
  });
});
