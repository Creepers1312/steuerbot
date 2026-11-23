/**
 * Felder der Lohnsteuerbescheinigung und des Schweizer Lohnausweises – eine Quelle für
 * Formular, Fragebogen und Belegerkennung.
 */
import type { Person } from "./schema";

type ZahlFeld = { [K in keyof Person]: Person[K] extends number ? K : never }[keyof Person];

export interface BelegFeld {
  /** Feld im Datenstand */
  feld: ZahlFeld;
  label: string;
  /** Zeile (Lohnsteuerbescheinigung) bzw. Ziffer (Lohnausweis) */
  stelle: string;
  /** Schlüssel in der KI-Belegerkennung */
  beleg: string;
}

export const LOHNSTEUERBESCHEINIGUNG: readonly BelegFeld[] = [
  { feld: "bruttolohn", label: "Bruttoarbeitslohn", stelle: "Zeile 3", beleg: "bruttolohn" },
  { feld: "lohnsteuer", label: "Lohnsteuer", stelle: "Zeile 4", beleg: "lohnsteuer" },
  { feld: "soliEinbehalten", label: "Solidaritätszuschlag", stelle: "Zeile 5", beleg: "soli" },
  { feld: "kirchensteuerEinbehalten", label: "Kirchensteuer", stelle: "Zeile 6/7", beleg: "kirchensteuer" },
  { feld: "rvArbeitgeber", label: "Rente Arbeitgeber", stelle: "Zeile 22a", beleg: "rvArbeitgeber" },
  { feld: "rvArbeitnehmer", label: "Rente Arbeitnehmer", stelle: "Zeile 23a", beleg: "rvArbeitnehmer" },
  { feld: "kvArbeitnehmer", label: "Krankenversicherung", stelle: "Zeile 25", beleg: "kvArbeitnehmer" },
  { feld: "pvArbeitnehmer", label: "Pflegeversicherung", stelle: "Zeile 26", beleg: "pvArbeitnehmer" },
  { feld: "avArbeitnehmer", label: "Arbeitslosenversicherung", stelle: "Zeile 27", beleg: "avArbeitnehmer" },
];

export const LOHNAUSWEIS_CH: readonly BelegFeld[] = [
  { feld: "chBruttolohn", label: "Bruttolohn", stelle: "Ziffer 8", beleg: "ziffer8" },
  { feld: "chZiffer9", label: "AHV/IV/EO/ALV/NBUV", stelle: "Ziffer 9", beleg: "ziffer9" },
  { feld: "chBvg", label: "Pensionskasse (BVG)", stelle: "Ziffer 10", beleg: "ziffer10" },
  { feld: "chQuellensteuer", label: "Quellensteuer", stelle: "Ziffer 12", beleg: "ziffer12" },
];

/** Werte aus einem ausgelesenen Beleg in Personenfelder übertragen (fehlende Werte bleiben weg). */
export function belegWerte(felder: readonly BelegFeld[], quelle: Record<string, number | null | undefined>): Partial<Person> {
  const out: Partial<Record<ZahlFeld, number>> = {};
  for (const f of felder) {
    const v = quelle[f.beleg];
    if (typeof v === "number") out[f.feld] = v;
  }
  return out as Partial<Person>;
}

/** Aktuelle Werte einer Person für die angegebenen Felder. */
export function personWerte(felder: readonly BelegFeld[], p: Person): Record<string, number> {
  return Object.fromEntries(felder.map((f) => [f.feld, p[f.feld]]));
}
