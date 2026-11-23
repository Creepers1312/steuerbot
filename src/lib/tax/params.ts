/**
 * Steuerliche Parameter je Veranlagungsjahr.
 *
 * Alle Werte, die sich jährlich ändern, stehen hier – nirgendwo sonst im Code.
 * Für ein neues Jahr: Block kopieren, Werte aus EStG / SolzG / BMF übernehmen,
 * Tests ergänzen.
 */

export type SupportedYear = 2025 | 2026;

export interface TariffZones {
  /** Grundfreibetrag (Zone 1 endet hier) */
  grundfreibetrag: number;
  /** Zone 2: (a·y + b)·y, y = (zvE − grundfreibetrag) / 10.000 */
  zone2End: number;
  zone2A: number;
  zone2B: number;
  /** Zone 3: (a·z + b)·z + c, z = (zvE − zone2End) / 10.000 */
  zone3End: number;
  zone3A: number;
  zone3B: number;
  zone3C: number;
  /** Zone 4: 0,42·x − d */
  zone4End: number;
  zone4D: number;
  /** Zone 5: 0,45·x − e */
  zone5E: number;
}

export interface YearParams {
  year: SupportedYear;
  tariff: TariffZones;
  /** Solidaritätszuschlag: Freigrenze Einzelveranlagung (bei Zusammenveranlagung ×2) */
  soliFreigrenze: number;
  arbeitnehmerPauschbetrag: number;
  /** Entfernungspauschale €/km für km 1–20 */
  pendlerBis20: number;
  /** Entfernungspauschale €/km ab km 21 */
  pendlerAb21: number;
  /** Höchstbetrag Entfernungspauschale ohne eigenen Pkw */
  pendlerHoechstbetragOhnePkw: number;
  homeofficeProTag: number;
  homeofficeMaxTage: number;
  /** Gewerkschaftsbeiträge zusätzlich zum AN-Pauschbetrag abziehbar (ab 2026) */
  gewerkschaftUeberPauschbetrag: boolean;
  /** Sonderausgaben-Pauschbetrag je Person */
  sonderausgabenPauschbetrag: number;
  /** Höchstbetrag Altersvorsorgeaufwendungen (§ 10 Abs. 3 EStG) je Person */
  altersvorsorgeHoechstbetrag: number;
  /** Höchstbetrag sonstige Vorsorgeaufwendungen für Arbeitnehmer je Person */
  sonstigeVorsorgeHoechstbetrag: number;
  /** Kinderfreibetrag (sächliches Existenzminimum) je Kind, beide Elternteile zusammen */
  kinderfreibetrag: number;
  /** Freibetrag für Betreuungs-, Erziehungs- oder Ausbildungsbedarf je Kind, beide Elternteile */
  beaFreibetrag: number;
  /** Kindergeld je Kind und Monat */
  kindergeldMonat: number;
  /** Entlastungsbetrag für Alleinerziehende: erstes Kind / jedes weitere Kind */
  alleinerziehendErstesKind: number;
  alleinerziehendWeiteresKind: number;
  /** Umrechnungskurs: Euro je 1 CHF (amtlicher Jahreskurs) */
  chfKurs: number;
  /** true = Jahreskurs noch nicht veröffentlicht, Schätzwert */
  chfKursVorlaeufig: boolean;
}

export const PARAMS: Record<SupportedYear, YearParams> = {
  2025: {
    year: 2025,
    tariff: {
      grundfreibetrag: 12_096,
      zone2End: 17_443,
      zone2A: 932.3,
      zone2B: 1_400,
      zone3End: 68_480,
      zone3A: 176.64,
      zone3B: 2_397,
      zone3C: 1_015.13,
      zone4End: 277_825,
      zone4D: 10_911.92,
      zone5E: 19_246.67,
    },
    soliFreigrenze: 19_950,
    arbeitnehmerPauschbetrag: 1_230,
    pendlerBis20: 0.3,
    pendlerAb21: 0.38,
    pendlerHoechstbetragOhnePkw: 4_500,
    homeofficeProTag: 6,
    homeofficeMaxTage: 210,
    gewerkschaftUeberPauschbetrag: false,
    sonderausgabenPauschbetrag: 36,
    altersvorsorgeHoechstbetrag: 29_344,
    sonstigeVorsorgeHoechstbetrag: 1_900,
    kinderfreibetrag: 6_672,
    beaFreibetrag: 2_928,
    kindergeldMonat: 255,
    alleinerziehendErstesKind: 4_260,
    alleinerziehendWeiteresKind: 240,
    // Finanzämter Baden-Württemberg: 100 CHF = 106,50 EUR
    chfKurs: 1.065,
    chfKursVorlaeufig: false,
  },
  2026: {
    year: 2026,
    tariff: {
      grundfreibetrag: 12_348,
      zone2End: 17_799,
      zone2A: 914.51,
      zone2B: 1_400,
      zone3End: 69_878,
      zone3A: 173.1,
      zone3B: 2_397,
      zone3C: 1_034.87,
      zone4End: 277_825,
      zone4D: 11_135.63,
      zone5E: 19_470.38,
    },
    soliFreigrenze: 20_350,
    arbeitnehmerPauschbetrag: 1_230,
    // Steueränderungsgesetz 2025: 38 Cent ab dem ersten Kilometer
    pendlerBis20: 0.38,
    pendlerAb21: 0.38,
    pendlerHoechstbetragOhnePkw: 4_500,
    homeofficeProTag: 6,
    homeofficeMaxTage: 210,
    gewerkschaftUeberPauschbetrag: true,
    sonderausgabenPauschbetrag: 36,
    // Höchstbetrag = Beitragsbemessungsgrenze knappschaftliche RV × Beitragssatz.
    // Wert für 2026 vor produktiver Nutzung gegen BMF-Schreiben prüfen; für typische
    // Arbeitnehmer nicht relevant (greift erst bei sehr hohen Einkommen).
    altersvorsorgeHoechstbetrag: 30_826,
    sonstigeVorsorgeHoechstbetrag: 1_900,
    kinderfreibetrag: 6_828,
    beaFreibetrag: 2_928,
    kindergeldMonat: 259,
    alleinerziehendErstesKind: 4_260,
    alleinerziehendWeiteresKind: 240,
    // Jahreskurs 2026 wird erst nach Jahresende veröffentlicht – Schätzwert, im Formular änderbar
    chfKurs: 1.07,
    chfKursVorlaeufig: true,
  },
};

/** Grenzgänger Schweiz (Art. 15a DBA Deutschland–Schweiz) */
export const SCHWEIZ = {
  /** Höchstsatz der Schweizer Quellensteuer für Grenzgänger, anrechenbar in Deutschland */
  quellensteuerMax: 0.045,
  /** Arbeitnehmeranteil AHV/IV/EO */
  ahvSatz: 0.053,
  /** Arbeitnehmeranteil ALV bis zum Höchstlohn */
  alvSatz: 0.011,
  alvHoechstlohn: 148_200,
  /** Höchstbetrag sonstige Vorsorge, wenn Krankenversicherung ohne steuerfreien Zuschuss selbst getragen wird (§ 10 Abs. 4 EStG) */
  sonstigeVorsorgeOhneZuschuss: 2_800,
  /** Mehr Nichtrückkehrtage → keine Grenzgängereigenschaft */
  maxNichtrueckkehrtage: 60,
};

/** Behinderten-Pauschbetrag nach § 33b Abs. 3 EStG (seit 2021). */
export const BEHINDERTEN_PAUSCHBETRAG: Record<number, number> = {
  20: 384,
  30: 620,
  40: 860,
  50: 1_140,
  60: 1_440,
  70: 1_780,
  80: 2_120,
  90: 2_460,
  100: 2_840,
};
/** Für Merkzeichen H, Bl, TBl */
export const BEHINDERTEN_PAUSCHBETRAG_HILFLOS = 7_400;

/** § 35a EStG – Steuerermäßigung, jahresunabhängig */
export const PARAGRAPH_35A = {
  satz: 0.2,
  haushaltsnahMax: 4_000,
  handwerkerMax: 1_200,
};

/** Kirchensteuersatz je Bundesland (Bayern und Baden-Württemberg 8 %, sonst 9 %). */
export const BUNDESLAENDER = {
  BW: { name: "Baden-Württemberg", kirchensteuer: 0.08 },
  BY: { name: "Bayern", kirchensteuer: 0.08 },
  BE: { name: "Berlin", kirchensteuer: 0.09 },
  BB: { name: "Brandenburg", kirchensteuer: 0.09 },
  HB: { name: "Bremen", kirchensteuer: 0.09 },
  HH: { name: "Hamburg", kirchensteuer: 0.09 },
  HE: { name: "Hessen", kirchensteuer: 0.09 },
  MV: { name: "Mecklenburg-Vorpommern", kirchensteuer: 0.09 },
  NI: { name: "Niedersachsen", kirchensteuer: 0.09 },
  NW: { name: "Nordrhein-Westfalen", kirchensteuer: 0.09 },
  RP: { name: "Rheinland-Pfalz", kirchensteuer: 0.09 },
  SL: { name: "Saarland", kirchensteuer: 0.09 },
  SN: { name: "Sachsen", kirchensteuer: 0.09 },
  ST: { name: "Sachsen-Anhalt", kirchensteuer: 0.09 },
  SH: { name: "Schleswig-Holstein", kirchensteuer: 0.09 },
  TH: { name: "Thüringen", kirchensteuer: 0.09 },
} as const;
export type Bundesland = keyof typeof BUNDESLAENDER;
