import type { BelegDaten } from "../assistant/beleg-mapping";
import type { TaxInput } from "../tax/schema";

export type KapitelId = "allgemein" | "lohn" | "werbungskosten" | "familie" | "wohnen" | "sonstiges";

export const KAPITEL: { id: KapitelId; label: string; icon: string }[] = [
  { id: "allgemein", label: "Allgemein", icon: "👋" },
  { id: "lohn", label: "Lohn", icon: "💼" },
  { id: "werbungskosten", label: "Arbeit", icon: "🚗" },
  { id: "familie", label: "Familie", icon: "👨‍👩‍👧" },
  { id: "wohnen", label: "Wohnen", icon: "🏠" },
  { id: "sonstiges", label: "Sonstiges", icon: "❤️" },
];

export interface BelegEintrag {
  text: string;
  betrag: number;
}

export interface Antwort {
  /** Rohwert der Antwort (true/false, Auswahl-Wert, Zahl, Text, Formularwerte); null = übersprungen */
  wert: unknown;
  /** Bei Sammel-Fragen: ausgelesene Belege */
  belege?: BelegEintrag[];
}

export type Antworten = Record<string, Antwort>;

export interface InterviewStand {
  antworten: Antworten;
  /** Reihenfolge der gegebenen Antworten (Schlüssel) – für die Anzeige des Verlaufs */
  verlauf: string[];
}

export const LEERER_STAND: InterviewStand = { antworten: {}, verlauf: [] };

/** Kontext für Bedingungen und Texte: aktueller Datenstand, Antworten, Person-/Kind-Index. */
export interface Ctx {
  input: TaxInput;
  antworten: Antworten;
  p: number;
  k: number;
}

interface Basis {
  id: string;
  kapitel: KapitelId;
  /** "person": wird je Person gestellt (bei Zusammenveranlagung zweimal), "kind": je Kind */
  scope?: "person" | "kind";
  text: (c: Ctx) => string;
  /** Erklärtext hinter „❓ Was heißt das?“ */
  erklaerung?: string;
  wenn?: (c: Ctx) => boolean;
  /** Darf übersprungen werden (Standard: ja) */
  pflicht?: boolean;
}

export interface Option {
  wert: string;
  label: string;
}

export type Frage =
  | (Basis & { typ: "janein"; aktuell?: (c: Ctx) => boolean | undefined; anwenden?: (ja: boolean, c: Ctx) => TaxInput })
  | (Basis & {
      typ: "auswahl";
      optionen: (c: Ctx) => Option[];
      /** Als Liste (Dropdown) statt Knöpfen anzeigen */
      liste?: boolean;
      aktuell?: (c: Ctx) => string | undefined;
      anwenden?: (wert: string, c: Ctx) => TaxInput;
    })
  | (Basis & {
      typ: "zahl";
      einheit: string;
      ganzzahl?: boolean;
      max?: number;
      /** Schnellauswahl-Knöpfe */
      vorschlaege?: number[];
      aktuell: (c: Ctx) => number;
      anwenden: (n: number, c: Ctx) => TaxInput;
    })
  | (Basis & { typ: "text"; platzhalter?: string; aktuell: (c: Ctx) => string; anwenden: (t: string, c: Ctx) => TaxInput })
  | (Basis & {
      /** Mehrere Belege hochladen und/oder eine Summe eintippen */
      typ: "sammeln";
      belegHinweis: string;
      manuellLabel: string;
      betragAusBeleg: (b: BelegDaten) => number | null;
      aktuell: (c: Ctx) => number;
      anwenden: (summe: number, c: Ctx) => TaxInput;
    })
  | (Basis & {
      /** Ein Dokument mit mehreren Werten (Lohnsteuerbescheinigung, Gehaltsabrechnung) */
      typ: "dokument";
      belegHinweis: string;
      felder: { key: string; label: string; einheit?: string; ganzzahl?: boolean }[];
      aktuell: (c: Ctx) => Record<string, number>;
      manuellAnwenden: (werte: Record<string, number>, c: Ctx) => TaxInput;
      belegAnwenden: (b: BelegDaten, c: Ctx) => { input: TaxInput; text: string } | null;
    })
  | (Basis & { typ: "info" });

export interface Schritt {
  key: string;
  frage: Frage;
  ctx: Ctx;
}
