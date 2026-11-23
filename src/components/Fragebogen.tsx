"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { belegAuslesenLassen } from "@/lib/assistant/beleg-upload";
import {
  antwortText,
  beantworten,
  belegEntfernen,
  belegeVon,
  belegHinzufuegen,
  fortschritt,
  naechsterSchritt,
  sammelnAbschliessen,
  schrittFuer,
} from "@/lib/interview/ablauf";
import { LEERER_STAND, type InterviewStand, type Schritt } from "@/lib/interview/typen";
import { berechne } from "@/lib/tax/engine";
import type { TaxInput } from "@/lib/tax/schema";
import { NumField } from "./NumField";
import { euro } from "@/lib/format";

interface Props {
  input: TaxInput;
  stand: InterviewStand;
  kiVerfuegbar: boolean;
  onChange: (input: TaxInput, stand: InterviewStand) => void;
  onKiChat: () => void;
  onZiel: (ziel: "ergebnis" | "elster" | "angaben") => void;
  umschalter?: React.ReactNode;
}


export default function Fragebogen({ input, stand, kiVerfuegbar, onChange, onKiChat, onZiel, umschalter }: Props) {
  const [bearbeiten, setBearbeiten] = useState<string | null>(null);
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const logRef = useRef<HTMLDivElement>(null);

  const aktuell: Schritt | null = useMemo(
    () => (bearbeiten ? schrittFuer(input, stand, bearbeiten) : null) ?? naechsterSchritt(input, stand),
    [input, stand, bearbeiten],
  );
  const fs = useMemo(() => fortschritt(input, stand), [input, stand]);
  const erstattung = useMemo(() => berechne(input).erstattung, [input]);

  // Verlauf: nur Antworten, deren Frage noch relevant ist
  const verlauf = useMemo(
    () =>
      stand.verlauf
        .map((key) => schrittFuer(input, stand, key))
        .filter((s): s is Schritt => !!s && s.key !== bearbeiten),
    [input, stand, bearbeiten],
  );

  useEffect(() => {
    // Nach dem Rendern (auch der Eingabe darunter) ans Ende scrollen
    const t = setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }), 60);
    return () => clearTimeout(t);
  }, [stand.verlauf.length, aktuell?.key]);

  function uebernehmen(nextInput: TaxInput, nextStand: InterviewStand, key: string) {
    const diff = Math.round(berechne(nextInput).erstattung - erstattung);
    if (diff !== 0) setDeltas((d) => ({ ...d, [key]: diff }));
    setBearbeiten(null);
    onChange(nextInput, nextStand);
  }

  function antworten(wert: unknown) {
    if (!aktuell) return;
    const r = aktuell.frage.typ === "sammeln" && wert !== null
      ? sammelnAbschliessen(input, stand, aktuell, Number(wert) || 0)
      : beantworten(input, stand, aktuell, wert);
    uebernehmen(r.input, r.stand, aktuell.key);
  }

  const leer = stand.verlauf.length === 0 && !bearbeiten;

  return (
    <div className="card chat fragebogen" id="assistent">
      <div className="chat-head">
        {umschalter}
        <div className="kapitel" aria-label="Fortschritt">
          {fs.kapitel
            .filter((k) => k.status !== "leer")
            .map((k) => (
              <span key={k.id} className={`kapitel-chip ${k.status}`} title={k.label}>
                {k.status === "fertig" ? "✓" : k.icon} <span className="kapitel-label">{k.label}</span>
              </span>
            ))}
          <span className="muted zaehler">
            {fs.beantwortet}/{fs.gesamt}
          </span>
        </div>
        <div className="progress">
          <div style={{ width: `${fs.gesamt ? (fs.beantwortet / fs.gesamt) * 100 : 0}%` }} />
        </div>
      </div>

      <div className="chat-log" ref={logRef}>
        {leer && (
          <div className="msg assistant">
            Hallo! 👋 Ich stelle dir Schritt für Schritt die wichtigsten Fragen zu deiner Steuererklärung – das dauert etwa
            5 Minuten. Nach jeder Antwort siehst du, wie sich deine Erstattung verändert. Was du nicht weißt, kannst du
            einfach überspringen.
          </div>
        )}
        {verlauf.map((s) => (
          <div key={s.key} className="qa">
            <div className="msg assistant small">{fragetext(s, input)}</div>
            <div className="msg user">
              {antwortText(s, stand.antworten[s.key])}
              <button className="aendern" onClick={() => setBearbeiten(s.key)} aria-label="Antwort ändern">
                ändern
              </button>
            </div>
            {deltas[s.key] ? (
              <div className={`msg system delta ${deltas[s.key] > 0 ? "plus" : "minus"}`}>
                {deltas[s.key] > 0 ? `+ ${euro(deltas[s.key], 0)} Erstattung 🎉` : `− ${euro(-deltas[s.key], 0)}`}
              </div>
            ) : null}
          </div>
        ))}

        {aktuell ? (
          <FrageBlase key={aktuell.key} schritt={aktuell} input={input} />
        ) : (
          <Abschluss erstattung={erstattung} onZiel={onZiel} onKiChat={onKiChat} onNeu={() => onChange(input, LEERER_STAND)} />
        )}
      </div>

      {aktuell && (
        <Eingabe
          key={aktuell.key + (bearbeiten ? "-edit" : "")}
          schritt={aktuell}
          input={input}
          stand={stand}
          kiVerfuegbar={kiVerfuegbar}
          bearbeiten={!!bearbeiten}
          onAntwort={antworten}
          onAbbrechen={() => setBearbeiten(null)}
          onZwischenstand={(i, s) => onChange(i, s)}
          onUebernehmen={(i, s) => uebernehmen(i, s, aktuell.key)}
          onKiChat={onKiChat}
        />
      )}
    </div>
  );
}

function fragetext(s: Schritt, input: TaxInput) {
  return s.frage.text({ ...s.ctx, input });
}

function FrageBlase({ schritt, input }: { schritt: Schritt; input: TaxInput }) {
  const [hilfe, setHilfe] = useState(false);
  const zeigePerson = schritt.frage.scope === "person" && input.zusammenveranlagung;
  const p = input.personen[schritt.ctx.p];
  return (
    <div className="msg assistant frage">
      {zeigePerson && <div className="person-chip">👤 {p?.name || `Person ${schritt.ctx.p + 1}`}</div>}
      <div>{fragetext(schritt, input)}</div>
      {schritt.frage.erklaerung && (
        <>
          <button className="link" onClick={() => setHilfe((h) => !h)}>
            ❓ {hilfe ? "Erklärung ausblenden" : "Was heißt das?"}
          </button>
          {hilfe && <div className="erklaerung">{schritt.frage.erklaerung}</div>}
        </>
      )}
    </div>
  );
}

function Abschluss({
  erstattung,
  onZiel,
  onKiChat,
  onNeu,
}: {
  erstattung: number;
  onZiel: Props["onZiel"];
  onKiChat: () => void;
  onNeu: () => void;
}) {
  return (
    <div className="msg assistant frage">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Geschafft! 🎉</div>
      <div>
        Voraussichtlich bekommst du{" "}
        <strong>{erstattung >= 0 ? `${euro(erstattung, 0)} zurück` : `keine Erstattung – Nachzahlung ${euro(-erstattung, 0)}`}</strong>.
        Tipp auf eine Antwort oben, um sie zu ändern.
      </div>
      <div className="abschluss-aktionen">
        <button className="primary" onClick={() => onZiel("ergebnis")}>
          💶 Ergebnis ansehen
        </button>
        <button className="secondary" onClick={() => onZiel("elster")}>
          📄 Ausfüllhilfe für ELSTER
        </button>
        <button className="secondary" onClick={onKiChat}>
          💬 Noch Fragen? KI fragen
        </button>
        <button className="link" onClick={() => confirm("Fragebogen neu starten? Deine Angaben bleiben erhalten.") && onNeu()}>
          Fragebogen neu starten
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Eingabebereich je Fragetyp
// ---------------------------------------------------------------------------

function Eingabe({
  schritt,
  input,
  stand,
  kiVerfuegbar,
  bearbeiten,
  onAntwort,
  onAbbrechen,
  onZwischenstand,
  onUebernehmen,
  onKiChat,
}: {
  schritt: Schritt;
  input: TaxInput;
  stand: InterviewStand;
  kiVerfuegbar: boolean;
  bearbeiten: boolean;
  onAntwort: (wert: unknown) => void;
  onAbbrechen: () => void;
  onZwischenstand: (input: TaxInput, stand: InterviewStand) => void;
  onUebernehmen: (input: TaxInput, stand: InterviewStand) => void;
  onKiChat: () => void;
}) {
  const { frage } = schritt;
  const ctx = { ...schritt.ctx, input, antworten: stand.antworten };
  const [zahl, setZahl] = useState<number>(() => (frage.typ === "zahl" ? frage.aktuell(ctx) : frage.typ === "sammeln" ? Number(stand.antworten[schritt.key]?.wert) || 0 : 0));
  const [text, setText] = useState(() => (frage.typ === "text" ? frage.aktuell(ctx) : ""));
  const [auswahl, setAuswahl] = useState(() => (frage.typ === "auswahl" ? frage.aktuell?.(ctx) ?? "" : ""));
  const [werte, setWerte] = useState<Record<string, number>>(() => (frage.typ === "dokument" ? frage.aktuell(ctx) : {}));
  const [manuell, setManuell] = useState(false);
  const [laedt, setLaedt] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; fehler?: boolean } | null>(null);
  const dateiRef = useRef<HTMLInputElement>(null);
  const kameraRef = useRef<HTMLInputElement>(null);

  async function hochladen(file: File) {
    setLaedt(true);
    setMeldung(null);
    try {
      const r = belegHinzufuegen(input, stand, schritt, await belegAuslesenLassen(file));
      if ("fehler" in r) {
        setMeldung({ text: r.fehler, fehler: true });
      } else if (frage.typ === "dokument") {
        // Dokument gilt mit dem Upload als beantwortet → nächste Frage
        onUebernehmen(r.input, r.stand);
      } else {
        // Der Beleg erscheint in der Liste – keine zusätzliche Meldung nötig
        onZwischenstand(r.input, r.stand);
      }
    } catch (e) {
      setMeldung({ text: `${e instanceof Error ? e.message : String(e)} – bitte eintippen.`, fehler: true });
    } finally {
      setLaedt(false);
      if (dateiRef.current) dateiRef.current.value = "";
      if (kameraRef.current) kameraRef.current.value = "";
    }
  }

  const upload = kiVerfuegbar && (frage.typ === "sammeln" || frage.typ === "dokument") && (
    <div className="row">
      <input ref={kameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && hochladen(e.target.files[0])} />
      <input ref={dateiRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => e.target.files?.[0] && hochladen(e.target.files[0])} />
      <button className="secondary d-hide" disabled={laedt} onClick={() => kameraRef.current?.click()}>
        📷 Foto
      </button>
      <button className="secondary" disabled={laedt} onClick={() => dateiRef.current?.click()}>
        📎 {frage.typ === "dokument" ? frage.belegHinweis : "Beleg"} hochladen
      </button>
      {laedt && <span className="muted">wird ausgelesen …</span>}
    </div>
  );

  const fuss = (
    <div className="row fuss">
      {bearbeiten ? (
        <button className="link" onClick={onAbbrechen}>
          Abbrechen
        </button>
      ) : (
        !frage.pflicht && (
          <button className="link" onClick={() => onAntwort(null)}>
            Überspringen
          </button>
        )
      )}
      {kiVerfuegbar && (
        <button className="link" onClick={onKiChat}>
          💬 Frag die KI
        </button>
      )}
    </div>
  );

  let inhalt: React.ReactNode = null;
  switch (frage.typ) {
    case "janein": {
      const akt = frage.aktuell?.(ctx);
      inhalt = (
        <div className="antwort-knoepfe">
          <button className={akt === true && bearbeiten ? "primary" : "secondary"} onClick={() => onAntwort(true)}>
            Ja
          </button>
          <button className={akt === false && bearbeiten ? "primary" : "secondary"} onClick={() => onAntwort(false)}>
            Nein
          </button>
        </div>
      );
      break;
    }
    case "auswahl": {
      const optionen = frage.optionen(ctx);
      inhalt = frage.liste ? (
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <div className="field" style={{ flex: 1 }}>
            <select value={auswahl} onChange={(e) => setAuswahl(e.target.value)} aria-label="Auswahl">
              <option value="" disabled>
                Bitte wählen …
              </option>
              {optionen.map((o) => (
                <option key={o.wert} value={o.wert}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button className="primary" disabled={!auswahl} onClick={() => onAntwort(auswahl)}>
            Weiter
          </button>
        </div>
      ) : (
        <div className="antwort-knoepfe">
          {optionen.map((o) => (
            <button key={o.wert} className={auswahl === o.wert && bearbeiten ? "primary" : "secondary"} onClick={() => onAntwort(o.wert)}>
              {o.label}
            </button>
          ))}
        </div>
      );
      break;
    }
    case "zahl":
      inhalt = (
        <>
          {frage.vorschlaege && (
            <div className="chips">
              {frage.vorschlaege.map((v) => (
                <button key={v} className="chip" onClick={() => onAntwort(v)}>
                  {v === 0 && frage.einheit.includes("€") ? "Nein / 0 €" : `${v} ${frage.einheit}`}
                </button>
              ))}
            </div>
          )}
          <form
            className="row zahl-eingabe"
            onSubmit={(e) => {
              e.preventDefault();
              onAntwort(zahl);
            }}
          >
            <div style={{ flex: 1 }}>
              <NumField label="" ganzzahl={frage.ganzzahl} einheit={frage.einheit} value={zahl} onChange={setZahl} />
            </div>
            <button type="submit" className="primary">
              Weiter
            </button>
          </form>
        </>
      );
      break;
    case "text":
      inhalt = (
        <form
          className="row"
          style={{ flexWrap: "nowrap" }}
          onSubmit={(e) => {
            e.preventDefault();
            onAntwort(text);
          }}
        >
          <div className="field" style={{ flex: 1 }}>
            <input type="text" value={text} placeholder={frage.platzhalter} onChange={(e) => setText(e.target.value)} enterKeyHint="next" aria-label="Antwort" />
          </div>
          <button type="submit" className="primary">
            Weiter
          </button>
        </form>
      );
      break;
    case "sammeln": {
      const belege = belegeVon(stand, schritt.key);
      const summeBelege = belege.reduce((s, b) => s + b.betrag, 0);
      inhalt = (
        <>
          {belege.length > 0 && (
            <ul className="beleg-liste">
              {belege.map((b, i) => (
                <li key={i}>
                  <span>📄 {b.text}</span>
                  <span>
                    {euro(b.betrag)}
                    <button
                      className="link danger"
                      aria-label="Beleg entfernen"
                      onClick={() => {
                        const r = belegEntfernen(input, stand, schritt, i);
                        onZwischenstand(r.input, r.stand);
                      }}
                    >
                      ✕
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {upload}
          <form
            className="row zahl-eingabe"
            onSubmit={(e) => {
              e.preventDefault();
              onAntwort(zahl);
            }}
          >
            <div style={{ flex: 1 }}>
              <NumField
                label={belege.length ? `${frage.manuellLabel} – zusätzlich zu den Belegen` : frage.manuellLabel}
                einheit="€"
                value={zahl}
                onChange={setZahl}
              />
            </div>
            <button type="submit" className="primary">
              Weiter{summeBelege + zahl > 0 ? ` (${euro(summeBelege + zahl)})` : ""}
            </button>
          </form>
        </>
      );
      break;
    }
    case "dokument":
      inhalt = (
        <>
          {upload}
          {!manuell ? (
            <div className="row">
              <button className={kiVerfuegbar ? "link" : "primary"} onClick={() => setManuell(true)}>
                ✍️ Werte selbst eintippen
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onAntwort(werte);
              }}
            >
              <div className="grid">
                {frage.felder.map((f) => (
                  <NumField
                    key={f.key}
                    label={f.label}
                    einheit={f.einheit}
                    ganzzahl={f.ganzzahl}
                    value={werte[f.key] ?? 0}
                    onChange={(v) => setWerte((w) => ({ ...w, [f.key]: v }))}
                  />
                ))}
              </div>
              <div className="row end" style={{ marginTop: 8 }}>
                <button type="submit" className="primary">
                  Übernehmen
                </button>
              </div>
            </form>
          )}
        </>
      );
      break;
    case "info":
      inhalt = (
        <button className="primary" onClick={() => onAntwort(true)}>
          Weiter
        </button>
      );
      break;
  }

  return (
    <div className="chat-input fragebogen-eingabe">
      {meldung && <div className={`meldung ${meldung.fehler ? "fehler" : ""}`}>{meldung.text}</div>}
      {inhalt}
      {fuss}
    </div>
  );
}
