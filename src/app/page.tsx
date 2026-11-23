"use client";

import { useEffect, useMemo, useState } from "react";
import Chat, { type ChatEintrag } from "@/components/Chat";
import DatenFormular from "@/components/DatenFormular";
import Fragebogen from "@/components/Fragebogen";
import { LEERER_STAND, type InterviewStand } from "@/lib/interview/typen";
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
  interview?: InterviewStand;
}

type MobilTab = "ergebnis" | "angaben" | "assistent" | "elster";

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

const eur0 = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** Klassen: auf Desktop / auf dem Handy ausblenden */
const cls = (desktopSichtbar: boolean, mobilSichtbar: boolean) =>
  [desktopSichtbar ? "" : "d-hide", mobilSichtbar ? "" : "m-hide"].join(" ").trim();

export default function Home() {
  const [haushalte, setHaushalte] = useState<Haushalt[] | null>(null);
  const [aktivId, setAktivId] = useState<string>("");
  const [ansicht, setAnsicht] = useState<"rechner" | "elster">("rechner");
  const [mobilTab, setMobilTab] = useState<MobilTab>("ergebnis");
  const [modus, setModus] = useState<"fragebogen" | "ki">("fragebogen");
  const [kiVerfuegbar, setKiVerfuegbar] = useState(false);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((d) => setKiVerfuegbar(Boolean(d.ki)))
      .catch(() => setKiVerfuegbar(false));
  }, []);

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

  const wechseln = (tab: MobilTab) => {
    setMobilTab(tab);
    // Ansicht für Drucken/Desktop mitführen
    setAnsicht(tab === "elster" ? "elster" : "rechner");
    window.scrollTo({ top: 0 });
  };

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
      const neu: Haushalt = {
        ...neuerHaushalt(h.name ?? "Import"),
        input: parseTaxInput(h.input),
        eintraege: h.eintraege ?? [],
        history: h.history ?? [],
      };
      setHaushalte([...haushalte!, neu]);
      setAktivId(neu.id);
    } catch {
      alert("Die Datei konnte nicht gelesen werden.");
    }
  }

  const haushaltAuswahl = (
    <select value={aktiv.id} onChange={(e) => setAktivId(e.target.value)} className="tab" aria-label="Haushalt">
      {haushalte.map((h) => (
        <option key={h.id} value={h.id}>
          {h.name}
        </option>
      ))}
    </select>
  );

  const aktionen = (
    <>
      <button className="secondary" onClick={hinzufuegen}>
        + Haushalt
      </button>
      <button className="secondary" onClick={exportieren} title="Als Datei sichern">
        Sichern
      </button>
      <label className="secondary button-like">
        Laden
        <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importieren(e.target.files[0])} />
      </label>
      {haushalte.length > 1 && (
        <button className="secondary" onClick={loeschen}>
          Löschen
        </button>
      )}
    </>
  );

  const umschalter = (
    <div className="modus-umschalter" role="tablist">
      <button role="tab" aria-selected={modus === "fragebogen"} className={modus === "fragebogen" ? "active" : ""} onClick={() => setModus("fragebogen")}>
        📋 Fragebogen
      </button>
      <button role="tab" aria-selected={modus === "ki"} className={modus === "ki" ? "active" : ""} onClick={() => setModus("ki")}>
        💬 KI-Chat
      </button>
    </div>
  );

  const keineDaten = ergebnis.bereitsGezahlt.gesamt === 0 && ergebnis.summeEinkuenfte === 0;
  const plus = ergebnis.erstattung >= 0;

  return (
    <div className="shell" data-mtab={mobilTab}>
      {/* ---------- Kopfzeile ---------- */}
      <header className="header no-print">
        <div>
          <h1>Steuerbot</h1>
          <p className="m-hide">Voraussichtliche Steuererstattung für Arbeitnehmer – mit KI-Assistent</p>
        </div>
        <div className="row m-hide">
          {haushaltAuswahl}
          {aktionen}
        </div>
        <div className="row d-hide">
          {haushaltAuswahl}
          <details className="menu">
            <summary aria-label="Weitere Aktionen">⋯</summary>
            <div className="menu-items">{aktionen}</div>
          </details>
        </div>
      </header>

      {/* ---------- Mini-Leiste mit Erstattung (nur Handy, außer im Ergebnis-Tab) ---------- */}
      {mobilTab !== "ergebnis" && mobilTab !== "elster" && (
        <button className="minibar d-hide no-print" onClick={() => wechseln("ergebnis")}>
          <span>Voraussichtlich {aktiv.input.jahr}</span>
          <strong className={keineDaten ? "" : plus ? "plus" : "minus"}>
            {keineDaten ? "–" : `${plus ? "+" : "−"} ${eur0(Math.abs(ergebnis.erstattung))}`}
          </strong>
        </button>
      )}

      <div className="layout">
        <main>
          <div className="tabs no-print m-hide">
            <button className={`tab ${ansicht === "rechner" ? "active" : ""}`} onClick={() => setAnsicht("rechner")}>
              Rechner
            </button>
            <button className={`tab ${ansicht === "elster" ? "active" : ""}`} onClick={() => setAnsicht("elster")}>
              Ausfüllhilfe für ELSTER
            </button>
          </div>

          <div className={cls(ansicht === "rechner", mobilTab === "ergebnis")}>
            <ErgebnisHero r={ergebnis} onAngaben={() => wechseln("angaben")} onAssistent={() => wechseln("assistent")} />
          </div>
          <div className={cls(ansicht === "rechner", mobilTab === "angaben")}>
            <DatenFormular input={aktiv.input} ergebnis={ergebnis} onChange={(input) => aendern({ input })} />
          </div>
          <div className={cls(ansicht === "rechner", mobilTab === "ergebnis")}>
            <ErgebnisDetails r={ergebnis} />
          </div>
          {(ansicht === "elster" || mobilTab === "elster") && (
            <div className={cls(ansicht === "elster", mobilTab === "elster")}>
              <ElsterHilfe input={aktiv.input} r={ergebnis} />
            </div>
          )}
        </main>
        <aside className={`no-print ${cls(true, mobilTab === "assistent")}`}>
          {modus === "fragebogen" ? (
            <Fragebogen
              input={aktiv.input}
              stand={aktiv.interview ?? LEERER_STAND}
              kiVerfuegbar={kiVerfuegbar}
              onChange={(input, interview) => aendern({ input, interview })}
              onKiChat={() => setModus("ki")}
              onZiel={(ziel) => wechseln(ziel)}
              umschalter={umschalter}
            />
          ) : (
            <Chat
              input={aktiv.input}
              onInputChange={(input) => aendern({ input })}
              eintraege={aktiv.eintraege}
              history={aktiv.history}
              onChatChange={(eintraege, history) => aendern({ eintraege, history })}
              kiVerfuegbar={kiVerfuegbar}
              umschalter={umschalter}
            />
          )}
        </aside>
      </div>

      <p className={`disclaimer no-print ${mobilTab === "assistent" ? "m-hide" : ""}`}>
        Deine Daten bleiben in diesem Browser. Nur Chat-Nachrichten, der Datenstand und hochgeladene Belege werden zur
        Auswertung an die Claude-API (Anthropic) gesendet.
      </p>

      {/* ---------- Untere Navigation (nur Handy) ---------- */}
      <nav className="bottomnav d-hide no-print" aria-label="Bereiche">
        {(
          [
            ["ergebnis", "💶", "Ergebnis"],
            ["angaben", "📝", "Angaben"],
            ["assistent", "💬", "Assistent"],
            ["elster", "📄", "ELSTER"],
          ] as [MobilTab, string, string][]
        ).map(([id, icon, label]) => (
          <button key={id} className={mobilTab === id ? "active" : ""} onClick={() => wechseln(id)} aria-current={mobilTab === id}>
            <span aria-hidden>{icon}</span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
