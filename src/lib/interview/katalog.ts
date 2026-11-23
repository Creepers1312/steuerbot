/**
 * Fragenkatalog für den geführten Fragebogen (ohne KI).
 *
 * Jede Frage beschreibt: Text, Bedingung (wenn), aktuellen Wert und wie die Antwort
 * in den Datenstand geschrieben wird. Antworten überschreiben Werte (statt zu addieren),
 * damit eine Frage beliebig oft neu beantwortet werden kann.
 */
import { applyPatch, type Patch } from "../assistant/patch";
import { belegZuPatch } from "../assistant/beleg-mapping";
import { hochrechnen, sonderzahlungAufschlagen } from "../tax/hochrechnung";
import { BUNDESLAENDER } from "../tax/params";
import { KindSchema, type Person, type TaxInput } from "../tax/schema";
import type { Ctx, Frage } from "./typen";

const WOCHEN = 46; // Arbeitswochen pro Jahr (abzüglich Urlaub und Feiertage)

// ---------- Hilfsfunktionen ----------
const person = (c: Ctx): Person => c.input.personen[c.p] ?? c.input.personen[0];
const name = (c: Ctx) => person(c).name || (c.p === 0 ? "du" : "dein:e Partner:in");
/** Du-Form für Person 1, sonst Form mit Namen. */
const du = (c: Ctx, duForm: string, andere: string) => (c.p === 0 ? duForm : andere.replaceAll("{name}", name(c)));
const setP = (c: Ctx, felder: Partial<Person>): TaxInput => applyPatch(c.input, { personen: [{ index: c.p, felder }] });
const setH = (c: Ctx, allgemein: NonNullable<Patch["allgemein"]>): TaxInput => applyPatch(c.input, { allgemein });
/** Antwort zur selben Person / zum selben Kind (oder global) lesen. */
export const antwort = (c: Ctx, id: string): unknown =>
  (c.antworten[`${id}@p${c.p}`] ?? c.antworten[`${id}@k${c.k}`] ?? c.antworten[id])?.wert;
const hatLohn = (c: Ctx) => antwort(c, "lohn_quelle") !== "keiner" && (person(c).bruttolohn > 0 || antwort(c, "lohn_quelle") !== undefined);
const eur = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 2 })} €`;

const LSTB_FELDER = [
  { key: "bruttolohn", label: "Bruttoarbeitslohn (Zeile 3)", einheit: "€" },
  { key: "lohnsteuer", label: "Lohnsteuer (Zeile 4)", einheit: "€" },
  { key: "soliEinbehalten", label: "Solidaritätszuschlag (Zeile 5)", einheit: "€" },
  { key: "kirchensteuerEinbehalten", label: "Kirchensteuer (Zeile 6/7)", einheit: "€" },
  { key: "rvArbeitgeber", label: "Rente Arbeitgeber (Zeile 22a)", einheit: "€" },
  { key: "rvArbeitnehmer", label: "Rente Arbeitnehmer (Zeile 23a)", einheit: "€" },
  { key: "kvArbeitnehmer", label: "Krankenversicherung (Zeile 25)", einheit: "€" },
  { key: "pvArbeitnehmer", label: "Pflegeversicherung (Zeile 26)", einheit: "€" },
  { key: "avArbeitnehmer", label: "Arbeitslosenversicherung (Zeile 27)", einheit: "€" },
];

const ABRECHNUNG_FELDER = [
  { key: "monat", label: "Abrechnungsmonat (1–12)", ganzzahl: true },
  { key: "brutto", label: "Steuerbrutto im Monat", einheit: "€" },
  { key: "lohnsteuer", label: "Lohnsteuer im Monat", einheit: "€" },
  { key: "soli", label: "Solidaritätszuschlag", einheit: "€" },
  { key: "kirchensteuer", label: "Kirchensteuer", einheit: "€" },
  { key: "rv", label: "Rentenversicherung (AN)", einheit: "€" },
  { key: "kv", label: "Krankenversicherung (AN)", einheit: "€" },
  { key: "pv", label: "Pflegeversicherung (AN)", einheit: "€" },
  { key: "av", label: "Arbeitslosenversicherung (AN)", einheit: "€" },
];

/** Betrag aus einem Beleg: bevorzugt Lohnanteil (Handwerker/Haushalt), sonst Gesamtbetrag. */
const lohnOderGesamt = (b: { lohnkostenAnteil: number | null; betragGesamt: number | null }) => b.lohnkostenAnteil ?? b.betragGesamt;
const gesamt = (b: { betragGesamt: number | null }) => b.betragGesamt;

export const KATALOG: Frage[] = [
  // =========================== Allgemein ===========================
  {
    id: "jahr",
    kapitel: "allgemein",
    typ: "auswahl",
    text: () => "Für welches Jahr möchtest du deine Erstattung ausrechnen?",
    erklaerung:
      "Die Steuererklärung machst du immer für ein abgeschlossenes Jahr. Für das laufende Jahr gibt es noch keine Lohnsteuerbescheinigung – wir können aber aus deiner Gehaltsabrechnung hochrechnen.",
    optionen: () => [
      { wert: "2025", label: "2025" },
      { wert: "2026", label: "2026" },
    ],
    aktuell: (c) => String(c.input.jahr),
    anwenden: (w, c) => setH(c, { jahr: Number(w) as 2025 | 2026 }),
  },
  {
    id: "bundesland",
    kapitel: "allgemein",
    typ: "auswahl",
    liste: true,
    text: () => "In welchem Bundesland wohnst du?",
    erklaerung: "Das Bundesland bestimmt den Kirchensteuersatz (8 % in Bayern und Baden-Württemberg, sonst 9 %).",
    optionen: () => Object.entries(BUNDESLAENDER).map(([wert, v]) => ({ wert, label: v.name })),
    aktuell: (c) => c.input.bundesland,
    anwenden: (w, c) => setH(c, { bundesland: w as TaxInput["bundesland"] }),
  },
  {
    id: "verheiratet",
    kapitel: "allgemein",
    typ: "janein",
    text: () => "Bist du verheiratet (oder in eingetragener Lebenspartnerschaft) und wollt ihr die Erklärung gemeinsam machen?",
    erklaerung:
      "Bei der gemeinsamen Erklärung (Zusammenveranlagung) wird das Einkommen beider zusammengerechnet und halbiert besteuert (Splitting). Das lohnt sich fast immer, besonders wenn ihr unterschiedlich viel verdient.",
    aktuell: (c) => c.input.zusammenveranlagung,
    anwenden: (ja, c) => setH(c, { zusammenveranlagung: ja, ...(ja ? { alleinerziehend: false } : {}) }),
  },
  {
    id: "name",
    kapitel: "allgemein",
    scope: "person",
    typ: "text",
    text: (c) => (c.p === 0 ? "Wie heißt du? (Nur zur Anzeige)" : "Und wie heißt dein:e Partner:in?"),
    platzhalter: "Vorname",
    aktuell: (c) => (["Ich", "Partner:in"].includes(person(c).name) ? "" : person(c).name),
    anwenden: (t, c) => setP(c, { name: t.trim() || (c.p === 0 ? "Ich" : "Partner:in") }),
  },
  {
    id: "kirche",
    kapitel: "allgemein",
    scope: "person",
    typ: "janein",
    text: (c) => du(c, "Bist du Mitglied einer Kirche, die Kirchensteuer erhebt?", "Ist {name} Kirchenmitglied?"),
    erklaerung: "Kirchensteuer wird über den Lohn abgezogen. Was du gezahlt hast, ist als Sonderausgabe absetzbar.",
    aktuell: (c) => person(c).kirchenmitglied,
    anwenden: (ja, c) => setP(c, { kirchenmitglied: ja }),
  },

  // =========================== Lohn ===========================
  {
    id: "lohn_quelle",
    kapitel: "lohn",
    scope: "person",
    typ: "auswahl",
    text: (c) =>
      du(
        c,
        `Hast du schon deine Lohnsteuerbescheinigung für ${c.input.jahr}?`,
        `Hat {name} schon die Lohnsteuerbescheinigung für ${c.input.jahr}?`,
      ),
    erklaerung:
      "Die Lohnsteuerbescheinigung schickt dir dein Arbeitgeber bis Ende Februar des Folgejahres (oft mit der Dezember- oder Januarabrechnung). Darauf stehen Bruttolohn, gezahlte Lohnsteuer und Sozialversicherung.",
    optionen: (c) => [
      { wert: "lstb", label: "📄 Ja, habe ich" },
      { wert: "abrechnung", label: "🧾 Nein, nur Gehaltsabrechnung" },
      { wert: "keiner", label: c.p === 0 ? "Ich hatte keinen Arbeitslohn" : "Kein Arbeitslohn" },
    ],
    aktuell: (c) => (antwort(c, "lohn_quelle") as string | undefined) ?? undefined,
    anwenden: (w, c) =>
      w === "keiner"
        ? setP(c, Object.fromEntries(LSTB_FELDER.map((f) => [f.key, 0])) as Partial<Person>)
        : c.input,
  },
  {
    id: "lstb",
    kapitel: "lohn",
    scope: "person",
    typ: "dokument",
    wenn: (c) => antwort(c, "lohn_quelle") === "lstb",
    text: (c) => du(c, "Super! Fotografiere die Lohnsteuerbescheinigung oder tippe die Werte ab.", "Dann die Lohnsteuerbescheinigung von {name}, bitte."),
    belegHinweis: "Lohnsteuerbescheinigung",
    felder: LSTB_FELDER,
    aktuell: (c) => Object.fromEntries(LSTB_FELDER.map((f) => [f.key, person(c)[f.key as keyof Person] as number])),
    manuellAnwenden: (werte, c) => setP(c, { ...werte, kirchenmitglied: person(c).kirchenmitglied || (werte.kirchensteuerEinbehalten ?? 0) > 0 }),
    belegAnwenden: (b, c) => {
      if (b.belegart !== "lohnsteuerbescheinigung") return null;
      const v = belegZuPatch(b, c.input, c.p);
      return v.patch ? { input: applyPatch(c.input, v.patch), text: v.text } : null;
    },
  },
  {
    id: "abrechnung",
    kapitel: "lohn",
    scope: "person",
    typ: "dokument",
    wenn: (c) => antwort(c, "lohn_quelle") === "abrechnung",
    text: (c) =>
      du(
        c,
        "Kein Problem – dann rechnen wir aus deiner letzten Gehaltsabrechnung aufs Jahr hoch. Foto oder Werte des Monats eintippen:",
        "Dann die letzte Gehaltsabrechnung von {name}:",
      ),
    erklaerung:
      "Am genauesten sind die „Jahressummen“ bzw. „kumulierten Werte“, die viele Abrechnungen ausweisen – die erkennt das Foto automatisch. Beim Eintippen nehmen wir die Monatswerte × 12.",
    belegHinweis: "Gehaltsabrechnung",
    felder: ABRECHNUNG_FELDER,
    aktuell: () => ({ monat: new Date().getMonth() + 1 }),
    manuellAnwenden: (w, c) =>
      setP(
        c,
        hochrechnen(
          {
            modus: "monat",
            monat: Math.min(12, Math.max(1, Math.round(w.monat || 12))),
            brutto: w.brutto ?? 0,
            lohnsteuer: w.lohnsteuer ?? 0,
            soli: w.soli ?? 0,
            kirchensteuer: w.kirchensteuer ?? 0,
            rv: w.rv ?? 0,
            kv: w.kv ?? 0,
            pv: w.pv ?? 0,
            av: w.av ?? 0,
            einmalzahlungBrutto: 0,
          },
          c.input.jahr,
        ),
      ),
    belegAnwenden: (b, c) => {
      if (b.belegart !== "gehaltsabrechnung") return null;
      const v = belegZuPatch(b, c.input, c.p);
      return v.patch ? { input: applyPatch(c.input, v.patch), text: v.text } : null;
    },
  },
  {
    id: "sonderzahlung",
    kapitel: "lohn",
    scope: "person",
    typ: "zahl",
    einheit: "€",
    wenn: (c) => antwort(c, "lohn_quelle") === "abrechnung",
    text: (c) =>
      du(
        c,
        "Bekommst du dieses Jahr noch Weihnachtsgeld oder einen Bonus, der in der Abrechnung noch nicht enthalten ist? (brutto, sonst 0)",
        "Bekommt {name} noch Weihnachtsgeld oder einen Bonus? (brutto, sonst 0)",
      ),
    vorschlaege: [0],
    aktuell: (c) => (antwort(c, "sonderzahlung") as number | undefined) ?? 0,
    anwenden: (n, c) => {
      const vorher = (antwort(c, "sonderzahlung") as number | undefined) ?? 0;
      const p = person(c);
      return setP(c, sonderzahlungAufschlagen(p, n - vorher, c.input.jahr));
    },
  },
  {
    id: "lohnersatz",
    kapitel: "lohn",
    scope: "person",
    typ: "janein",
    text: (c) =>
      du(
        c,
        "Hast du Elterngeld, Arbeitslosengeld, Kurzarbeitergeld oder Krankengeld bekommen?",
        "Hat {name} Elterngeld, Arbeitslosengeld, Kurzarbeitergeld oder Krankengeld bekommen?",
      ),
    erklaerung:
      "Diese Leistungen sind steuerfrei, erhöhen aber den Steuersatz auf dein übriges Einkommen (Progressionsvorbehalt). Ab 410 € musst du deshalb eine Steuererklärung abgeben – oft gibt es eine Nachzahlung.",
    aktuell: (c) => (person(c).lohnersatzleistungen > 0 ? true : undefined),
    anwenden: (ja, c) => (ja ? c.input : setP(c, { lohnersatzleistungen: 0 })),
  },
  {
    id: "lohnersatz_betrag",
    kapitel: "lohn",
    scope: "person",
    typ: "zahl",
    einheit: "€",
    wenn: (c) => antwort(c, "lohnersatz") === true,
    text: () => "Wie viel war das insgesamt im Jahr?",
    erklaerung: "Steht im Bescheid der Elterngeldstelle bzw. Arbeitsagentur oder in Zeile 15 der Lohnsteuerbescheinigung (Kurzarbeitergeld).",
    aktuell: (c) => person(c).lohnersatzleistungen,
    anwenden: (n, c) => setP(c, { lohnersatzleistungen: n }),
  },

  // =========================== Arbeit / Werbungskosten ===========================
  {
    id: "weg_art",
    kapitel: "werbungskosten",
    scope: "person",
    typ: "auswahl",
    wenn: hatLohn,
    text: (c) => du(c, "Wie kommst du meistens zur Arbeit?", "Wie kommt {name} meistens zur Arbeit?"),
    erklaerung:
      "Für jeden Arbeitstag gibt es die Entfernungspauschale – egal ob Auto, Bahn oder Fahrrad. 2026: 38 Cent pro Kilometer einfache Strecke ab dem ersten Kilometer.",
    optionen: () => [
      { wert: "auto", label: "🚗 Auto" },
      { wert: "oepnv", label: "🚆 Bus & Bahn" },
      { wert: "rad", label: "🚲 Fahrrad / zu Fuß" },
      { wert: "homeoffice", label: "🏠 Nur Homeoffice" },
    ],
    aktuell: (c) => (antwort(c, "weg_art") as string | undefined) ?? undefined,
    anwenden: (w, c) =>
      w === "homeoffice" ? setP(c, { entfernungKm: 0, arbeitstageBuero: 0 }) : setP(c, { mitPkw: w === "auto" }),
  },
  {
    id: "km",
    kapitel: "werbungskosten",
    scope: "person",
    typ: "zahl",
    einheit: "km",
    wenn: (c) => hatLohn(c) && !!antwort(c, "weg_art") && antwort(c, "weg_art") !== "homeoffice",
    text: () => "Wie weit ist es von der Wohnung zur Arbeit? (einfache Strecke, kürzeste Straßenverbindung)",
    aktuell: (c) => person(c).entfernungKm,
    anwenden: (n, c) => setP(c, { entfernungKm: n }),
  },
  {
    id: "buerotage",
    kapitel: "werbungskosten",
    scope: "person",
    typ: "zahl",
    einheit: "Tage/Woche",
    ganzzahl: true,
    max: 7,
    vorschlaege: [1, 2, 3, 4, 5],
    wenn: (c) => hatLohn(c) && !!antwort(c, "weg_art") && antwort(c, "weg_art") !== "homeoffice",
    text: () => "An wie vielen Tagen pro Woche bist du normalerweise hingefahren?",
    erklaerung: `Wir rechnen mit ${WOCHEN} Arbeitswochen im Jahr (Urlaub und Feiertage sind schon abgezogen). Die genaue Zahl kannst du später unter „Angaben“ eintragen.`,
    aktuell: (c) => Math.round(person(c).arbeitstageBuero / WOCHEN),
    anwenden: (n, c) => setP(c, { arbeitstageBuero: Math.round(n * WOCHEN) }),
  },
  {
    id: "homeoffice",
    kapitel: "werbungskosten",
    scope: "person",
    typ: "zahl",
    einheit: "Tage/Woche",
    ganzzahl: true,
    max: 7,
    vorschlaege: [0, 1, 2, 3, 5],
    wenn: (c) => hatLohn(c) && !!antwort(c, "weg_art"),
    text: (c) =>
      antwort(c, "weg_art") === "homeoffice"
        ? "An wie vielen Tagen pro Woche hast du im Homeoffice gearbeitet?"
        : "Und an wie vielen Tagen pro Woche warst du im Homeoffice?",
    erklaerung: "Für jeden Homeoffice-Tag gibt es 6 € (höchstens 210 Tage = 1.260 € im Jahr) – ein eigenes Arbeitszimmer ist nicht nötig.",
    aktuell: (c) => Math.round(person(c).homeofficeTage / WOCHEN),
    anwenden: (n, c) => setP(c, { homeofficeTage: Math.min(210, Math.round(n * WOCHEN)) }),
  },
  {
    id: "arbeitsmittel",
    kapitel: "werbungskosten",
    scope: "person",
    typ: "janein",
    wenn: hatLohn,
    text: (c) =>
      du(
        c,
        "Hast du Dinge für die Arbeit selbst bezahlt? Zum Beispiel Laptop, Handy (anteilig), Fachbücher, Arbeitskleidung oder Werkzeug.",
        "Hat {name} Arbeitsmittel selbst bezahlt (Laptop, Fachbücher, Arbeitskleidung …)?",
      ),
    erklaerung: "Bis 952 € (inkl. MwSt.) pro Gegenstand sofort absetzbar. Computer und Software immer sofort. Privat mitgenutzte Geräte nur anteilig (z. B. 50 %).",
    aktuell: (c) => (person(c).arbeitsmittel > 0 ? true : undefined),
    anwenden: (ja, c) => (ja ? c.input : setP(c, { arbeitsmittel: 0 })),
  },
  {
    id: "arbeitsmittel_belege",
    kapitel: "werbungskosten",
    scope: "person",
    typ: "sammeln",
    wenn: (c) => antwort(c, "arbeitsmittel") === true,
    text: () => "Lade die Rechnungen hoch – oder trag einfach die Summe ein.",
    belegHinweis: "Rechnung für Arbeitsmittel",
    manuellLabel: "Summe Arbeitsmittel",
    betragAusBeleg: gesamt,
    aktuell: (c) => person(c).arbeitsmittel,
    anwenden: (s, c) => setP(c, { arbeitsmittel: s }),
  },
  {
    id: "fortbildung",
    kapitel: "werbungskosten",
    scope: "person",
    typ: "janein",
    wenn: hatLohn,
    text: (c) => du(c, "Hast du eine berufliche Fortbildung, einen Kurs oder ein Studium selbst bezahlt?", "Hat {name} eine Fortbildung selbst bezahlt?"),
    aktuell: (c) => (person(c).fortbildung > 0 ? true : undefined),
    anwenden: (ja, c) => (ja ? c.input : setP(c, { fortbildung: 0 })),
  },
  {
    id: "fortbildung_betrag",
    kapitel: "werbungskosten",
    scope: "person",
    typ: "sammeln",
    wenn: (c) => antwort(c, "fortbildung") === true,
    text: () => "Was hat die Fortbildung gekostet? (Gebühren, Material, Fahrtkosten dorthin)",
    belegHinweis: "Rechnung der Fortbildung",
    manuellLabel: "Kosten Fortbildung",
    betragAusBeleg: gesamt,
    aktuell: (c) => person(c).fortbildung,
    anwenden: (s, c) => setP(c, { fortbildung: s }),
  },
  {
    id: "gewerkschaft",
    kapitel: "werbungskosten",
    scope: "person",
    typ: "zahl",
    einheit: "€/Jahr",
    vorschlaege: [0],
    wenn: hatLohn,
    text: (c) => du(c, "Zahlst du Gewerkschafts- oder Berufsverbandsbeiträge? Wie viel im Jahr? (sonst 0)", "Zahlt {name} Gewerkschaftsbeiträge? Wie viel im Jahr?"),
    erklaerung: "Ab 2026 zählen Gewerkschaftsbeiträge zusätzlich zum Arbeitnehmer-Pauschbetrag von 1.230 €.",
    aktuell: (c) => person(c).gewerkschaftsbeitraege,
    anwenden: (n, c) => setP(c, { gewerkschaftsbeitraege: n }),
  },
  {
    id: "sonstige_wk",
    kapitel: "werbungskosten",
    scope: "person",
    typ: "zahl",
    einheit: "€",
    vorschlaege: [0],
    wenn: hatLohn,
    text: () => "Gab es sonst noch berufliche Kosten? Bewerbungen, beruflicher Umzug, Dienstreisen ohne Erstattung … (Summe, sonst 0)",
    aktuell: (c) => person(c).sonstigeWerbungskosten,
    anwenden: (n, c) => setP(c, { sonstigeWerbungskosten: n }),
  },

  // =========================== Familie ===========================
  {
    id: "kinder",
    kapitel: "familie",
    typ: "zahl",
    einheit: "Kinder",
    ganzzahl: true,
    max: 10,
    vorschlaege: [0, 1, 2, 3],
    text: () => "Für wie viele Kinder bekommst du Kindergeld?",
    erklaerung: "Kindergeld gibt es bis 18, in Ausbildung oder Studium bis 25. Das Finanzamt prüft automatisch, ob der Kinderfreibetrag für dich günstiger ist.",
    aktuell: (c) => c.input.kinder.length,
    anwenden: (n, c) => {
      const kinder = Array.from({ length: n }, (_, i) => c.input.kinder[i] ?? KindSchema.parse({ name: `Kind ${i + 1}` }));
      return applyPatch(c.input, { kinder });
    },
  },
  {
    id: "kinder_ganzjahr",
    kapitel: "familie",
    typ: "janein",
    wenn: (c) => c.input.kinder.length > 0,
    text: (c) => (c.input.kinder.length > 1 ? "Gab es für alle Kinder das ganze Jahr Kindergeld?" : "Gab es das ganze Jahr Kindergeld?"),
    erklaerung: "Nein z. B. bei Geburt im Laufe des Jahres oder wenn die Ausbildung endete.",
    anwenden: (ja, c) => (ja ? applyPatch(c.input, { kinder: c.input.kinder.map((k) => ({ ...k, monate: 12 })) }) : c.input),
  },
  {
    id: "kind_monate",
    kapitel: "familie",
    scope: "kind",
    typ: "zahl",
    einheit: "Monate",
    ganzzahl: true,
    max: 12,
    wenn: (c) => antwort(c, "kinder_ganzjahr") === false,
    text: (c) => `Für wie viele Monate gab es Kindergeld für ${c.input.kinder[c.k]?.name || `Kind ${c.k + 1}`}?`,
    aktuell: (c) => c.input.kinder[c.k]?.monate ?? 12,
    anwenden: (n, c) => applyPatch(c.input, { kinder: c.input.kinder.map((k, i) => (i === c.k ? { ...k, monate: n } : k)) }),
  },
  {
    id: "alleinerziehend",
    kapitel: "familie",
    typ: "janein",
    wenn: (c) => !c.input.zusammenveranlagung && c.input.kinder.length > 0,
    text: () => "Bist du alleinerziehend – also lebt kein anderer Erwachsener mit in deiner Wohnung?",
    erklaerung: "Alleinerziehende bekommen einen Entlastungsbetrag von 4.260 € (+ 240 € für jedes weitere Kind).",
    aktuell: (c) => c.input.alleinerziehend,
    anwenden: (ja, c) => setH(c, { alleinerziehend: ja }),
  },
  {
    id: "kita",
    kapitel: "familie",
    typ: "janein",
    wenn: (c) => c.input.kinder.length > 0,
    text: () => "Habt ihr für Kita, Tagesmutter, Hort oder Babysitter (mit Rechnung) bezahlt? (Kinder unter 14)",
    erklaerung: "80 % der Betreuungskosten sind absetzbar, bis 4.800 € pro Kind. Essensgeld zählt nicht. Bezahlung per Überweisung nötig.",
    aktuell: (c) => (c.input.kinderbetreuungskosten > 0 ? true : undefined),
    anwenden: (ja, c) => (ja ? c.input : setH(c, { kinderbetreuungskosten: 0 })),
  },
  {
    id: "kita_belege",
    kapitel: "familie",
    typ: "sammeln",
    wenn: (c) => antwort(c, "kita") === true,
    text: () => "Lade die Jahresbescheinigung der Kita hoch – oder trag die Summe ein (ohne Essensgeld).",
    belegHinweis: "Kita-Beitragsbescheinigung",
    manuellLabel: "Betreuungskosten im Jahr",
    betragAusBeleg: gesamt,
    aktuell: (c) => c.input.kinderbetreuungskosten,
    anwenden: (s, c) => setH(c, { kinderbetreuungskosten: s }),
  },

  // =========================== Wohnen ===========================
  {
    id: "handwerker",
    kapitel: "wohnen",
    typ: "janein",
    text: () => "Waren Handwerker bei dir zu Hause? Reparatur, Renovierung, Wartung der Heizung, Schornsteinfeger …",
    erklaerung:
      "20 % der Arbeits- und Fahrtkosten (nicht Material) werden direkt von der Steuer abgezogen – bis 1.200 € im Jahr. Gilt auch für Mieter. Die Rechnung muss überwiesen worden sein.",
    aktuell: (c) => (c.input.handwerkerLohnkosten > 0 ? true : undefined),
    anwenden: (ja, c) => (ja ? c.input : setH(c, { handwerkerLohnkosten: 0 })),
  },
  {
    id: "handwerker_belege",
    kapitel: "wohnen",
    typ: "sammeln",
    wenn: (c) => antwort(c, "handwerker") === true,
    text: () => "Lade die Handwerkerrechnungen hoch – ich lese die Arbeitskosten aus. Oder trag die Summe der Arbeitskosten ein.",
    belegHinweis: "Handwerkerrechnung",
    manuellLabel: "Summe Arbeitskosten (ohne Material)",
    betragAusBeleg: lohnOderGesamt,
    aktuell: (c) => c.input.handwerkerLohnkosten,
    anwenden: (s, c) => setH(c, { handwerkerLohnkosten: s }),
  },
  {
    id: "haushaltsnah",
    kapitel: "wohnen",
    typ: "janein",
    text: () =>
      "Hast du eine Nebenkostenabrechnung (Miete oder Eigentum) oder hattest du eine Putzhilfe, Gärtner oder Pflegedienst mit Rechnung?",
    erklaerung:
      "In der Nebenkostenabrechnung stecken oft absetzbare Posten: Hausmeister, Treppenhausreinigung, Gartenpflege, Winterdienst. 20 % davon werden direkt von der Steuer abgezogen (bis 4.000 €).",
    aktuell: (c) => (c.input.haushaltsnaheDienstleistungen > 0 ? true : undefined),
    anwenden: (ja, c) => (ja ? c.input : setH(c, { haushaltsnaheDienstleistungen: 0 })),
  },
  {
    id: "haushaltsnah_belege",
    kapitel: "wohnen",
    typ: "sammeln",
    wenn: (c) => antwort(c, "haushaltsnah") === true,
    text: () => "Lade die Nebenkostenabrechnung oder Rechnungen hoch – oder trag die Summe der begünstigten Posten ein.",
    belegHinweis: "Nebenkostenabrechnung oder Rechnung",
    manuellLabel: "Summe haushaltsnahe Dienstleistungen",
    betragAusBeleg: lohnOderGesamt,
    aktuell: (c) => c.input.haushaltsnaheDienstleistungen,
    anwenden: (s, c) => setH(c, { haushaltsnaheDienstleistungen: s }),
  },

  // =========================== Sonstiges ===========================
  {
    id: "spenden",
    kapitel: "sonstiges",
    typ: "janein",
    text: () => "Hast du gespendet oder Mitgliedsbeiträge an Vereine (gemeinnützig) oder Parteien gezahlt?",
    erklaerung: "Bis 300 € pro Spende reicht der Kontoauszug als Nachweis, darüber brauchst du eine Zuwendungsbestätigung.",
    aktuell: (c) => (c.input.spenden > 0 ? true : undefined),
    anwenden: (ja, c) => (ja ? c.input : setH(c, { spenden: 0 })),
  },
  {
    id: "spenden_belege",
    kapitel: "sonstiges",
    typ: "sammeln",
    wenn: (c) => antwort(c, "spenden") === true,
    text: () => "Lade die Spendenquittungen hoch – oder trag die Summe ein.",
    belegHinweis: "Spendenquittung",
    manuellLabel: "Summe Spenden",
    betragAusBeleg: gesamt,
    aktuell: (c) => c.input.spenden,
    anwenden: (s, c) => setH(c, { spenden: s }),
  },
  {
    id: "krankheit",
    kapitel: "sonstiges",
    typ: "janein",
    text: () => "Hattest du größere Krankheitskosten selbst bezahlt? Brille, Zahnersatz, Zuzahlungen, Physiotherapie …",
    erklaerung:
      "Krankheitskosten wirken erst über der „zumutbaren Belastung“ – je nach Einkommen und Familie etwa 1–7 % der Einkünfte. Bei mittlerem Einkommen lohnt es sich meist erst ab ein paar hundert Euro.",
    aktuell: (c) => (c.input.krankheitskosten > 0 ? true : undefined),
    anwenden: (ja, c) => (ja ? c.input : setH(c, { krankheitskosten: 0 })),
  },
  {
    id: "krankheit_belege",
    kapitel: "sonstiges",
    typ: "sammeln",
    wenn: (c) => antwort(c, "krankheit") === true,
    text: () => "Lade die Rechnungen hoch – oder trag die Summe ein (nach Erstattung der Krankenkasse).",
    belegHinweis: "Arzt-/Apotheken-/Optikerrechnung",
    manuellLabel: "Summe Krankheitskosten",
    betragAusBeleg: gesamt,
    aktuell: (c) => c.input.krankheitskosten,
    anwenden: (s, c) => setH(c, { krankheitskosten: s }),
  },
  {
    id: "behinderung",
    kapitel: "sonstiges",
    scope: "person",
    typ: "janein",
    text: (c) => du(c, "Hast du einen Schwerbehindertenausweis oder einen Bescheid über einen Grad der Behinderung?", "Hat {name} einen Grad der Behinderung?"),
    erklaerung: "Ab einem Grad der Behinderung von 20 gibt es einen Pauschbetrag (384 € bis 2.840 €, mit Merkzeichen H/Bl 7.400 €).",
    aktuell: (c) => (person(c).gradDerBehinderung > 0 || person(c).merkzeichenHilflos ? true : undefined),
    anwenden: (ja, c) => (ja ? c.input : setP(c, { gradDerBehinderung: 0, merkzeichenHilflos: false })),
  },
  {
    id: "gdb",
    kapitel: "sonstiges",
    scope: "person",
    typ: "auswahl",
    wenn: (c) => antwort(c, "behinderung") === true,
    text: () => "Welcher Grad der Behinderung steht im Ausweis bzw. Bescheid?",
    optionen: () => [
      ...[20, 30, 40, 50, 60, 70, 80, 90, 100].map((g) => ({ wert: String(g), label: String(g) })),
      { wert: "H", label: "Merkzeichen H / Bl / TBl" },
    ],
    aktuell: (c) => (person(c).merkzeichenHilflos ? "H" : person(c).gradDerBehinderung ? String(person(c).gradDerBehinderung) : undefined),
    anwenden: (w, c) =>
      w === "H" ? setP(c, { merkzeichenHilflos: true, gradDerBehinderung: 100 }) : setP(c, { gradDerBehinderung: Number(w), merkzeichenHilflos: false }),
  },
];

export { eur as formatEuro };
