import { describe, expect, it } from "vitest";
import { formatZahlEingabe, parseZahl } from "./format";

describe("parseZahl", () => {
  it.each([
    ["1234,56", 1234.56],
    ["1.234,56", 1234.56],
    ["1.234", 1234],
    ["12.345.678", 12345678],
    ["1234.56", 1234.56],
    ["1 234 €", 1234],
    ["0,5", 0.5],
    [",5", 0.5],
    ["", 0],
    ["52000", 52000],
  ])("%s → %s", (text, erwartet) => {
    expect(parseZahl(text)).toBe(erwartet);
  });

  it("lehnt Unsinn ab", () => {
    expect(parseZahl("abc")).toBeNull();
    expect(parseZahl("1,2,3")).toBeNull();
  });
});

describe("formatZahlEingabe", () => {
  it("nutzt Komma und lässt 0 leer", () => {
    expect(formatZahlEingabe(1234.5)).toBe("1234,5");
    expect(formatZahlEingabe(0)).toBe("");
  });
});

describe("Ausgabe", () => {
  it("formatiert Euro und Franken deutsch", async () => {
    const { euro, franken, runde2, abrundenCent } = await import("./format");
    const n = (s: string) => s.replace(/ /g, " ");
    expect(n(euro(1234.5))).toBe("1.234,5 €");
    expect(n(euro(1234.5, 2))).toBe("1.234,50 €");
    expect(n(euro(1234.5, 0))).toBe("1.235 €");
    expect(n(franken(100000))).toBe("100.000,00 CHF");
    expect(runde2(1.005 + 0.001)).toBe(1.01);
    expect(abrundenCent(542.289)).toBe(542.28);
  });
});
