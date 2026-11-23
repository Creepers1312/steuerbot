"use client";

import { useEffect, useRef, useState } from "react";
import { applyPatch, type Patch } from "@/lib/assistant/patch";
import { belegZuPatch, type BelegDaten } from "@/lib/assistant/beleg-mapping";
import { belegAuslesenLassen } from "@/lib/assistant/beleg-upload";
import type { TaxInput } from "@/lib/tax/schema";

export interface ChatEintrag {
  role: "user" | "assistant" | "system" | "error";
  text: string;
}

interface Props {
  input: TaxInput;
  onInputChange: (next: TaxInput) => void;
  eintraege: ChatEintrag[];
  history: unknown[];
  onChatChange: (eintraege: ChatEintrag[], history: unknown[]) => void;
  kiVerfuegbar?: boolean;
  umschalter?: React.ReactNode;
}

const MAX_VERLAUF_NACHRICHTEN = 80;
const MAX_VERLAUF_ZEICHEN = 400_000;

/** Minimales Markdown: **fett**, Aufzählungen mit „- “. */
function MiniMarkdown({ text }: { text: string }) {
  const inline = (zeile: string) =>
    zeile.split(/(\*\*[^*]+\*\*)/g).map((teil, i) =>
      teil.startsWith("**") && teil.endsWith("**") && teil.length > 4 ? <strong key={i}>{teil.slice(2, -2)}</strong> : teil,
    );
  return (
    <>
      {text.split("\n").map((zeile, i) =>
        /^\s*[-•*] /.test(zeile) ? (
          <div key={i} style={{ paddingLeft: 14, textIndent: -10 }}>
            • {inline(zeile.replace(/^\s*[-•*] /, ""))}
          </div>
        ) : (
          <div key={i} style={{ minHeight: zeile ? undefined : 8 }}>
            {inline(zeile)}
          </div>
        ),
      )}
    </>
  );
}

const VORSCHLAEGE = [
  "Lass uns mit meiner Lohnsteuerbescheinigung anfangen",
  "Ich habe nur meine letzte Gehaltsabrechnung",
  "Was kann ich als Pendler absetzen?",
  "Was habe ich wahrscheinlich vergessen?",
  "Erklär mir, wie die Erstattung zustande kommt",
];

export default function Chat({ input, onInputChange, eintraege, history, onChatChange, kiVerfuegbar = true, umschalter }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState("");
  const [status, setStatus] = useState("");
  const [vorschlag, setVorschlag] = useState<{ text: string; patch: Patch | null; beleg: BelegDaten } | null>(null);
  const [belegPerson, setBelegPerson] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const kameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [eintraege, busy, vorschlag, live]);

  async function senden(nachricht: string) {
    const msg = nachricht.trim();
    if (!msg || busy) return;
    setText("");

    // Lange Gespräche werden teuer: Verlauf neu beginnen, der Datenstand geht mit jeder Nachricht mit.
    let verlauf = history;
    let basis = eintraege;
    if (history.length > MAX_VERLAUF_NACHRICHTEN || JSON.stringify(history).length > MAX_VERLAUF_ZEICHEN) {
      verlauf = [];
      basis = [...eintraege, { role: "system", text: "Neues Gespräch begonnen – deine Angaben bleiben erhalten." }];
    }
    const mitUser: ChatEintrag[] = [...basis, { role: "user", text: msg }];
    onChatChange(mitUser, verlauf);
    setBusy(true);
    setLive("");
    setStatus("denkt nach …");

    let antwort = "";
    let fertig = false;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history: verlauf, input }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Fehler ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let puffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        puffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = puffer.indexOf("\n\n")) >= 0) {
          const zeile = puffer.slice(0, idx).replace(/^data: /, "");
          puffer = puffer.slice(idx + 2);
          if (!zeile.trim()) continue;
          const ev = JSON.parse(zeile);
          if (ev.type === "text") {
            antwort += ev.delta;
            setLive(antwort);
            setStatus("");
          } else if (ev.type === "status") {
            setStatus(ev.text);
          } else if (ev.type === "input") {
            onInputChange(ev.input);
          } else if (ev.type === "done") {
            fertig = true;
            onChatChange([...mitUser, { role: "assistant", text: ev.reply }], ev.messages);
          } else if (ev.type === "error") {
            throw new Error(ev.error);
          }
        }
      }
      if (!fertig) throw new Error("Verbindung abgebrochen.");
    } catch (e) {
      const fehler: ChatEintrag[] = antwort ? [{ role: "assistant", text: antwort }] : [];
      onChatChange([...mitUser, ...fehler, { role: "error", text: e instanceof Error ? e.message : String(e) }], verlauf);
    } finally {
      setBusy(false);
      setLive("");
      setStatus("");
    }
  }

  async function belegHochladen(file: File) {
    setBusy(true);
    setVorschlag(null);
    onChatChange([...eintraege, { role: "system", text: `📎 ${file.name} wird ausgelesen …` }], history);
    try {
      const beleg = await belegAuslesenLassen(file);
      setVorschlag({ ...belegZuPatch(beleg, input, belegPerson), beleg });
    } catch (e) {
      onChatChange([...eintraege, { role: "error", text: e instanceof Error ? e.message : String(e) }], history);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      if (kameraRef.current) kameraRef.current.value = "";
    }
  }

  function vorschlagUebernehmen() {
    if (!vorschlag?.patch) return;
    onInputChange(applyPatch(input, vorschlag.patch));
    onChatChange([...eintraege, { role: "system", text: `✓ Übernommen: ${vorschlag.text}` }], history);
    setVorschlag(null);
  }

  function personWechseln(i: number) {
    setBelegPerson(i);
    if (vorschlag) setVorschlag({ ...belegZuPatch(vorschlag.beleg, input, i), beleg: vorschlag.beleg });
  }

  return (
    <div className="card chat" id="assistent">
      <div className="chat-head">
        {umschalter}
        <h2>Steuer-Assistent</h2>
        <p>Für alles, was der Fragebogen nicht abdeckt – frag frei heraus.</p>
      </div>
      {!kiVerfuegbar && (
        <div className="hinweis-leiste">
          Der KI-Chat braucht einen Claude-API-Schlüssel (ANTHROPIC_API_KEY). Der Fragebogen funktioniert auch ohne.
        </div>
      )}

      <div className="chat-log" ref={logRef}>
        {eintraege.length === 0 && (
          <>
            <div className="msg assistant">
              Hallo! Ich helfe dir, deine voraussichtliche Steuererstattung zu schätzen. Am besten fangen wir mit deiner
              Lohnsteuerbescheinigung an – du kannst sie auch einfach fotografieren.
            </div>
            <div className="chips">
              {VORSCHLAEGE.map((v) => (
                <button key={v} className="chip" onClick={() => senden(v)} disabled={busy}>
                  {v}
                </button>
              ))}
            </div>
          </>
        )}
        {eintraege.map((e, i) => (
          <div key={i} className={`msg ${e.role}`}>
            {e.role === "assistant" ? <MiniMarkdown text={e.text} /> : e.text}
          </div>
        ))}
        {live && (
          <div className="msg assistant">
            <MiniMarkdown text={live} />
          </div>
        )}
        {busy && status && <div className="msg assistant muted">{status}</div>}
        {vorschlag && (
          <div className="proposal">
            <strong>Beleg erkannt:</strong> {vorschlag.beleg.beschreibung}
            <div style={{ margin: "6px 0" }}>{vorschlag.text}</div>
            {vorschlag.beleg.unsicherheiten.length > 0 && (
              <div className="muted">Bitte prüfen: {vorschlag.beleg.unsicherheiten.join("; ")}</div>
            )}
            {vorschlag.beleg.steuerjahr && vorschlag.beleg.steuerjahr !== input.jahr && (
              <div className="muted">Achtung: Beleg ist aus {vorschlag.beleg.steuerjahr}, gewählt ist {input.jahr}.</div>
            )}
            {input.zusammenveranlagung && input.personen.length > 1 && (
              <div className="row" style={{ margin: "6px 0" }}>
                <span className="muted">Gehört zu:</span>
                {input.personen.map((p, i) => (
                  <button key={i} className={`tab ${belegPerson === i ? "active" : ""}`} onClick={() => personWechseln(i)}>
                    {p.name || `Person ${i + 1}`}
                  </button>
                ))}
              </div>
            )}
            <div className="row end" style={{ marginTop: 6 }}>
              <button className="secondary" onClick={() => setVorschlag(null)}>
                Verwerfen
              </button>
              <button className="primary" onClick={vorschlagUebernehmen} disabled={!vorschlag.patch}>
                Übernehmen
              </button>
            </div>
          </div>
        )}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          senden(text);
        }}
      >
        <textarea
          rows={2}
          enterKeyHint="send"
          value={text}
          placeholder="z. B. „Ich fahre 23 km mit dem Auto, 3 Tage pro Woche“"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              senden(text);
            }
          }}
        />
        <div className="row">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            hidden
            onChange={(e) => e.target.files?.[0] && belegHochladen(e.target.files[0])}
          />
          <input
            ref={kameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => e.target.files?.[0] && belegHochladen(e.target.files[0])}
          />
          <button type="button" className="secondary d-hide" onClick={() => kameraRef.current?.click()} disabled={busy} title="Beleg fotografieren" aria-label="Beleg fotografieren">
            📷<span className="btn-label"> Foto</span>
          </button>
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()} disabled={busy} title="Beleg hochladen" aria-label="Beleg als Datei hochladen">
            📎<span className="btn-label"> Beleg</span>
          </button>
          <span className="muted" style={{ flex: 1 }} />
          {eintraege.length > 0 && (
            <button type="button" className="secondary" onClick={() => onChatChange([], [])} disabled={busy}>
              Neu
            </button>
          )}
          <button type="submit" className="primary" disabled={busy || !text.trim()}>
            Senden
          </button>
        </div>
      </form>
    </div>
  );
}
