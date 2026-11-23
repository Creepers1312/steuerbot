import type { TaxResult } from "./engine";
import type { TaxInput } from "./schema";
import { euro, franken } from "../format";


export interface Eintrag {
  feld: string;
  wert: string;
  hinweis?: string;
}
export interface Abschnitt {
  anlage: string;
  eintraege: Eintrag[];
}

/** Baut die Ausfüllhilfe: welche Angabe gehört in welchen ELSTER-Vordruck. */
export function ausfuellhilfe(input: TaxInput, r: TaxResult): Abschnitt[] {
  const personen = input.zusammenveranlagung ? input.personen : input.personen.slice(0, 1);
  const abschnitte: Abschnitt[] = [];

  abschnitte.push({
    anlage: "Hauptvordruck (ESt 1 A)",
    eintraege: [
      { feld: "Veranlagungsart", wert: input.zusammenveranlagung ? "Zusammenveranlagung" : "Einzelveranlagung" },
      ...personen.map((p, i) => ({
        feld: `Religion ${p.name || `Person ${i + 1}`}`,
        wert: p.kirchenmitglied ? "kirchensteuerpflichtig" : "keine / nicht kirchensteuerpflichtig",
      })),
    ],
  });

  personen.forEach((p, i) => {
    const name = p.name || `Person ${i + 1}`;
    if (p.arbeitsland === "CH") {
      abschnitte.push({
        anlage: `Anlage N-Gre – ${name}`,
        eintraege: [
          { feld: "Arbeitslohn laut Lohnausweis (Ziffer 8)", wert: franken(p.chBruttolohn), hinweis: "In Franken eintragen – das Finanzamt rechnet um." },
          { feld: "Einbehaltene Schweizer Abzugsteuer (Ziffer 12)", wert: franken(p.chQuellensteuer), hinweis: "Wird bis 4,5 % des Bruttolohns angerechnet." },
          { feld: "Nichtrückkehrtage", wert: `${p.nichtrueckkehrtage}`, hinweis: "Bei mehr als 60 Tagen keine Grenzgängerregel." },
          { feld: "Belege", wert: "Lohnausweis, ggf. Ansässigkeitsbescheinigung (Gre-1)", hinweis: "Lohnausweis als PDF beifügen bzw. bereithalten." },
        ],
      });
      abschnitte.push({
        anlage: `Anlage Vorsorgeaufwand – ${name} (Schweiz)`,
        eintraege: [
          { feld: "Beiträge zur Schweizer AHV/IV/EO", wert: franken(Math.min(p.chZiffer9, p.chBruttolohn * 0.053)), hinweis: "Arbeitnehmeranteil; Arbeitgeberanteil in gleicher Höhe (steuerfrei)." },
          { feld: "Pensionskasse – obligatorischer Teil", wert: franken(Math.max(0, p.chBvg - p.chBvgUeberobligatorisch)) },
          ...(p.chBvgUeberobligatorisch > 0 ? [{ feld: "Pensionskasse – überobligatorischer Teil", wert: franken(p.chBvgUeberobligatorisch) }] : []),
          { feld: "Arbeitslosen- und Nichtberufsunfallversicherung", wert: franken(Math.max(0, p.chZiffer9 - Math.min(p.chZiffer9, p.chBruttolohn * 0.053))) },
          ...(p.kvArbeitnehmer || p.pvArbeitnehmer
            ? [{ feld: "Kranken-/Pflegeversicherung (selbst gezahlt, ohne Arbeitgeberzuschuss)", wert: euro(p.kvArbeitnehmer + p.pvArbeitnehmer, 2) }]
            : []),
          ...(p.chKvgPraemie ? [{ feld: "Schweizer Krankenversicherung (KVG)", wert: franken(p.chKvgPraemie) }] : []),
        ],
      });
    }
    const e: Eintrag[] =
      p.arbeitsland === "CH"
        ? []
        : [
            {
              feld: "Angaben aus der Lohnsteuerbescheinigung",
              wert: `Brutto ${euro(p.bruttolohn, 2)}, Lohnsteuer ${euro(p.lohnsteuer, 2)}`,
              hinweis: "Werden per Belegabruf automatisch übernommen – nur prüfen.",
            },
          ];
    if (p.entfernungKm > 0 && p.arbeitstageBuero > 0) {
      e.push({
        feld: "Wege zwischen Wohnung und erster Tätigkeitsstätte",
        wert: `${p.arbeitstageBuero} Arbeitstage, ${Math.floor(p.entfernungKm)} km einfache Entfernung${p.mitPkw ? ", davon mit eigenem Pkw zurückgelegt" : ""}`,
        hinweis: "Adresse der Tätigkeitsstätte und Zeitraum ebenfalls angeben.",
      });
    }
    if (p.homeofficeTage > 0) {
      e.push({ feld: "Tagespauschale (Homeoffice)", wert: `${Math.min(210, p.homeofficeTage)} Tage` });
    }
    if (p.arbeitsmittel > 0) e.push({ feld: "Aufwendungen für Arbeitsmittel", wert: euro(p.arbeitsmittel, 2), hinweis: "Einzeln mit Bezeichnung auflisten." });
    if (p.gewerkschaftsbeitraege > 0) e.push({ feld: "Beiträge zu Berufsverbänden (Gewerkschaft)", wert: euro(p.gewerkschaftsbeitraege, 2) });
    if (p.fortbildung > 0) e.push({ feld: "Fortbildungskosten", wert: euro(p.fortbildung, 2) });
    if (p.kontofuehrungspauschale) e.push({ feld: "Weitere Werbungskosten: Kontoführungsgebühren (pauschal)", wert: euro(16, 2) });
    if (p.sonstigeWerbungskosten > 0) e.push({ feld: "Weitere Werbungskosten", wert: euro(p.sonstigeWerbungskosten, 2), hinweis: "Mit kurzer Beschreibung (z. B. Bewerbung, Umzug)." });
    if (p.lohnersatzleistungen > 0) {
      e.push({
        feld: "Lohn-/Entgeltersatzleistungen (Elterngeld, ALG I, Kurzarbeitergeld …)",
        wert: euro(p.lohnersatzleistungen, 2),
        hinweis: "Teilweise per Belegabruf vorhanden – Elterngeld meist selbst eintragen.",
      });
    }
    const pe = r.personen[i];
    if (pe?.pauschbetragGenutzt) {
      e.push({
        feld: "Hinweis",
        wert: "Werbungskosten unter dem Pauschbetrag",
        hinweis: "Das Finanzamt setzt automatisch 1.230 € an – Eintragen schadet nicht, bringt aber nichts.",
      });
    }
    abschnitte.push({
      anlage: p.arbeitsland === "CH" ? `Anlage N – ${name} (Werbungskosten)` : `Anlage N – ${name}`,
      eintraege: e.length ? e : [{ feld: "Werbungskosten", wert: "nur Pauschbetrag", hinweis: "Keine weiteren Angaben nötig." }],
    });

    if (p.gradDerBehinderung > 0 || p.merkzeichenHilflos) {
      abschnitte.push({
        anlage: `Anlage Außergewöhnliche Belastungen – ${name}`,
        eintraege: [
          {
            feld: "Pauschbetrag für Menschen mit Behinderung",
            wert: `GdB ${p.gradDerBehinderung}${p.merkzeichenHilflos ? ", Merkzeichen H/Bl/TBl" : ""}`,
            hinweis: "Ausweis/Bescheid bereithalten.",
          },
        ],
      });
    }
  });

  if (personen.some((p) => p.arbeitsland !== "CH")) abschnitte.push({
    anlage: "Anlage Vorsorgeaufwand",
    eintraege: [
      {
        feld: "Renten-, Kranken-, Pflege-, Arbeitslosenversicherung",
        wert: `wird abgezogen: ${euro(r.vorsorgeaufwendungen, 2)}`,
        hinweis: "Kommt aus der Lohnsteuerbescheinigung per Belegabruf.",
      },
    ],
  });

  const sa: Eintrag[] = [];
  if (input.spenden > 0) sa.push({ feld: "Zuwendungen (Spenden und Mitgliedsbeiträge)", wert: euro(input.spenden, 2), hinweis: "Bis 300 € je Spende reicht der Kontoauszug." });
  if (input.weitereKirchensteuer > 0) sa.push({ feld: "Gezahlte Kirchensteuer (nicht über den Lohn)", wert: euro(input.weitereKirchensteuer, 2) });
  if (sa.length) abschnitte.push({ anlage: "Anlage Sonderausgaben", eintraege: sa });

  if (input.kinder.length) {
    input.kinder.forEach((k, i) => {
      const e: Eintrag[] = [
        { feld: "Angaben zum Kind", wert: `${k.name || `Kind ${i + 1}`}, Kindergeld ${k.monate} Monate`, hinweis: "Steuer-ID des Kindes eintragen." },
      ];
      if (i === 0 && input.kinderbetreuungskosten > 0) {
        e.push({
          feld: "Kinderbetreuungskosten",
          wert: euro(input.kinderbetreuungskosten, 2),
          hinweis: "Je Kind getrennt angeben; ohne Verpflegung; nur per Überweisung bezahlt.",
        });
      }
      if (i === 0 && input.alleinerziehend && !input.zusammenveranlagung) {
        e.push({ feld: "Entlastungsbetrag für Alleinerziehende", wert: "beantragen", hinweis: "Kind im eigenen Haushalt gemeldet, kein weiterer Erwachsener." });
      }
      abschnitte.push({ anlage: `Anlage Kind – ${k.name || `Kind ${i + 1}`}`, eintraege: e });
    });
  }

  const hh: Eintrag[] = [];
  if (input.haushaltsnaheDienstleistungen > 0) hh.push({ feld: "Haushaltsnahe Dienstleistungen", wert: euro(input.haushaltsnaheDienstleistungen, 2) });
  if (input.handwerkerLohnkosten > 0) {
    hh.push({ feld: "Handwerkerleistungen (nur Arbeitskosten)", wert: euro(input.handwerkerLohnkosten, 2), hinweis: "Rechnung + Überweisung aufbewahren; Barzahlung zählt nicht." });
  }
  if (hh.length) abschnitte.push({ anlage: "Anlage Haushaltsnahe Aufwendungen", eintraege: hh });

  if (input.krankheitskosten > 0) {
    abschnitte.push({
      anlage: "Anlage Außergewöhnliche Belastungen",
      eintraege: [
        {
          feld: "Krankheitskosten",
          wert: euro(input.krankheitskosten, 2),
          hinweis: r.aussergewoehnlicheBelastungen > 0 ? undefined : `Liegt unter der zumutbaren Belastung (${euro(r.zumutbareBelastung, 2)}) – wirkt sich voraussichtlich nicht aus.`,
        },
      ],
    });
  }
  return abschnitte;
}
