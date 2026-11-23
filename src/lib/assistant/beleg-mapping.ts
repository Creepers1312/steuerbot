import type { Patch } from "./patch";
import type { TaxInput } from "../tax/schema";
import { hochrechnen } from "../tax/hochrechnung";

/** Auf der Client-Seite nutzbarer Typ (gleiche Struktur wie BelegSchema). */
export interface BelegDaten {
  belegart: string;
  beschreibung: string;
  steuerjahr: number | null;
  betragGesamt: number | null;
  lohnkostenAnteil: number | null;
  lohnsteuerbescheinigung: Record<string, number | null> | null;
  lohnausweisCh?: { ziffer8: number | null; ziffer9: number | null; ziffer10: number | null; ziffer12: number | null } | null;
  gehaltsabrechnung?: {
    monat: number | null;
    monatswerte: Record<string, number | null> | null;
    jahressummen: Record<string, number | null> | null;
  } | null;
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
    case "lohnausweis_ch": {
      const l = b.lohnausweisCh;
      if (!l || typeof l.ziffer8 !== "number") return { text: "Keine Werte erkannt.", patch: null };
      const chf = (n: number | null) => `${(n ?? 0).toLocaleString("de-DE")} CHF`;
      return {
        text: `Schweizer Lohnausweis: Brutto ${chf(l.ziffer8)}, Quellensteuer ${chf(l.ziffer12)} → ${p.name || "Person " + (personIndex + 1)} wird als Grenzgänger:in eingetragen.`,
        patch: {
          personen: [
            {
              index: personIndex,
              felder: {
                arbeitsland: "CH",
                chBruttolohn: l.ziffer8,
                chZiffer9: l.ziffer9 ?? 0,
                chBvg: l.ziffer10 ?? 0,
                chQuellensteuer: l.ziffer12 ?? 0,
              },
            },
          ],
        },
      };
    }
    case "gehaltsabrechnung": {
      const g = b.gehaltsabrechnung;
      const monat = Math.min(12, Math.max(1, Math.round(g?.monat ?? 12)));
      const kumuliert = typeof g?.jahressummen?.brutto === "number" && g.jahressummen.brutto > 0;
      const werte = kumuliert ? g!.jahressummen! : g?.monatswerte;
      if (!werte || typeof werte.brutto !== "number") return { text: "Keine Werte erkannt.", patch: null };
      const n = (k: string) => (typeof werte[k] === "number" ? (werte[k] as number) : 0);
      const jahr = hochrechnen(
        {
          modus: kumuliert ? "kumuliert" : "monat",
          monat,
          brutto: n("brutto"),
          lohnsteuer: n("lohnsteuer"),
          soli: n("soli"),
          kirchensteuer: n("kirchensteuer"),
          rv: n("rv"),
          kv: n("kv"),
          pv: n("pv"),
          av: n("av"),
          einmalzahlungBrutto: 0,
        },
        input.jahr,
      );
      return {
        text: `Gehaltsabrechnung (${kumuliert ? `Jahressummen bis Monat ${monat}` : "Monatswerte × 12"}): hochgerechnet Brutto ${eur(jahr.bruttolohn)}, Lohnsteuer ${eur(jahr.lohnsteuer)} → ersetzt die Werte von ${p.name || "Person " + (personIndex + 1)}. Weihnachtsgeld/Bonus, das noch kommt, bitte im Chat nennen.`,
        patch: {
          personen: [{ index: personIndex, felder: { ...jahr, ...(jahr.kirchensteuerEinbehalten > 0 ? { kirchenmitglied: true } : {}) } }],
        },
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
