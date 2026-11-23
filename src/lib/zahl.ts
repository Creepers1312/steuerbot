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
