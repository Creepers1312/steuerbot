import type { Patch } from "./patch";
import type { TaxInput } from "../tax/schema";

/** Auf der Client-Seite nutzbarer Typ (gleiche Struktur wie BelegSchema). */
export interface BelegDaten {
  belegart: string;
  beschreibung: string;
  steuerjahr: number | null;
  betragGesamt: number | null;
  lohnkostenAnteil: number | null;
  lohnsteuerbescheinigung: Record<string, number | null> | null;
  unsicherheiten: string[];
}

export interface BelegVorschlag {
  text: string;
  patch: Patch | null;
}

/**
 * Wandelt einen ausgelesenen Beleg in einen Änderungsvorschlag um.
 * Beträge werden zu bestehenden Werten addiert (außer Lohnsteuerbescheinigung: ersetzt).
 */
export function belegZuPatch(b: BelegDaten, input: TaxInput, personIndex: number): BelegVorschlag {
  const p = input.personen[personIndex] ?? input.personen[0];
  const betrag = b.betragGesamt ?? 0;
  const eur = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 2 })} €`;

  switch (b.belegart) {
    case "lohnsteuerbescheinigung": {
      const l = b.lohnsteuerbescheinigung;
      if (!l) return { text: "Keine Werte erkannt.", patch: null };
      const felder: Record<string, number> = {};
      const map: Record<string, string> = {
        bruttolohn: "bruttolohn",
        lohnsteuer: "lohnsteuer",
        soli: "soliEinbehalten",
        kirchensteuer: "kirchensteuerEinbehalten",
        rvArbeitgeber: "rvArbeitgeber",
        rvArbeitnehmer: "rvArbeitnehmer",
        kvArbeitnehmer: "kvArbeitnehmer",
        pvArbeitnehmer: "pvArbeitnehmer",
        avArbeitnehmer: "avArbeitnehmer",
        lohnersatzleistungen: "lohnersatzleistungen",
      };
      for (const [src, dst] of Object.entries(map)) {
        const v = l[src];
        if (typeof v === "number") felder[dst] = v;
      }
      const kist = typeof l.kirchensteuer === "number" && l.kirchensteuer > 0;
      return {
        text: `Lohnsteuerbescheinigung: Brutto ${eur(l.bruttolohn ?? 0)}, Lohnsteuer ${eur(l.lohnsteuer ?? 0)} → ersetzt die Werte von ${p.name || "Person " + (personIndex + 1)}.`,
        patch: { personen: [{ index: personIndex, felder: { ...felder, ...(kist ? { kirchenmitglied: true } : {}) } }] },
      };
    }
    case "handwerkerrechnung": {
      const lohn = b.lohnkostenAnteil ?? 0;
      return {
        text: `Handwerkerrechnung: Lohnkostenanteil ${eur(lohn)} wird addiert (20 % davon direkt von der Steuer).`,
        patch: lohn > 0 ? { allgemein: { handwerkerLohnkosten: input.handwerkerLohnkosten + lohn } } : null,
      };
    }
    case "haushaltsnahe_dienstleistung":
    case "nebenkostenabrechnung": {
      const lohn = b.lohnkostenAnteil ?? betrag;
      return {
        text: `Haushaltsnahe Dienstleistung: ${eur(lohn)} wird addiert.`,
        patch: lohn > 0 ? { allgemein: { haushaltsnaheDienstleistungen: input.haushaltsnaheDienstleistungen + lohn } } : null,
      };
    }
    case "spendenquittung":
      return { text: `Spende: ${eur(betrag)} wird addiert.`, patch: { allgemein: { spenden: input.spenden + betrag } } };
    case "krankheitskosten":
      return {
        text: `Krankheitskosten: ${eur(betrag)} wird addiert.`,
        patch: { allgemein: { krankheitskosten: input.krankheitskosten + betrag } },
      };
    case "kinderbetreuung":
      return {
        text: `Kinderbetreuung: ${eur(betrag)} wird addiert.`,
        patch: { allgemein: { kinderbetreuungskosten: input.kinderbetreuungskosten + betrag } },
      };
    case "arbeitsmittel":
      return {
        text: `Arbeitsmittel: ${eur(betrag)} wird bei ${p.name || "Person " + (personIndex + 1)} addiert. Hinweis: über 800 € netto muss über die Nutzungsdauer abgeschrieben werden (Computer: 1 Jahr).`,
        patch: { personen: [{ index: personIndex, felder: { arbeitsmittel: p.arbeitsmittel + betrag } }] },
      };
    case "fortbildung":
      return {
        text: `Fortbildung: ${eur(betrag)} wird bei ${p.name || "Person " + (personIndex + 1)} addiert.`,
        patch: { personen: [{ index: personIndex, felder: { fortbildung: p.fortbildung + betrag } }] },
      };
    default:
      return { text: `Beleg erkannt (${b.beschreibung}), aber keiner Kategorie zugeordnet. Frag den Assistenten im Chat.`, patch: null };
  }
}
