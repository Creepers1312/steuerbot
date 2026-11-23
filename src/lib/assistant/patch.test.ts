import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PatchSchema, applyPatch, compactInput } from "./patch";
import { belegZuPatch } from "./beleg-mapping";
import { parseTaxInput } from "../tax/schema";

const base = parseTaxInput({
  bundesland: "BY",
  personen: [{ name: "Anna", bruttolohn: 40_000, lohnsteuer: 5_000, arbeitsmittel: 100 }],
});

describe("applyPatch", () => {
  it("ändert nur die angegebenen Felder", () => {
    const patch = PatchSchema.parse({ personen: [{ index: 0, felder: { arbeitsmittel: 500 } }], allgemein: { spenden: 50 } });
    const next = applyPatch(base, patch);
    expect(next.personen[0].bruttolohn).toBe(40_000);
    expect(next.personen[0].name).toBe("Anna");
    expect(next.bundesland).toBe("BY");
    expect(next.personen[0].arbeitsmittel).toBe(500);
    expect(next.spenden).toBe(50);
  });

  it("legt Partner:in an und aktiviert Zusammenveranlagung", () => {
    const next = applyPatch(base, PatchSchema.parse({ personen: [{ index: 1, felder: { name: "Ben", bruttolohn: 30_000 } }] }));
    expect(next.zusammenveranlagung).toBe(true);
    expect(next.personen[1]).toMatchObject({ name: "Ben", bruttolohn: 30_000, kontofuehrungspauschale: true });
  });

  it("ersetzt die Kinderliste mit Standardwerten", () => {
    const next = applyPatch(base, PatchSchema.parse({ kinder: [{ name: "Mia" }] }));
    expect(next.kinder).toEqual([{ name: "Mia", monate: 12, vollerFreibetrag: false }]);
  });

  it("lehnt ungültige Werte ab", () => {
    expect(PatchSchema.safeParse({ personen: [{ index: 0, felder: { bruttolohn: -5 } }] }).success).toBe(false);
  });
});

describe("Werkzeug-Schema", () => {
  it("enthält keine Standardwerte (sonst würden Felder überschrieben)", () => {
    const json = JSON.stringify(z.toJSONSchema(PatchSchema, { io: "input", unrepresentable: "any" }));
    expect(json).not.toContain('"default"');
    expect(json).toContain("Zeile 3");
  });
});

describe("compactInput", () => {
  it("zeigt nur abweichende Werte", () => {
    const c = compactInput(base) as { personen: Record<string, unknown>[]; bundesland: string };
    expect(c.bundesland).toBe("BY");
    expect(Object.keys(c.personen[0]).sort()).toEqual(["arbeitsmittel", "bruttolohn", "lohnsteuer", "name"]);
  });
});

describe("belegZuPatch", () => {
  it("Handwerkerrechnung addiert den Lohnanteil", () => {
    const v = belegZuPatch(
      { belegart: "handwerkerrechnung", beschreibung: "", steuerjahr: 2026, betragGesamt: 1_000, lohnkostenAnteil: 400, lohnsteuerbescheinigung: null, unsicherheiten: [] },
      { ...base, handwerkerLohnkosten: 100 },
      0,
    );
    expect(applyPatch(base, v.patch!).handwerkerLohnkosten).toBe(500);
  });
  it("Lohnsteuerbescheinigung ersetzt die Werte der gewählten Person", () => {
    const v = belegZuPatch(
      {
        belegart: "lohnsteuerbescheinigung", beschreibung: "", steuerjahr: 2026, betragGesamt: null, lohnkostenAnteil: null,
        lohnsteuerbescheinigung: { bruttolohn: 52_000, lohnsteuer: 7_900, soli: 0, kirchensteuer: 600, rvArbeitgeber: 4_836, rvArbeitnehmer: 4_836, kvArbeitnehmer: 4_200, pvArbeitnehmer: 900, avArbeitnehmer: 676, lohnersatzleistungen: null },
        unsicherheiten: [],
      },
      base,
      0,
    );
    const next = applyPatch(base, v.patch!);
    expect(next.personen[0]).toMatchObject({ bruttolohn: 52_000, lohnsteuer: 7_900, kirchenmitglied: true, arbeitsmittel: 100 });
  });
});
