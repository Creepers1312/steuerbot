/**
 * Hochrechnung der Jahreswerte aus einer Gehaltsabrechnung – für das laufende Jahr,
 * wenn die Lohnsteuerbescheinigung noch nicht vorliegt.
 */
import { z } from "zod";
import { PARAMS, type SupportedYear } from "./params";
import type { Person } from "./schema";
import { grundtarif } from "./tariff";
import { runde2 } from "../format";

const euro = z.number().min(0).max(1_000_000);

export const GehaltsabrechnungSchema = z.object({
  modus: z
    .enum(["monat", "kumuliert"])
    .describe("monat = Werte eines normalen Monats; kumuliert = Jahressummen (Januar bis Abrechnungsmonat) von der Abrechnung"),
  monat: z.number().int().min(1).max(12).describe("Abrechnungsmonat (1 = Januar … 12 = Dezember)"),
  brutto: euro.describe("Steuerbrutto (Gesamtbrutto) des Monats bzw. Jahressumme"),
  lohnsteuer: euro,
  soli: euro,
  kirchensteuer: euro,
  rv: euro.describe("Rentenversicherung Arbeitnehmeranteil"),
  kv: euro.describe("Krankenversicherung Arbeitnehmeranteil inkl. Zusatzbeitrag"),
  pv: euro.describe("Pflegeversicherung Arbeitnehmeranteil"),
  av: euro.describe("Arbeitslosenversicherung Arbeitnehmeranteil"),
  einmalzahlungBrutto: euro
    .describe("Noch zu erwartende Sonderzahlungen im Jahr (Weihnachtsgeld, Bonus), die in den Werten oben NICHT enthalten sind"),
});
export type Gehaltsabrechnung = z.infer<typeof GehaltsabrechnungSchema>;

export type HochgerechneteWerte = Pick<
  Person,
  | "bruttolohn"
  | "lohnsteuer"
  | "soliEinbehalten"
  | "kirchensteuerEinbehalten"
  | "rvArbeitnehmer"
  | "rvArbeitgeber"
  | "kvArbeitnehmer"
  | "pvArbeitnehmer"
  | "avArbeitnehmer"
>;


export function hochrechnen(g: Gehaltsabrechnung, jahr: SupportedYear): HochgerechneteWerte {
  const faktor = g.modus === "monat" ? 12 : 12 / g.monat;
  const jahrBrutto = g.brutto * faktor;
  const jahrLSt = g.lohnsteuer * faktor;

  // Sonderzahlung: Lohnsteuer ≈ Steuer-Mehrbetrag durch den zusätzlichen Lohn (wie beim Lohnsteuerabzug für sonstige Bezüge)
  let einmalLSt = 0;
  let einmalSV = { rv: 0, kv: 0, pv: 0, av: 0 };
  if (g.einmalzahlungBrutto > 0 && jahrBrutto > 0) {
    const sv = (g.rv + g.kv + g.pv + g.av) * faktor;
    const zvEGeschaetzt = Math.max(0, jahrBrutto - sv - PARAMS[jahr].arbeitnehmerPauschbetrag - 36);
    const t = PARAMS[jahr].tariff;
    einmalLSt = grundtarif(zvEGeschaetzt + g.einmalzahlungBrutto, t) - grundtarif(zvEGeschaetzt, t);
    // Sozialabgaben anteilig (Vereinfachung: Beitragsbemessungsgrenzen nicht berücksichtigt)
    const quote = g.einmalzahlungBrutto / jahrBrutto;
    einmalSV = { rv: g.rv * faktor * quote, kv: g.kv * faktor * quote, pv: g.pv * faktor * quote, av: g.av * faktor * quote };
  }
  const lstGesamt = jahrLSt + einmalLSt;
  const soliQuote = g.lohnsteuer > 0 ? g.soli / g.lohnsteuer : 0;
  const kistQuote = g.lohnsteuer > 0 ? g.kirchensteuer / g.lohnsteuer : 0;
  const rv = g.rv * faktor + einmalSV.rv;

  return {
    bruttolohn: runde2(jahrBrutto + g.einmalzahlungBrutto),
    lohnsteuer: runde2(lstGesamt),
    soliEinbehalten: runde2(lstGesamt * soliQuote),
    kirchensteuerEinbehalten: runde2(lstGesamt * kistQuote),
    rvArbeitnehmer: runde2(rv),
    // Arbeitgeber zahlt in der Regel denselben RV-Beitrag
    rvArbeitgeber: runde2(rv),
    kvArbeitnehmer: runde2(g.kv * faktor + einmalSV.kv),
    pvArbeitnehmer: runde2(g.pv * faktor + einmalSV.pv),
    avArbeitnehmer: runde2(g.av * faktor + einmalSV.av),
  };
}

/**
 * Schlägt eine (weitere) Sonderzahlung auf bereits hochgerechnete Jahreswerte auf.
 * Ein negativer Betrag nimmt eine zuvor aufgeschlagene Zahlung wieder zurück.
 */
export function sonderzahlungAufschlagen(w: HochgerechneteWerte, betrag: number, jahr: SupportedYear): HochgerechneteWerte {
  if (!betrag || w.bruttolohn <= 0) return w;
  const sv = w.rvArbeitnehmer + w.kvArbeitnehmer + w.pvArbeitnehmer + w.avArbeitnehmer;
  const zvE = Math.max(0, w.bruttolohn - sv - PARAMS[jahr].arbeitnehmerPauschbetrag - 36);
  const t = PARAMS[jahr].tariff;
  const mehrLSt = grundtarif(Math.max(0, zvE + betrag), t) - grundtarif(zvE, t);
  const quote = betrag / w.bruttolohn;
  const soliQuote = w.lohnsteuer > 0 ? w.soliEinbehalten / w.lohnsteuer : 0;
  const kistQuote = w.lohnsteuer > 0 ? w.kirchensteuerEinbehalten / w.lohnsteuer : 0;
  const lst = Math.max(0, w.lohnsteuer + mehrLSt);
  const sk = (x: number) => runde2(Math.max(0, x * (1 + quote)));
  return {
    bruttolohn: runde2(Math.max(0, w.bruttolohn + betrag)),
    lohnsteuer: runde2(lst),
    soliEinbehalten: runde2(lst * soliQuote),
    kirchensteuerEinbehalten: runde2(lst * kistQuote),
    rvArbeitnehmer: sk(w.rvArbeitnehmer),
    rvArbeitgeber: sk(w.rvArbeitgeber),
    kvArbeitnehmer: sk(w.kvArbeitnehmer),
    pvArbeitnehmer: sk(w.pvArbeitnehmer),
    avArbeitnehmer: sk(w.avArbeitnehmer),
  };
}
