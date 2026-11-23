import type { BelegDaten } from "./beleg-mapping";

/** Lädt eine Datei zur Belegerkennung hoch und liefert die ausgelesenen Daten (wirft bei Fehlern mit lesbarer Meldung). */
export async function belegAuslesenLassen(datei: File): Promise<BelegDaten> {
  const fd = new FormData();
  fd.append("datei", datei);
  const res = await fetch("/api/beleg", { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
  return data.beleg as BelegDaten;
}
