import { describe, expect, it } from "vitest";
import { formatZahlEingabe, parseZahl } from "./zahl";

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
