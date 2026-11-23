"use client";

import { useEffect, useMemo, useState } from "react";
import Chat, { type ChatEintrag } from "@/components/Chat";
import DatenFormular from "@/components/DatenFormular";
import ElsterHilfe from "@/components/ElsterHilfe";
import { ErgebnisDetails, ErgebnisHero } from "@/components/Ergebnis";
import { berechne } from "@/lib/tax/engine";
import { defaultInput, parseTaxInput, type TaxInput } from "@/lib/tax/schema";

interface Haushalt {
  id: string;
  name: string;
  input: TaxInput;
  eintraege: ChatEintrag[];
  history: unknown[];
}

const STORAGE_KEY = "steuerbot.haushalte.v1";

function neuerHaushalt(name: string): Haushalt {
  return { id: crypto.randomUUID(), name, input: defaultInput(), eintraege: [], history: [] };
}

function laden(): Haushalt[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Haushalt[];
    return list.map((h) => ({ ...h, input: parseTaxInput(h.input) }));
  } catch {
    return [];
  }
}

export default function Home() {
  const [haushalte, setHaushalte] = useState<Haushalt[] | null>(null);
  const [aktivId, setAktivId] = useState<string>("");
  const [ansicht, setAnsicht] = useState<"rechner" | "elster">("rechner");

  useEffect(() => {
    const list = laden();
    const start = list.length ? list : [neuerHaushalt("Mein Haushalt")];
    setHaushalte(start);
    setAktivId(start[0].id);
  }, []);

  useEffect(() => {
    if (!haushalte) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(haushalte));
    } catch {
      /* Speicher voll oder blockiert – App funktioniert trotzdem */
    }
  }, [haushalte]);

  const aktiv = haushalte?.find((h) => h.id === aktivId) ?? haushalte?.[0];
  const ergebnis = useMemo(() => (aktiv ? berechne(aktiv.input) : null), [aktiv]);

  if (!haushalte || !aktiv || !ergebnis) return <div className="shell">Lädt …</div>;

  const aendern = (patch: Partial<Haushalt>) =>
    setHaushalte((list) => list!.map((h) => (h.id === aktiv.id ? { ...h, ...patch } : h)));

  function hinzufuegen() {
    const name = prompt("Name des Haushalts (z. B. „Mama & Papa“):");
    if (!name) return;
    const h = neuerHaushalt(name);
    setHaushalte([...haushalte!, h]);
    setAktivId(h.id);
  }

  function loeschen() {
    if (haushalte!.length <= 1 || !confirm(`„${aktiv!.name}“ wirklich löschen?`)) return;
    const rest = haushalte!.filter((h) => h.id !== aktiv!.id);
    setHaushalte(rest);
    setAktivId(rest[0].id);
  }

  function exportieren() {
    const blob = new Blob([JSON.stringify(aktiv, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `steuerbot-${aktiv!.name.replace(/\W+/g, "_")}-${aktiv!.input.jahr}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importieren(file: File) {
    try {
      const h = JSON.parse(await file.text()) as Haushalt;
      const neu: Haushalt = { ...neuerHaushalt(h.name ?? "Import"), input: parseTaxInput(h.input), eintraege: h.eintraege ?? [], history: h.history ?? [] };
      setHaushalte([...haushalte!, neu]);
      setAktivId(neu.id);
    } catch {
      alert("Die Datei konnte nicht gelesen werden.");
    }
  }

  return (
    <div className="shell">
      <header className="header no-print">
        <div>
          <h1>Steuerbot</h1>
          <p>Voraussichtliche Steuererstattung für Arbeitnehmer – mit KI-Assistent</p>
        </div>
        <div className="row">
          <select value={aktiv.id} onChange={(e) => setAktivId(e.target.value)} className="tab" aria-label="Haushalt">
            {haushalte.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <button className="secondary" onClick={hinzufuegen}>+ Haushalt</button>
          <button className="secondary" onClick={exportieren} title="Als Datei sichern">Sichern</button>
          <label className="secondary" style={{ border: "1px solid var(--accent)", borderRadius: 8, padding: "8px 14px", color: "var(--accent)", cursor: "pointer" }}>
            Laden
            <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importieren(e.target.files[0])} />
          </label>
          {haushalte.length > 1 && (
            <button className="secondary" onClick={loeschen}>Löschen</button>
          )}
        </div>
      </header>

      <div className="layout">
        <main>
          <div className="tabs no-print">
            <button className={`tab ${ansicht === "rechner" ? "active" : ""}`} onClick={() => setAnsicht("rechner")}>
              Rechner
            </button>
            <button className={`tab ${ansicht === "elster" ? "active" : ""}`} onClick={() => setAnsicht("elster")}>
              Ausfüllhilfe für ELSTER
            </button>
          </div>
          {ansicht === "rechner" ? (
            <>
              <ErgebnisHero r={ergebnis} />
              <DatenFormular input={aktiv.input} onChange={(input) => aendern({ input })} />
              <ErgebnisDetails r={ergebnis} />
            </>
          ) : (
            <ElsterHilfe input={aktiv.input} r={ergebnis} />
          )}
        </main>
        <aside className="no-print">
          <Chat
            input={aktiv.input}
            onInputChange={(input) => aendern({ input })}
            eintraege={aktiv.eintraege}
            history={aktiv.history}
            onChatChange={(eintraege, history) => aendern({ eintraege, history })}
          />
        </aside>
      </div>
      <a href="#assistent" className="fab no-print">💬 Assistent</a>
      <p className="disclaimer no-print">
        Deine Daten bleiben in diesem Browser. Nur Chat-Nachrichten, der Datenstand und hochgeladene Belege werden zur
        Auswertung an die Claude-API (Anthropic) gesendet.
      </p>
    </div>
  );
}
