"use client";

import { useEffect, useRef, useState } from "react";
import { applyPatch, type Patch } from "@/lib/assistant/patch";
import { belegZuPatch, type BelegDaten } from "@/lib/assistant/beleg-mapping";
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
}

const VORSCHLAEGE = [
  "Lass uns mit meiner Lohnsteuerbescheinigung anfangen",
  "Was kann ich als Pendler absetzen?",
  "Was habe ich wahrscheinlich vergessen?",
  "Erklär mir, wie die Erstattung zustande kommt",
];

export default function Chat({ input, onInputChange, eintraege, history, onChatChange }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [vorschlag, setVorschlag] = useState<{ text: string; patch: Patch | null; beleg: BelegDaten } | null>(null);
  const [belegPerson, setBelegPerson] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [eintraege, busy, vorschlag]);

  async function senden(nachricht: string) {
    const msg = nachricht.trim();
    if (!msg || busy) return;
    setText("");
    const mitUser: ChatEintrag[] = [...eintraege, { role: "user", text: msg }];
    onChatChange(mitUser, history);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history, input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
      if (data.changed) onInputChange(data.input);
      onChatChange([...mitUser, { role: "assistant", text: data.reply }], data.messages);
    } catch (e) {
      onChatChange([...mitUser, { role: "error", text: e instanceof Error ? e.message : String(e) }], history);
    } finally {
      setBusy(false);
    }
  }

  async function belegHochladen(file: File) {
    setBusy(true);
    setVorschlag(null);
    onChatChange([...eintraege, { role: "system", text: `📎 ${file.name} wird ausgelesen …` }], history);
    try {
      const fd = new FormData();
      fd.append("datei", file);
      const res = await fetch("/api/beleg", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
      const beleg = data.beleg as BelegDaten;
      setVorschlag({ ...belegZuPatch(beleg, input, belegPerson), beleg });
    } catch (e) {
      onChatChange([...eintraege, { role: "error", text: e instanceof Error ? e.message : String(e) }], history);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
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
    <div className="card chat">
      <div className="chat-head">
        <h2>Steuer-Assistent</h2>
        <p>Erzähl einfach, was im Jahr los war – ich trage es ein und zeige, was es bringt.</p>
      </div>

      <div className="chat-log" ref={logRef}>
        {eintraege.length === 0 && (
          <>
            <div className="msg assistant">
              Hallo! Ich helfe dir, deine voraussichtliche Steuererstattung zu schätzen. Am besten fangen wir mit deiner
              Lohnsteuerbescheinigung an – du kannst sie auch fotografieren und mit 📎 hochladen.
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
            {e.text}
          </div>
        ))}
        {busy && <div className="msg assistant muted">denkt nach …</div>}
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
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()} disabled={busy} title="Beleg hochladen">
            📎 Beleg
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
