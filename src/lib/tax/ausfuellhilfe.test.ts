import { describe, expect, it } from "vitest";
import { ausfuellhilfe } from "./ausfuellhilfe";
import { berechne } from "@/lib/tax/engine";
import { parseTaxInput } from "@/lib/tax/schema";

describe("Ausfüllhilfe", () => {
  it("ordnet Angaben den richtigen Anlagen zu", () => {
    const input = parseTaxInput({
      zusammenveranlagung: true,
      personen: [{ name: "Anna", bruttolohn: 50_000, entfernungKm: 20, arbeitstageBuero: 150, arbeitsmittel: 500 }, { name: "Ben" }],
      kinder: [{ name: "Mia" }],
      kinderbetreuungskosten: 2_000,
      handwerkerLohnkosten: 800,
      spenden: 100,
    });
    const a = ausfuellhilfe(input, berechne(input));
    const anlagen = a.map((x) => x.anlage);
    expect(anlagen).toEqual(
      expect.arrayContaining([
        "Anlage N – Anna",
        "Anlage N – Ben",
        "Anlage Kind – Mia",
        "Anlage Sonderausgaben",
        "Anlage Haushaltsnahe Aufwendungen",
        "Anlage Vorsorgeaufwand",
      ]),
    );
    const n = a.find((x) => x.anlage === "Anlage N – Anna")!;
    expect(n.eintraege.some((e) => e.wert.includes("150 Arbeitstage") && e.wert.includes("20 km"))).toBe(true);
  });
});
