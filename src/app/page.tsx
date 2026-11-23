"use client";

import { useMemo, useState } from "react";
import Chat from "@/components/Chat";
import DatenFormular from "@/components/DatenFormular";
import ElsterHilfe from "@/components/ElsterHilfe";
import { ErgebnisDetails, ErgebnisHero } from "@/components/Ergebnis";
import Fragebogen from "@/components/Fragebogen";
import { euro } from "@/lib/format";
import { LEERER_STAND } from "@/lib/interview/typen";
import { berechne } from "@/lib/tax/engine";
import { useHaushalte, useServerStatus } from "@/lib/useHaushalte";

type MobilTab = "ergebnis" | "angaben" | "assistent" | "elster";

/** Klassen: auf Desktop / auf dem Handy ausblenden */
const cls = (desktopSichtbar: boolean, mobilSichtbar: boolean) =>
  [desktopSichtbar ? "" : "d-hide", mobilSichtbar ? "" : "m-hide"].join(" ").trim();

export default function Home() {
  const { haushalte, aktiv, setAktivId, aendern, anlegen, loeschen, allesLoeschen, exportieren, importieren } = useHaushalte();
  const { ki: kiVerfuegbar, anmeldung } = useServerStatus();
  const [ansicht, setAnsicht] = useState<"rechner" | "elster">("rechner");
  const [mobilTab, setMobilTab] = useState<MobilTab>("ergebnis");
  const [modus, setModus] = useState<"fragebogen" | "ki">("fragebogen");
  const ergebnis = useMemo(() => (aktiv ? berechne(aktiv.input) : null), [aktiv]);

  if (!haushalte || !aktiv || !ergebnis) return <div className="shell">Lädt …</div>;

  const wechseln = (tab: MobilTab) => {
    setMobilTab(tab);
    // Ansicht für Drucken/Desktop mitführen
    setAnsicht(tab === "elster" ? "elster" : "rechner");
    window.scrollTo({ top: 0 });
  };

  function hinzufuegen() {
    const name = prompt("Name des Haushalts (z. B. „Mama & Papa“):");
    if (name) anlegen(name);
  }

  const aktivenLoeschen = () => {
    if (haushalte.length > 1 && confirm(`„${aktiv.name}“ wirklich löschen?`)) loeschen();
  };

  function datenLoeschen() {
    if (confirm("Alle Haushalte und Angaben aus diesem Browser löschen? Das kann nicht rückgängig gemacht werden. Sichere sie vorher, falls nötig.")) {
      allesLoeschen();
    }
  }

  async function laden(datei: File) {
    try {
      await importieren(datei);
    } catch {
      alert("Die Datei konnte nicht gelesen werden.");
    }
  }

  async function abmelden() {
    await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login";
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
        <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && laden(e.target.files[0])} />
      </label>
      {haushalte.length > 1 && (
        <button className="secondary" onClick={aktivenLoeschen}>
          Löschen
        </button>
      )}
      <button className="secondary" onClick={datenLoeschen} title="Alle Steuerdaten aus diesem Browser entfernen">
        Daten löschen
      </button>
      {anmeldung && (
        <button className="secondary" onClick={abmelden}>
          Abmelden
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
            {keineDaten ? "–" : `${plus ? "+" : "−"} ${euro(Math.abs(ergebnis.erstattung), 0)}`}
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
