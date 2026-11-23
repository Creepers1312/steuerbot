import { describe, expect, it } from "vitest";
import { hochrechnen, type Gehaltsabrechnung } from "./hochrechnung";

const monat: Gehaltsabrechnung = {
  modus: "monat",
  monat: 10,
  brutto: 4_000,
  lohnsteuer: 550,
  soli: 0,
  kirchensteuer: 44,
  rv: 372,
  kv: 340,
  pv: 72,
  av: 52,
  einmalzahlungBrutto: 0,
};

describe("Hochrechnung Gehaltsabrechnung", () => {
  it("Monatswerte × 12", () => {
    const r = hochrechnen(monat, 2026);
    expect(r.bruttolohn).toBe(48_000);
    expect(r.lohnsteuer).toBe(6_600);
    expect(r.kirchensteuerEinbehalten).toBeCloseTo(528, 2);
    expect(r.rvArbeitgeber).toBe(r.rvArbeitnehmer);
  });

  it("Jahressummen werden auf 12 Monate hochgerechnet", () => {
    const r = hochrechnen({ ...monat, modus: "kumuliert", monat: 9, brutto: 36_000, lohnsteuer: 4_950 }, 2026);
    expect(r.bruttolohn).toBe(48_000);
    expect(r.lohnsteuer).toBe(6_600);
  });

  it("Sonderzahlung erhöht Lohnsteuer etwa mit dem Grenzsteuersatz", () => {
    const ohne = hochrechnen(monat, 2026);
    const mit = hochrechnen({ ...monat, einmalzahlungBrutto: 2_000 }, 2026);
    expect(mit.bruttolohn).toBe(50_000);
    const mehr = mit.lohnsteuer - ohne.lohnsteuer;
    expect(mehr).toBeGreaterThan(2_000 * 0.25);
    expect(mehr).toBeLessThan(2_000 * 0.35);
    // Kirchensteuer folgt der Lohnsteuer im gleichen Verhältnis
    expect(mit.kirchensteuerEinbehalten / mit.lohnsteuer).toBeCloseTo(44 / 550, 4);
  });
});
