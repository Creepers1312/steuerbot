/**
 * Ablauf des Fragebogens: welche Frage als Nächstes kommt, Fortschritt und Beantworten.
 * Reine Funktionen – kein React, gut testbar.
 */
import type { BelegDaten } from "../assistant/beleg-mapping";
import type { TaxInput } from "../tax/schema";
import { KATALOG } from "./katalog";
import { KAPITEL, type Antwort, type BelegEintrag, type Ctx, type Frage, type InterviewStand, type KapitelId, type Schritt } from "./typen";

/**
 * Alle Schritte, die beim aktuellen Datenstand relevant sind (Bedingungen erfüllt).
 * Reihenfolge: Kapitel für Kapitel; innerhalb eines Kapitels erst die Haushaltsfragen,
 * dann alle Fragen zu Person 1, danach zu Person 2 – so bleibt ein Dokument beim Thema.
 */
export function schritte(input: TaxInput, stand: InterviewStand, katalog = KATALOG): Schritt[] {
  const personen = input.zusammenveranlagung ? Math.min(2, input.personen.length) : 1;
  const out: Schritt[] = [];
  const pruefen = (frage: Frage, key: string, p: number, k: number, ziel: Schritt[]) => {
    const ctx: Ctx = { input, antworten: stand.antworten, p, k };
    if (frage.wenn && !frage.wenn(ctx)) return;
    ziel.push({ key, frage, ctx });
  };
  for (const kapitel of KAPITEL) {
    const imKapitel = katalog.filter((f) => f.kapitel === kapitel.id);
    const haushalt: Schritt[] = [];
    const proPerson: Schritt[][] = Array.from({ length: personen }, () => []);
    for (const frage of imKapitel) {
      if (frage.scope === "person") {
        for (let p = 0; p < personen; p++) pruefen(frage, `${frage.id}@p${p}`, p, 0, proPerson[p]);
      } else if (frage.scope === "kind") {
        input.kinder.forEach((_, k) => pruefen(frage, `${frage.id}@k${k}`, 0, k, haushalt));
      } else {
        pruefen(frage, frage.id, 0, 0, haushalt);
      }
    }
    out.push(...haushalt, ...proPerson.flat());
  }
  return out;
}

/** Nächste unbeantwortete Frage – oder null, wenn alles beantwortet ist. */
export function naechsterSchritt(input: TaxInput, stand: InterviewStand): Schritt | null {
  return schritte(input, stand).find((s) => !(s.key in stand.antworten)) ?? null;
}

export function schrittFuer(input: TaxInput, stand: InterviewStand, key: string): Schritt | null {
  return schritte(input, stand).find((s) => s.key === key) ?? null;
}

export interface Fortschritt {
  beantwortet: number;
  gesamt: number;
  kapitel: { id: KapitelId; label: string; icon: string; status: "fertig" | "aktiv" | "offen" | "leer" }[];
}

export function fortschritt(input: TaxInput, stand: InterviewStand): Fortschritt {
  const alle = schritte(input, stand);
  const offen = alle.find((s) => !(s.key in stand.antworten));
  const beantwortet = alle.filter((s) => s.key in stand.antworten).length;
  return {
    beantwortet,
    gesamt: alle.length,
    kapitel: KAPITEL.map((k) => {
      const im = alle.filter((s) => s.frage.kapitel === k.id);
      const status: Fortschritt["kapitel"][number]["status"] =
        im.length === 0
          ? "leer"
          : offen?.frage.kapitel === k.id
            ? "aktiv"
            : im.every((s) => s.key in stand.antworten)
              ? "fertig"
              : "offen";
      return { ...k, status };
    }),
  };
}

function speichern(stand: InterviewStand, key: string, antwort: Antwort): InterviewStand {
  return {
    antworten: { ...stand.antworten, [key]: antwort },
    verlauf: [...stand.verlauf.filter((k) => k !== key), key],
  };
}

export interface Ergebnis {
  input: TaxInput;
  stand: InterviewStand;
}

/** Beantwortet eine Frage. `wert === null` heißt überspringen (Datenstand bleibt unverändert). */
export function beantworten(input: TaxInput, stand: InterviewStand, schritt: Schritt, wert: unknown): Ergebnis {
  const { frage } = schritt;
  // Kontext mit dem Datenstand von jetzt und den bisherigen Antworten (inkl. alter Antwort dieser Frage)
  const ctx: Ctx = { ...schritt.ctx, input, antworten: stand.antworten };
  let next = input;
  if (wert !== null) {
    switch (frage.typ) {
      case "janein":
        next = frage.anwenden ? frage.anwenden(wert as boolean, ctx) : input;
        break;
      case "auswahl":
        next = frage.anwenden ? frage.anwenden(wert as string, ctx) : input;
        break;
      case "zahl": {
        const n = Math.max(0, Math.min(frage.max ?? Infinity, Number(wert) || 0));
        next = frage.anwenden(frage.ganzzahl ? Math.round(n) : n, ctx);
        wert = n;
        break;
      }
      case "text":
        next = frage.anwenden(String(wert), ctx);
        break;
      case "sammeln": {
        const belege = stand.antworten[schritt.key]?.belege ?? [];
        const manuell = Number(wert) || 0;
        next = frage.anwenden(manuell + summe(belege), ctx);
        return { input: next, stand: speichern(stand, schritt.key, { wert: manuell, belege }) };
      }
      case "dokument":
        next = frage.manuellAnwenden(wert as Record<string, number>, ctx);
        break;
      case "info":
        break;
    }
  }
  return { input: next, stand: speichern(stand, schritt.key, { wert }) };
}

const summe = (belege: BelegEintrag[]) => belege.reduce((s, b) => s + b.betrag, 0);

/** Sammel-Frage: ausgelesenen Beleg hinzufügen (Frage bleibt offen, bis „Weiter“). */
export function belegHinzufuegen(
  input: TaxInput,
  stand: InterviewStand,
  schritt: Schritt,
  beleg: BelegDaten,
): (Ergebnis & { text: string }) | { fehler: string } {
  const { frage } = schritt;
  const ctx: Ctx = { ...schritt.ctx, input, antworten: stand.antworten };
  if (frage.typ === "dokument") {
    const r = frage.belegAnwenden(beleg, ctx);
    if (!r) return { fehler: `Das sieht nicht nach einer ${frage.belegHinweis} aus (${beleg.beschreibung}). Versuch es nochmal oder tipp die Werte ab.` };
    return { input: r.input, stand: speichern(stand, schritt.key, { wert: "beleg" }), text: r.text };
  }
  if (frage.typ !== "sammeln") return { fehler: "Zu dieser Frage gehört kein Beleg." };
  const betrag = frage.betragAusBeleg(beleg);
  if (!betrag || betrag <= 0) return { fehler: `Auf dem Beleg habe ich keinen passenden Betrag gefunden (${beleg.beschreibung}). Trag ihn bitte ein.` };
  const alt = stand.antworten[`${schritt.key}#entwurf`] ?? stand.antworten[schritt.key];
  const belege = [...(alt?.belege ?? []), { text: beleg.beschreibung, betrag }];
  const manuell = Number(alt?.wert) || 0;
  const next = frage.anwenden(manuell + summe(belege), ctx);
  // Noch nicht in den Verlauf: die Frage gilt erst mit „Weiter“ als beantwortet
  const antworten = { ...stand.antworten, [`${schritt.key}#entwurf`]: { wert: manuell, belege } };
  return { input: next, stand: { ...stand, antworten }, text: `${beleg.beschreibung}: ${betrag.toLocaleString("de-DE")} €` };
}

/** Belege einer Sammel-Frage (auch solche, die vor „Weiter“ hinzugefügt wurden). */
export function belegeVon(stand: InterviewStand, key: string): BelegEintrag[] {
  return stand.antworten[`${key}#entwurf`]?.belege ?? stand.antworten[key]?.belege ?? [];
}

/** Sammel-Frage abschließen: Entwurf übernehmen. */
export function sammelnAbschliessen(input: TaxInput, stand: InterviewStand, schritt: Schritt, manuell: number): Ergebnis {
  if (schritt.frage.typ !== "sammeln") return beantworten(input, stand, schritt, manuell);
  const belege = belegeVon(stand, schritt.key);
  const antworten = { ...stand.antworten };
  delete antworten[`${schritt.key}#entwurf`];
  const ohneEntwurf = { ...stand, antworten: { ...antworten, [schritt.key]: { wert: 0, belege } } };
  return beantworten(input, ohneEntwurf, schritt, manuell);
}

/** Beleg aus einer Sammel-Frage wieder entfernen. */
export function belegEntfernen(input: TaxInput, stand: InterviewStand, schritt: Schritt, index: number): Ergebnis {
  if (schritt.frage.typ !== "sammeln") return { input, stand };
  const entwurfKey = `${schritt.key}#entwurf`;
  const quelle = stand.antworten[entwurfKey] ?? stand.antworten[schritt.key] ?? { wert: 0, belege: [] };
  const belege = (quelle.belege ?? []).filter((_, i) => i !== index);
  const manuell = Number(quelle.wert) || 0;
  const ctx: Ctx = { ...schritt.ctx, input, antworten: stand.antworten };
  return {
    input: schritt.frage.anwenden(manuell + summe(belege), ctx),
    stand: { ...stand, antworten: { ...stand.antworten, [entwurfKey]: { wert: manuell, belege } } },
  };
}

/** Lesbare Darstellung einer gegebenen Antwort für den Verlauf. */
export function antwortText(schritt: Schritt, antwort: Antwort | undefined): string {
  if (!antwort) return "";
  const { frage } = schritt;
  const w = antwort.wert;
  if (w === null) return "Übersprungen";
  switch (frage.typ) {
    case "janein":
      return w ? "Ja" : "Nein";
    case "auswahl":
      return frage.optionen(schritt.ctx).find((o) => o.wert === w)?.label ?? String(w);
    case "zahl":
      return `${Number(w).toLocaleString("de-DE")} ${frage.einheit}`;
    case "text":
      return String(w) || "–";
    case "sammeln": {
      const s = (Number(w) || 0) + summe(antwort.belege ?? []);
      const n = antwort.belege?.length ?? 0;
      return `${s.toLocaleString("de-DE", { maximumFractionDigits: 2 })} €${n ? ` (${n} Beleg${n > 1 ? "e" : ""})` : ""}`;
    }
    case "dokument":
      return w === "beleg" ? "📄 Beleg übernommen" : "Werte eingetragen";
    default:
      return "";
  }
}

/** Schlüssel ohne Entwürfe – zum Zählen und Anzeigen. */
export const istEntwurf = (key: string) => key.endsWith("#entwurf");
