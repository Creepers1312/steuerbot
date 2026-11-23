import { z } from "zod";
import { BUNDESLAENDER, type Bundesland } from "./params";

const euro = z.number().min(0).max(10_000_000);
const bundeslaender = Object.keys(BUNDESLAENDER) as [Bundesland, ...Bundesland[]];

/*
 * Felddefinitionen OHNE Standardwerte. Daraus entstehen
 *  - die vollständigen Schemas (fehlende Felder → Standardwert) und
 *  - die Änderungs-Schemas für den Assistenten (fehlende Felder → bleiben unverändert).
 * Die Beschreibungen landen im Werkzeug-Schema, das Claude sieht.
 */

export const PersonFields = z.object({
  name: z.string().max(60).describe("Vorname zur Anzeige"),
  kirchenmitglied: z.boolean(),
  bruttolohn: euro.describe("Lohnsteuerbescheinigung Zeile 3: Bruttoarbeitslohn"),
  lohnsteuer: euro.describe("Zeile 4: einbehaltene Lohnsteuer"),
  soliEinbehalten: euro.describe("Zeile 5: einbehaltener Solidaritätszuschlag"),
  kirchensteuerEinbehalten: euro.describe("Zeile 6 + 7: einbehaltene Kirchensteuer"),
  rvArbeitnehmer: euro.describe("Zeile 23a: Arbeitnehmeranteil Rentenversicherung"),
  rvArbeitgeber: euro.describe("Zeile 22a: Arbeitgeberanteil Rentenversicherung"),
  kvArbeitnehmer: euro.describe("Zeile 25: Arbeitnehmerbeiträge Krankenversicherung"),
  pvArbeitnehmer: euro.describe("Zeile 26: Arbeitnehmerbeiträge Pflegeversicherung"),
  avArbeitnehmer: euro.describe("Zeile 27: Arbeitnehmerbeiträge Arbeitslosenversicherung"),
  krankengeldAnspruch: z.boolean().describe("Gesetzlich versichert mit Krankengeldanspruch (Normalfall: true)"),
  lohnersatzleistungen: euro.describe(
    "Steuerfreie Lohnersatzleistungen im Jahr: Elterngeld, Arbeitslosengeld I, Kurzarbeitergeld, Krankengeld, Mutterschaftsgeld",
  ),
  entfernungKm: z.number().min(0).max(1000).describe("Einfache Entfernung Wohnung – erste Tätigkeitsstätte in km"),
  arbeitstageBuero: z.number().int().min(0).max(366).describe("Anzahl Tage im Jahr, an denen zur Arbeitsstätte gefahren wurde"),
  mitPkw: z.boolean().describe("Arbeitsweg überwiegend mit eigenem Auto (sonst gilt der Höchstbetrag von 4.500 €)"),
  homeofficeTage: z.number().int().min(0).max(366).describe("Tage überwiegend im Homeoffice (6 €/Tag, max. 210 Tage)"),
  arbeitsmittel: euro.describe("Arbeitsmittel in € (Laptop-Anteil, Fachliteratur, Arbeitskleidung, Werkzeug)"),
  fortbildung: euro.describe("Fortbildungskosten in € (Kurse, Prüfungsgebühren, Fahrtkosten dorthin)"),
  sonstigeWerbungskosten: euro.describe("Weitere Werbungskosten in €: Bewerbung, beruflicher Umzug, Reisekosten, Arbeitszimmer u. ä."),
  kontofuehrungspauschale: z.boolean().describe("16 € Kontoführungspauschale ansetzen"),
  gewerkschaftsbeitraege: euro.describe("Gewerkschaftsbeiträge in €"),
  gradDerBehinderung: z.number().int().min(0).max(100).describe("Grad der Behinderung (0, 20, 30 … 100)"),
  merkzeichenHilflos: z.boolean().describe("Merkzeichen H, Bl oder TBl im Schwerbehindertenausweis"),

  // --- Grenzgänger Schweiz (Beträge laut Schweizer Lohnausweis in CHF) ---
  arbeitsland: z
    .enum(["DE", "CH"])
    .describe("DE = Arbeitgeber in Deutschland (Lohnsteuerbescheinigung); CH = Grenzgänger in die Schweiz (Wohnsitz Deutschland, tägliche Rückkehr)"),
  chBruttolohn: euro.describe("Schweizer Lohnausweis Ziffer 8: Bruttolohn in CHF"),
  chZiffer9: euro.describe("Lohnausweis Ziffer 9: Beiträge AHV/IV/EO/ALV/NBUV in CHF"),
  chBvg: euro.describe("Lohnausweis Ziffer 10: Beiträge berufliche Vorsorge (Pensionskasse) in CHF"),
  chBvgUeberobligatorisch: euro.describe("Davon überobligatorischer Anteil der Pensionskassenbeiträge in CHF (laut Pensionskassenausweis, sonst 0)"),
  chQuellensteuer: euro.describe("Lohnausweis Ziffer 12: einbehaltene Schweizer Quellensteuer in CHF"),
  chKvgPraemie: euro.describe("Nur bei Schweizer Krankenversicherung (KVG): Jahresprämie in CHF"),
  nichtrueckkehrtage: z.number().int().min(0).max(366).describe("Arbeitstage, an denen aus beruflichen Gründen nicht nach Hause zurückgekehrt wurde"),
});

const PERSON_DEFAULTS: z.infer<typeof PersonFields> = {
  name: "",
  kirchenmitglied: false,
  bruttolohn: 0,
  lohnsteuer: 0,
  soliEinbehalten: 0,
  kirchensteuerEinbehalten: 0,
  rvArbeitnehmer: 0,
  rvArbeitgeber: 0,
  kvArbeitnehmer: 0,
  pvArbeitnehmer: 0,
  avArbeitnehmer: 0,
  krankengeldAnspruch: true,
  lohnersatzleistungen: 0,
  entfernungKm: 0,
  arbeitstageBuero: 0,
  mitPkw: true,
  homeofficeTage: 0,
  arbeitsmittel: 0,
  fortbildung: 0,
  sonstigeWerbungskosten: 0,
  kontofuehrungspauschale: true,
  gewerkschaftsbeitraege: 0,
  gradDerBehinderung: 0,
  merkzeichenHilflos: false,
  arbeitsland: "DE",
  chBruttolohn: 0,
  chZiffer9: 0,
  chBvg: 0,
  chBvgUeberobligatorisch: 0,
  chQuellensteuer: 0,
  chKvgPraemie: 0,
  nichtrueckkehrtage: 0,
};

const KindFields = z.object({
  name: z.string().max(60),
  monate: z.number().int().min(0).max(12).describe("Monate im Jahr mit Kindergeldanspruch (Geburt/Ausbildungsende anteilig)"),
  vollerFreibetrag: z
    .boolean()
    .describe("Nur bei Einzelveranlagung: voller Kinderfreibetrag, weil der andere Elternteil ausfällt (sonst halber)"),
});

const KIND_DEFAULTS: z.infer<typeof KindFields> = { name: "", monate: 12, vollerFreibetrag: false };

export const HaushaltFields = z.object({
  jahr: z.union([z.literal(2025), z.literal(2026)]).describe("Steuerjahr"),
  bundesland: z.enum(bundeslaender).describe("Bundesland (bestimmt den Kirchensteuersatz)"),
  zusammenveranlagung: z.boolean().describe("Verheiratet / eingetragene Lebenspartnerschaft mit gemeinsamer Erklärung"),
  alleinerziehend: z.boolean().describe("Nur Einzelveranlagung: alleinerziehend mit Kind im Haushalt"),
  spenden: euro.describe("Spenden und Mitgliedsbeiträge an gemeinnützige Organisationen/Parteien in €"),
  weitereKirchensteuer: euro.describe("Kirchensteuer-Nachzahlungen, die nicht über den Lohn einbehalten wurden"),
  kinderbetreuungskosten: euro.describe("Kinderbetreuung (Kita, Tagesmutter, Hort) für Kinder unter 14 in €, ohne Verpflegung"),
  krankheitskosten: euro.describe("Selbst getragene Krankheitskosten in € (Zuzahlungen, Brille, Zahnersatz) nach Erstattung"),
  haushaltsnaheDienstleistungen: euro.describe(
    "Haushaltsnahe Dienstleistungen in € (Reinigung, Gartenpflege, Hausmeister, Treppenhaus – auch aus der Nebenkostenabrechnung)",
  ),
  handwerkerLohnkosten: euro.describe("Nur Arbeits- und Fahrtkosten aus Handwerkerrechnungen in € (ohne Material), per Überweisung bezahlt"),
  vorauszahlungen: euro.describe("An das Finanzamt geleistete Einkommensteuer-Vorauszahlungen im Jahr (inkl. Soli/Kirchensteuer) in € – typisch bei Grenzgängern"),
  chfKurs: z.number().min(0).max(5).describe("Eigener Umrechnungskurs Euro je CHF; 0 = amtlicher Jahreskurs"),
});

const HAUSHALT_DEFAULTS: z.infer<typeof HaushaltFields> = {
  jahr: 2026,
  bundesland: "NW",
  zusammenveranlagung: false,
  alleinerziehend: false,
  spenden: 0,
  weitereKirchensteuer: 0,
  kinderbetreuungskosten: 0,
  krankheitskosten: 0,
  haushaltsnaheDienstleistungen: 0,
  handwerkerLohnkosten: 0,
  vorauszahlungen: 0,
  chfKurs: 0,
};

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const PersonSchema = PersonFields.partial().transform((v) => ({ ...PERSON_DEFAULTS, ...stripUndefined(v) }));
export const KindSchema = KindFields.partial().transform((v) => ({ ...KIND_DEFAULTS, ...stripUndefined(v) }));

export const TaxInputSchema = HaushaltFields.partial()
  .extend({
    personen: z.array(PersonSchema).min(1).max(2),
    kinder: z.array(KindSchema).max(10).optional(),
  })
  .transform(({ personen, kinder, ...rest }) => ({
    ...HAUSHALT_DEFAULTS,
    ...stripUndefined(rest),
    personen,
    kinder: kinder ?? [],
  }));

export type Person = z.output<typeof PersonSchema>;
export type Kind = z.output<typeof KindSchema>;
export type TaxInput = z.output<typeof TaxInputSchema>;

export function parseTaxInput(raw: unknown): TaxInput {
  const input = TaxInputSchema.parse(raw);
  if (input.zusammenveranlagung && input.personen.length === 1) {
    input.personen.push(PersonSchema.parse({ name: "Partner:in" }));
  }
  return input;
}

export function defaultInput(): TaxInput {
  return parseTaxInput({ personen: [{ name: "Ich" }] });
}

export { PERSON_DEFAULTS, HAUSHALT_DEFAULTS };
