"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChatEintrag } from "@/components/Chat";
import { LEERER_STAND, type InterviewStand } from "@/lib/interview/typen";
import { defaultInput, parseTaxInput, type TaxInput } from "@/lib/tax/schema";

/** Ein Haushalt mit Datenstand, KI-Chat und Fragebogen – liegt nur im Browser (localStorage). */
export interface Haushalt {
  id: string;
  name: string;
  input: TaxInput;
  eintraege: ChatEintrag[];
  history: unknown[];
  interview?: InterviewStand;
}

const STORAGE_KEY = "steuerbot.haushalte.v1";

function neuerHaushalt(name: string): Haushalt {
  return { id: crypto.randomUUID(), name, input: defaultInput(), eintraege: [], history: [], interview: LEERER_STAND };
}

/** Gespeicherte Daten einlesen; ungültige Einträge werden über das Schema repariert oder verworfen. */
function laden(): Haushalt[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Haushalt[]).map((h) => ({ ...h, input: parseTaxInput(h.input) }));
  } catch {
    return [];
  }
}

function speichern(list: Haushalt[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* Speicher voll oder blockiert – App funktioniert trotzdem */
  }
}

/** Verwaltung der Haushalte im Browser: Auswahl, Ändern, Anlegen, Löschen, Sichern und Laden. */
export function useHaushalte() {
  const [haushalte, setHaushalte] = useState<Haushalt[] | null>(null);
  const [aktivId, setAktivId] = useState("");

  useEffect(() => {
    const list = laden();
    const start = list.length ? list : [neuerHaushalt("Mein Haushalt")];
    setHaushalte(start);
    setAktivId(start[0].id);
  }, []);

  useEffect(() => {
    if (haushalte) speichern(haushalte);
  }, [haushalte]);

  const aktiv = haushalte?.find((h) => h.id === aktivId) ?? haushalte?.[0] ?? null;

  const hinzufuegenListe = useCallback((h: Haushalt) => {
    setHaushalte((list) => [...(list ?? []), h]);
    setAktivId(h.id);
  }, []);

  /** Felder des aktiven Haushalts ändern. */
  const aendern = useCallback(
    (patch: Partial<Haushalt>) => setHaushalte((list) => list?.map((h) => (h.id === aktiv?.id ? { ...h, ...patch } : h)) ?? list),
    [aktiv?.id],
  );

  const anlegen = useCallback((name: string) => hinzufuegenListe(neuerHaushalt(name)), [hinzufuegenListe]);

  /** Aktiven Haushalt löschen (der letzte bleibt erhalten). */
  const loeschen = useCallback(() => {
    setHaushalte((list) => {
      if (!list || list.length <= 1) return list;
      const rest = list.filter((h) => h.id !== aktiv?.id);
      setAktivId(rest[0].id);
      return rest;
    });
  }, [aktiv?.id]);

  /** Alle Daten aus dem Browser entfernen und neu beginnen. */
  const allesLoeschen = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignorieren */
    }
    const h = neuerHaushalt("Mein Haushalt");
    setHaushalte([h]);
    setAktivId(h.id);
  }, []);

  /** Aktiven Haushalt als JSON-Datei herunterladen. */
  const exportieren = useCallback(() => {
    if (!aktiv) return;
    const blob = new Blob([JSON.stringify(aktiv, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `steuerbot-${aktiv.name.replace(/\W+/g, "_")}-${aktiv.input.jahr}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [aktiv]);

  /** Gesicherte Datei als neuen Haushalt laden; wirft bei ungültiger Datei. */
  const importieren = useCallback(
    async (datei: File) => {
      const h = JSON.parse(await datei.text()) as Partial<Haushalt>;
      hinzufuegenListe({
        ...neuerHaushalt(h.name ?? "Import"),
        input: parseTaxInput(h.input),
        eintraege: h.eintraege ?? [],
        history: h.history ?? [],
        interview: h.interview ?? LEERER_STAND,
      });
    },
    [hinzufuegenListe],
  );

  return { haushalte, aktiv, setAktivId, aendern, anlegen, loeschen, allesLoeschen, exportieren, importieren };
}

/** Server-Fähigkeiten: KI verfügbar, Anmeldung aktiv. */
export function useServerStatus() {
  const [status, setStatus] = useState({ ki: false, anmeldung: false });
  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((d) => setStatus({ ki: Boolean(d.ki), anmeldung: Boolean(d.anmeldung) }))
      .catch(() => undefined);
  }, []);
  return status;
}
