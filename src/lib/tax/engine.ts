/**
 * Rechenkern: Schätzung der Einkommensteuer-Erstattung für Arbeitnehmer.
 *
 * Bewusst deterministisch und ohne KI – Claude ruft diese Funktion nur auf.
 * Vereinfachungen sind in `hinweise` bzw. der README dokumentiert.
 */
import {
  BEHINDERTEN_PAUSCHBETRAG,
  BEHINDERTEN_PAUSCHBETRAG_HILFLOS,
  BUNDESLAENDER,
  PARAGRAPH_35A,
  PARAMS,
  type YearParams,
} from "./params";
import type { Person, TaxInput } from "./schema";
import { grenzsteuersatz, tarifMitProgressionsvorbehalt } from "./tariff";

export interface Posten {
  label: string;
  betrag: number;
}

export interface PersonErgebnis {
  name: string;
  bruttolohn: number;
  werbungskostenPosten: Posten[];
  werbungskostenTatsaechlich: number;
  werbungskostenAngesetzt: number;
  pauschbetragGenutzt: boolean;
  einkuenfte: number;
  vorsorgeaufwendungen: number;
  behindertenPauschbetrag: number;
  progressionsvorbehalt: number;
}

export interface TaxResult {
  jahr: number;
  splitting: boolean;
  personen: PersonErgebnis[];
  summeEinkuenfte: number;
  entlastungsbetragAlleinerziehende: number;
  gesamtbetragEinkuenfte: number;
  vorsorgeaufwendungen: number;
  weitereSonderausgaben: number;
  sonderausgabenPosten: Posten[];
  aussergewoehnlicheBelastungen: number;
  zumutbareBelastung: number;
  einkommen: number;
  kinderfreibetraege: number;
  kinderfreibetragGuenstiger: boolean;
  kindergeldAnspruch: number;
  zvE: number;
  tariflicheESt: number;
  steuerermaessigung35a: number;
  kindergeldHinzurechnung: number;
  festzusetzendeESt: number;
  soli: number;
  kirchensteuer: number;
  steuerGesamt: number;
  bereitsGezahlt: { lohnsteuer: number; soli: number; kirchensteuer: number; gesamt: number };
  /** > 0: Erstattung, < 0: Nachzahlung */
  erstattung: number;
  grenzsteuersatz: number;
  durchschnittssteuersatz: number;
  hinweise: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const eur = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 2 })} €`;
const floorCent = (n: number) => Math.floor(n * 100 + 1e-9) / 100;

function werbungskosten(p: Person, prm: YearParams) {
  const posten: Posten[] = [];
  const km = Math.floor(p.entfernungKm);
  if (km > 0 && p.arbeitstageBuero > 0) {
    let pendler =
      p.arbeitstageBuero * (Math.min(km, 20) * prm.pendlerBis20 + Math.max(0, km - 20) * prm.pendlerAb21);
    if (!p.mitPkw) pendler = Math.min(pendler, prm.pendlerHoechstbetragOhnePkw);
    posten.push({ label: `Entfernungspauschale (${km} km × ${p.arbeitstageBuero} Tage)`, betrag: r2(pendler) });
  }
  if (p.homeofficeTage > 0) {
    const tage = Math.min(p.homeofficeTage, prm.homeofficeMaxTage);
    posten.push({ label: `Homeoffice-Pauschale (${tage} Tage × ${prm.homeofficeProTag} €)`, betrag: tage * prm.homeofficeProTag });
  }
  if (p.arbeitsmittel > 0) posten.push({ label: "Arbeitsmittel", betrag: p.arbeitsmittel });
  if (p.fortbildung > 0) posten.push({ label: "Fortbildung", betrag: p.fortbildung });
  if (p.sonstigeWerbungskosten > 0) posten.push({ label: "Sonstige Werbungskosten", betrag: p.sonstigeWerbungskosten });
  if (p.kontofuehrungspauschale) posten.push({ label: "Kontoführungspauschale", betrag: 16 });
  if (p.gewerkschaftsbeitraege > 0 && !prm.gewerkschaftUeberPauschbetrag) {
    posten.push({ label: "Gewerkschaftsbeiträge", betrag: p.gewerkschaftsbeitraege });
  }
  const tatsaechlich = r2(posten.reduce((s, x) => s + x.betrag, 0));

  let angesetzt: number;
  let pauschbetragGenutzt: boolean;
  if (tatsaechlich > prm.arbeitnehmerPauschbetrag) {
    angesetzt = tatsaechlich;
    pauschbetragGenutzt = false;
  } else {
    // Pauschbetrag darf nicht zu negativen Einkünften führen
    angesetzt = Math.min(prm.arbeitnehmerPauschbetrag, p.bruttolohn);
    pauschbetragGenutzt = true;
  }
  // Ab 2026: Gewerkschaftsbeiträge zusätzlich zum Pauschbetrag
  if (p.gewerkschaftsbeitraege > 0 && prm.gewerkschaftUeberPauschbetrag) {
    posten.push({ label: "Gewerkschaftsbeiträge (zusätzlich zum Pauschbetrag)", betrag: p.gewerkschaftsbeitraege });
    angesetzt += p.gewerkschaftsbeitraege;
  }
  return { posten, tatsaechlich, angesetzt: r2(angesetzt), pauschbetragGenutzt };
}

function vorsorge(p: Person, prm: YearParams): number {
  const alters = Math.max(0, Math.min(p.rvArbeitnehmer + p.rvArbeitgeber, prm.altersvorsorgeHoechstbetrag) - p.rvArbeitgeber);
  const basisKvPv = p.kvArbeitnehmer * (p.krankengeldAnspruch ? 0.96 : 1) + p.pvArbeitnehmer;
  const sonstige = Math.max(
    basisKvPv,
    Math.min(prm.sonstigeVorsorgeHoechstbetrag, p.kvArbeitnehmer + p.pvArbeitnehmer + p.avArbeitnehmer),
  );
  return r2(alters + sonstige);
}

function behindertenPauschbetrag(p: Person): number {
  if (p.merkzeichenHilflos) return BEHINDERTEN_PAUSCHBETRAG_HILFLOS;
  const stufe = Math.floor(p.gradDerBehinderung / 10) * 10;
  return BEHINDERTEN_PAUSCHBETRAG[stufe] ?? 0;
}

/** Zumutbare Belastung (§ 33 Abs. 3 EStG), stufenweise Berechnung nach BFH VI R 75/14. */
export function zumutbareBelastung(gesamtbetrag: number, splitting: boolean, anzahlKinder: number): number {
  let saetze: [number, number, number];
  if (anzahlKinder >= 3) saetze = [0.01, 0.01, 0.02];
  else if (anzahlKinder >= 1) saetze = [0.02, 0.03, 0.04];
  else if (splitting) saetze = [0.04, 0.05, 0.06];
  else saetze = [0.05, 0.06, 0.07];
  const grenzen = [15_340, 51_130, Infinity];
  let rest = Math.max(0, gesamtbetrag);
  let unten = 0;
  let summe = 0;
  for (let i = 0; i < 3; i++) {
    const anteil = Math.min(rest, grenzen[i] - unten);
    summe += anteil * saetze[i];
    rest -= anteil;
    unten = grenzen[i];
    if (rest <= 0) break;
  }
  return Math.floor(summe);
}

export function berechne(input: TaxInput): TaxResult {
  const prm = PARAMS[input.jahr];
  const splitting = input.zusammenveranlagung && input.personen.length === 2;
  const personen = splitting ? input.personen : input.personen.slice(0, 1);
  const hinweise: string[] = [];

  // ---------- Einkünfte je Person ----------
  const personenErgebnisse: PersonErgebnis[] = personen.map((p, i) => {
    const wk = werbungskosten(p, prm);
    const einkuenfte = r2(p.bruttolohn - wk.angesetzt);
    const unverbrauchterPauschbetrag = wk.pauschbetragGenutzt
      ? Math.max(0, prm.arbeitnehmerPauschbetrag - p.bruttolohn)
      : 0;
    return {
      name: p.name || (i === 0 ? "Person 1" : "Person 2"),
      bruttolohn: p.bruttolohn,
      werbungskostenPosten: wk.posten,
      werbungskostenTatsaechlich: wk.tatsaechlich,
      werbungskostenAngesetzt: wk.angesetzt,
      pauschbetragGenutzt: wk.pauschbetragGenutzt,
      einkuenfte,
      vorsorgeaufwendungen: vorsorge(p, prm),
      behindertenPauschbetrag: behindertenPauschbetrag(p),
      progressionsvorbehalt: Math.max(0, p.lohnersatzleistungen - unverbrauchterPauschbetrag),
    };
  });

  for (const pe of personenErgebnisse) {
    if (pe.pauschbetragGenutzt && pe.bruttolohn > 0) {
      const fehlt = prm.arbeitnehmerPauschbetrag - pe.werbungskostenTatsaechlich;
      hinweise.push(
        `${pe.name}: Werbungskosten (${eur(pe.werbungskostenTatsaechlich)}) liegen unter dem Pauschbetrag – es wird der Pauschbetrag von ${eur(prm.arbeitnehmerPauschbetrag)} angesetzt. Erst ab ${eur(fehlt)} weiteren Kosten wirkt sich jeder Beleg aus.`,
      );
    }
    if (pe.progressionsvorbehalt > 410) {
      hinweise.push(
        `${pe.name}: Lohnersatzleistungen über 410 € – Abgabe der Steuererklärung ist Pflicht (Progressionsvorbehalt, häufig Nachzahlung).`,
      );
    }
  }

  const summeEinkuenfte = r2(personenErgebnisse.reduce((s, p) => s + p.einkuenfte, 0));
  const anzahlKinder = input.kinder.filter((k) => k.monate > 0).length;

  let entlastung = 0;
  if (!splitting && input.alleinerziehend && anzahlKinder > 0) {
    entlastung = prm.alleinerziehendErstesKind + (anzahlKinder - 1) * prm.alleinerziehendWeiteresKind;
  }
  const gesamtbetrag = r2(summeEinkuenfte - entlastung);

  // ---------- Sonderausgaben ----------
  const vorsorgeSumme = r2(personenErgebnisse.reduce((s, p) => s + p.vorsorgeaufwendungen, 0));
  const sonderausgabenPosten: Posten[] = [];
  const kist = r2(
    personen.reduce((s, p) => s + (p.kirchenmitglied ? p.kirchensteuerEinbehalten : 0), 0) + input.weitereKirchensteuer,
  );
  if (kist > 0) sonderausgabenPosten.push({ label: "Gezahlte Kirchensteuer", betrag: kist });
  if (input.kinderbetreuungskosten > 0) {
    const max = 4_800 * Math.max(1, anzahlKinder);
    const abzug = r2(Math.min(input.kinderbetreuungskosten * 0.8, max));
    sonderausgabenPosten.push({ label: "Kinderbetreuungskosten (80 %)", betrag: abzug });
  }
  if (input.spenden > 0) {
    const abzug = r2(Math.min(input.spenden, Math.max(0, gesamtbetrag) * 0.2));
    sonderausgabenPosten.push({ label: "Spenden und Mitgliedsbeiträge", betrag: abzug });
  }
  const weitereSA = r2(sonderausgabenPosten.reduce((s, x) => s + x.betrag, 0));
  const saPausch = prm.sonderausgabenPauschbetrag * (splitting ? 2 : 1);
  const weitereSonderausgaben = Math.max(weitereSA, saPausch);

  // ---------- Außergewöhnliche Belastungen ----------
  const zumutbar = zumutbareBelastung(gesamtbetrag, splitting, anzahlKinder);
  const krankheit = Math.max(0, input.krankheitskosten - zumutbar);
  if (input.krankheitskosten > 0 && krankheit === 0) {
    hinweise.push(
      `Krankheitskosten (${eur(input.krankheitskosten)}) liegen unter der zumutbaren Belastung (${eur(zumutbar)}) und wirken sich nicht aus.`,
    );
  }
  const behinderung = personenErgebnisse.reduce((s, p) => s + p.behindertenPauschbetrag, 0);
  const agB = r2(krankheit + behinderung);

  const einkommen = Math.max(0, r2(gesamtbetrag - vorsorgeSumme - weitereSonderausgaben - agB));

  // ---------- Kinder: Günstigerprüfung Kindergeld vs. Kinderfreibetrag ----------
  let kfb = 0;
  let kindergeld = 0;
  for (const k of input.kinder) {
    const anteil = splitting || k.vollerFreibetrag ? 1 : 0.5;
    kfb += ((prm.kinderfreibetrag + prm.beaFreibetrag) * k.monate * anteil) / 12;
    kindergeld += prm.kindergeldMonat * k.monate * anteil;
  }
  kfb = Math.round(kfb);

  const progression = personenErgebnisse.reduce((s, p) => s + p.progressionsvorbehalt, 0);
  const estOhneKfb = tarifMitProgressionsvorbehalt(einkommen, progression, prm.tariff, splitting);
  const zvEMitKfb = Math.max(0, einkommen - kfb);
  const estMitKfb = tarifMitProgressionsvorbehalt(zvEMitKfb, progression, prm.tariff, splitting);
  const kfbGuenstiger = kfb > 0 && estOhneKfb - estMitKfb > kindergeld;

  const zvE = Math.floor(kfbGuenstiger ? zvEMitKfb : einkommen);
  const tariflicheESt = kfbGuenstiger ? estMitKfb : estOhneKfb;
  if (kfb > 0) {
    hinweise.push(
      kfbGuenstiger
        ? `Kinderfreibeträge sind günstiger als das Kindergeld (${eur(estOhneKfb - estMitKfb)} Steuerersparnis > ${eur(kindergeld)} Kindergeld). Das Kindergeld wird der Steuer hinzugerechnet.`
        : `Das Kindergeld (${eur(kindergeld)}) ist günstiger als die Kinderfreibeträge – keine Hinzurechnung.`,
    );
  }

  // ---------- Steuerermäßigungen § 35a ----------
  const haushaltsnah = Math.min(input.haushaltsnaheDienstleistungen * PARAGRAPH_35A.satz, PARAGRAPH_35A.haushaltsnahMax);
  const handwerker = Math.min(input.handwerkerLohnkosten * PARAGRAPH_35A.satz, PARAGRAPH_35A.handwerkerMax);
  const ermaessigung = r2(Math.min(tariflicheESt, haushaltsnah + handwerker));

  const kindergeldHinzurechnung = kfbGuenstiger ? kindergeld : 0;
  const festzusetzendeESt = r2(tariflicheESt - ermaessigung + kindergeldHinzurechnung);

  // ---------- Zuschlagsteuern: Bemessung immer mit Kinderfreibeträgen (§ 51a EStG) ----------
  const bemessung = Math.max(0, estMitKfb - Math.min(estMitKfb, haushaltsnah + handwerker));
  const freigrenze = prm.soliFreigrenze * (splitting ? 2 : 1);
  const soli = bemessung <= freigrenze ? 0 : floorCent(Math.min(bemessung * 0.055, (bemessung - freigrenze) * 0.119));

  const kistSatz = BUNDESLAENDER[input.bundesland].kirchensteuer;
  let kirchensteuer = 0;
  const mitglieder = personen.filter((p) => p.kirchenmitglied).length;
  if (mitglieder === personen.length) {
    kirchensteuer = floorCent(bemessung * kistSatz);
  } else if (mitglieder > 0) {
    // Vereinfachung: Aufteilung nach Anteil an den Einkünften
    const anteil = personen.reduce(
      (s, p, i) => s + (p.kirchenmitglied ? Math.max(0, personenErgebnisse[i].einkuenfte) : 0),
      0,
    ) / Math.max(1, personenErgebnisse.reduce((s, p) => s + Math.max(0, p.einkuenfte), 0));
    kirchensteuer = floorCent(bemessung * kistSatz * anteil);
    hinweise.push("Nur ein Ehepartner ist Kirchenmitglied – Kirchensteuer vereinfacht nach Einkommensanteil geschätzt.");
  }

  const steuerGesamt = r2(festzusetzendeESt + soli + kirchensteuer);
  const gezahlt = {
    lohnsteuer: r2(personen.reduce((s, p) => s + p.lohnsteuer, 0)),
    soli: r2(personen.reduce((s, p) => s + p.soliEinbehalten, 0)),
    kirchensteuer: r2(personen.reduce((s, p) => s + p.kirchensteuerEinbehalten, 0)),
    gesamt: 0,
  };
  gezahlt.gesamt = r2(gezahlt.lohnsteuer + gezahlt.soli + gezahlt.kirchensteuer);

  const summeBrutto = personen.reduce((s, p) => s + p.bruttolohn, 0);

  return {
    jahr: input.jahr,
    splitting,
    personen: personenErgebnisse,
    summeEinkuenfte,
    entlastungsbetragAlleinerziehende: entlastung,
    gesamtbetragEinkuenfte: gesamtbetrag,
    vorsorgeaufwendungen: vorsorgeSumme,
    weitereSonderausgaben,
    sonderausgabenPosten,
    aussergewoehnlicheBelastungen: agB,
    zumutbareBelastung: zumutbar,
    einkommen,
    kinderfreibetraege: kfbGuenstiger ? kfb : 0,
    kinderfreibetragGuenstiger: kfbGuenstiger,
    kindergeldAnspruch: kindergeld,
    zvE,
    tariflicheESt,
    steuerermaessigung35a: ermaessigung,
    kindergeldHinzurechnung,
    festzusetzendeESt,
    soli,
    kirchensteuer,
    steuerGesamt,
    bereitsGezahlt: gezahlt,
    erstattung: r2(gezahlt.gesamt - steuerGesamt),
    grenzsteuersatz: grenzsteuersatz(zvE, prm.tariff, splitting),
    durchschnittssteuersatz: summeBrutto > 0 ? festzusetzendeESt / summeBrutto : 0,
    hinweise,
  };
}
