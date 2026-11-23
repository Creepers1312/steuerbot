import type { TaxResult } from "./engine";
import type { TaxInput } from "./schema";

const eur = (n: number) => `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

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
    const chf = (n: number) => `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CHF`;
    if (p.arbeitsland === "CH") {
      abschnitte.push({
        anlage: `Anlage N-Gre – ${name}`,
        eintraege: [
          { feld: "Arbeitslohn laut Lohnausweis (Ziffer 8)", wert: chf(p.chBruttolohn), hinweis: "In Franken eintragen – das Finanzamt rechnet um." },
          { feld: "Einbehaltene Schweizer Abzugsteuer (Ziffer 12)", wert: chf(p.chQuellensteuer), hinweis: "Wird bis 4,5 % des Bruttolohns angerechnet." },
          { feld: "Nichtrückkehrtage", wert: `${p.nichtrueckkehrtage}`, hinweis: "Bei mehr als 60 Tagen keine Grenzgängerregel." },
          { feld: "Belege", wert: "Lohnausweis, ggf. Ansässigkeitsbescheinigung (Gre-1)", hinweis: "Lohnausweis als PDF beifügen bzw. bereithalten." },
        ],
      });
      abschnitte.push({
        anlage: `Anlage Vorsorgeaufwand – ${name} (Schweiz)`,
        eintraege: [
          { feld: "Beiträge zur Schweizer AHV/IV/EO", wert: chf(Math.min(p.chZiffer9, p.chBruttolohn * 0.053)), hinweis: "Arbeitnehmeranteil; Arbeitgeberanteil in gleicher Höhe (steuerfrei)." },
          { feld: "Pensionskasse – obligatorischer Teil", wert: chf(Math.max(0, p.chBvg - p.chBvgUeberobligatorisch)) },
          ...(p.chBvgUeberobligatorisch > 0 ? [{ feld: "Pensionskasse – überobligatorischer Teil", wert: chf(p.chBvgUeberobligatorisch) }] : []),
          { feld: "Arbeitslosen- und Nichtberufsunfallversicherung", wert: chf(Math.max(0, p.chZiffer9 - Math.min(p.chZiffer9, p.chBruttolohn * 0.053))) },
          ...(p.kvArbeitnehmer || p.pvArbeitnehmer
            ? [{ feld: "Kranken-/Pflegeversicherung (selbst gezahlt, ohne Arbeitgeberzuschuss)", wert: eur(p.kvArbeitnehmer + p.pvArbeitnehmer) }]
            : []),
          ...(p.chKvgPraemie ? [{ feld: "Schweizer Krankenversicherung (KVG)", wert: chf(p.chKvgPraemie) }] : []),
        ],
      });
    }
    const e: Eintrag[] =
      p.arbeitsland === "CH"
        ? []
        : [
            {
              feld: "Angaben aus der Lohnsteuerbescheinigung",
              wert: `Brutto ${eur(p.bruttolohn)}, Lohnsteuer ${eur(p.lohnsteuer)}`,
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
    if (p.arbeitsmittel > 0) e.push({ feld: "Aufwendungen für Arbeitsmittel", wert: eur(p.arbeitsmittel), hinweis: "Einzeln mit Bezeichnung auflisten." });
    if (p.gewerkschaftsbeitraege > 0) e.push({ feld: "Beiträge zu Berufsverbänden (Gewerkschaft)", wert: eur(p.gewerkschaftsbeitraege) });
    if (p.fortbildung > 0) e.push({ feld: "Fortbildungskosten", wert: eur(p.fortbildung) });
    if (p.kontofuehrungspauschale) e.push({ feld: "Weitere Werbungskosten: Kontoführungsgebühren (pauschal)", wert: eur(16) });
    if (p.sonstigeWerbungskosten > 0) e.push({ feld: "Weitere Werbungskosten", wert: eur(p.sonstigeWerbungskosten), hinweis: "Mit kurzer Beschreibung (z. B. Bewerbung, Umzug)." });
    if (p.lohnersatzleistungen > 0) {
      e.push({
        feld: "Lohn-/Entgeltersatzleistungen (Elterngeld, ALG I, Kurzarbeitergeld …)",
        wert: eur(p.lohnersatzleistungen),
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
        wert: `wird abgezogen: ${eur(r.vorsorgeaufwendungen)}`,
        hinweis: "Kommt aus der Lohnsteuerbescheinigung per Belegabruf.",
      },
    ],
  });

  const sa: Eintrag[] = [];
  if (input.spenden > 0) sa.push({ feld: "Zuwendungen (Spenden und Mitgliedsbeiträge)", wert: eur(input.spenden), hinweis: "Bis 300 € je Spende reicht der Kontoauszug." });
  if (input.weitereKirchensteuer > 0) sa.push({ feld: "Gezahlte Kirchensteuer (nicht über den Lohn)", wert: eur(input.weitereKirchensteuer) });
  if (sa.length) abschnitte.push({ anlage: "Anlage Sonderausgaben", eintraege: sa });

  if (input.kinder.length) {
    input.kinder.forEach((k, i) => {
      const e: Eintrag[] = [
        { feld: "Angaben zum Kind", wert: `${k.name || `Kind ${i + 1}`}, Kindergeld ${k.monate} Monate`, hinweis: "Steuer-ID des Kindes eintragen." },
      ];
      if (i === 0 && input.kinderbetreuungskosten > 0) {
        e.push({
          feld: "Kinderbetreuungskosten",
          wert: eur(input.kinderbetreuungskosten),
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
  if (input.haushaltsnaheDienstleistungen > 0) hh.push({ feld: "Haushaltsnahe Dienstleistungen", wert: eur(input.haushaltsnaheDienstleistungen) });
  if (input.handwerkerLohnkosten > 0) {
    hh.push({ feld: "Handwerkerleistungen (nur Arbeitskosten)", wert: eur(input.handwerkerLohnkosten), hinweis: "Rechnung + Überweisung aufbewahren; Barzahlung zählt nicht." });
  }
  if (hh.length) abschnitte.push({ anlage: "Anlage Haushaltsnahe Aufwendungen", eintraege: hh });

  if (input.krankheitskosten > 0) {
    abschnitte.push({
      anlage: "Anlage Außergewöhnliche Belastungen",
      eintraege: [
        {
          feld: "Krankheitskosten",
          wert: eur(input.krankheitskosten),
          hinweis: r.aussergewoehnlicheBelastungen > 0 ? undefined : `Liegt unter der zumutbaren Belastung (${eur(r.zumutbareBelastung)}) – wirkt sich voraussichtlich nicht aus.`,
        },
      ],
    });
  }
  return abschnitte;
}
