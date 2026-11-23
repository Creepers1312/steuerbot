/**
 * Zahlen und Beträge im deutschen Format lesen und ausgeben – an einer Stelle für die ganze App.
 */

/**
 * Liest Zahlen so, wie Menschen sie in Deutschland tippen:
 * „1.234,56“, „1234,5“, „1 234 €“, „1234.56“ (Punkt als Dezimaltrenner wird auch akzeptiert).
 * Liefert null bei nicht lesbarer Eingabe.
 */
export function parseZahl(text: string): number | null {
  let s = text.replace(/[\s €]/g, "");
  if (s === "") return 0;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // „1.234“ / „12.345.678“ = Tausenderpunkte
    s = s.replace(/\./g, "");
  }
  if (!/^-?\d*\.?\d*$/.test(s) || s === "." || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Formatiert für ein Eingabefeld: „1234,5“ (ohne Tausenderpunkte, damit Bearbeiten einfach bleibt). */
export function formatZahlEingabe(n: number): string {
  if (!n) return "";
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

// ---------------------------------------------------------------------------
// Ausgabe
// ---------------------------------------------------------------------------

/**
 * Euro-Betrag im deutschen Format, z. B. „1.234,56 €“ (mit geschütztem Leerzeichen).
 * stellen: 0 = ganze Euro, 2 = immer zwei Nachkommastellen, "auto" = bis zu zwei (Standard).
 */
export function euro(n: number, stellen: 0 | 2 | "auto" = "auto"): string {
  return waehrung(n, "EUR", stellen);
}

/** Franken-Betrag, z. B. „100.000,00 CHF“. */
export function franken(n: number, stellen: 0 | 2 | "auto" = 2): string {
  return waehrung(n, "CHF", stellen);
}

function waehrung(n: number, code: "EUR" | "CHF", stellen: 0 | 2 | "auto"): string {
  return n.toLocaleString("de-DE", {
    style: "currency",
    currency: code,
    currencyDisplay: code === "CHF" ? "code" : "symbol",
    minimumFractionDigits: stellen === "auto" ? 0 : stellen,
    maximumFractionDigits: stellen === "auto" ? 2 : stellen,
  });
}

/** Zahl ohne Währung, z. B. „1.234“. */
export const zahl = (n: number, maxStellen = 2) => n.toLocaleString("de-DE", { maximumFractionDigits: maxStellen });

/** Kaufmännisch auf Cent runden. */
export const runde2 = (n: number) => Math.round(n * 100) / 100;

/** Auf volle Cent abrunden (Zuschlagsteuern). */
export const abrundenCent = (n: number) => Math.floor(n * 100 + 1e-9) / 100;
