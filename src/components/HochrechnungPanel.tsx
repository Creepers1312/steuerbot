"use client";

import { useState } from "react";
import type { SupportedYear } from "@/lib/tax/params";
import { hochrechnen, type Gehaltsabrechnung, type HochgerechneteWerte } from "@/lib/tax/hochrechnung";
import { NumField } from "./NumField";

const LEER: Gehaltsabrechnung = {
  modus: "monat",
  monat: new Date().getMonth() + 1,
  brutto: 0,
  lohnsteuer: 0,
  soli: 0,
  kirchensteuer: 0,
  rv: 0,
  kv: 0,
  pv: 0,
  av: 0,
  einmalzahlungBrutto: 0,
};

const FELDER: [keyof Gehaltsabrechnung, string][] = [
  ["brutto", "Steuerbrutto"],
  ["lohnsteuer", "Lohnsteuer"],
  ["soli", "Solidaritätszuschlag"],
  ["kirchensteuer", "Kirchensteuer"],
  ["rv", "Rentenversicherung (AN)"],
  ["kv", "Krankenversicherung (AN)"],
  ["pv", "Pflegeversicherung (AN)"],
  ["av", "Arbeitslosenversicherung (AN)"],
];

export default function HochrechnungPanel({
  jahr,
  onUebernehmen,
}: {
  jahr: SupportedYear;
  onUebernehmen: (werte: HochgerechneteWerte) => void;
}) {
  const [offen, setOffen] = useState(false);
  const [g, setG] = useState<Gehaltsabrechnung>(LEER);
  const set = (k: keyof Gehaltsabrechnung, v: number | string) => setG((x) => ({ ...x, [k]: v }));
  const vorschau = g.brutto > 0 ? hochrechnen(g, jahr) : null;

  if (!offen) {
    return (
      <button className="secondary block" style={{ marginBottom: 10 }} onClick={() => setOffen(true)}>
        Noch keine Lohnsteuerbescheinigung? Aus Gehaltsabrechnung hochrechnen
      </button>
    );
  }

  return (
    <div className="proposal" style={{ marginBottom: 12 }}>
      <strong>Hochrechnung aus der Gehaltsabrechnung</strong>
      <p className="muted" style={{ margin: "4px 0 8px" }}>
        Viele Abrechnungen zeigen neben den Monatswerten auch „Jahressummen“ / „kumuliert“ – die sind genauer, weil
        Urlaubs- und Weihnachtsgeld schon enthalten sind.
      </p>
      <div className="grid">
        <div className="field">
          <label>Werte sind …</label>
          <select value={g.modus} onChange={(e) => set("modus", e.target.value)}>
            <option value="monat">Monatswerte</option>
            <option value="kumuliert">Jahressummen bis Monat</option>
          </select>
        </div>
        <div className="field">
          <label>Abrechnungsmonat</label>
          <select value={g.monat} onChange={(e) => set("monat", Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(2026, i, 1).toLocaleString("de-DE", { month: "long" })}
              </option>
            ))}
          </select>
        </div>
        {FELDER.map(([k, label]) => (
          <NumField key={k} label={label} einheit="€" value={g[k] as number} onChange={(v) => set(k, v)} />
        ))}
        <NumField
          label="Noch erwartete Sonderzahlung"
          hint="Weihnachtsgeld, Bonus – falls oben nicht enthalten"
          einheit="€"
          value={g.einmalzahlungBrutto}
          onChange={(v) => set("einmalzahlungBrutto", v)}
        />
      </div>
      {vorschau && (
        <p style={{ margin: "8px 0 0" }}>
          Hochgerechnet aufs Jahr: Brutto <strong>{vorschau.bruttolohn.toLocaleString("de-DE")} €</strong>, Lohnsteuer{" "}
          <strong>{vorschau.lohnsteuer.toLocaleString("de-DE")} €</strong>
        </p>
      )}
      <div className="row end" style={{ marginTop: 8 }}>
        <button className="secondary" onClick={() => setOffen(false)}>
          Abbrechen
        </button>
        <button
          className="primary"
          disabled={!vorschau}
          onClick={() => {
            if (vorschau) onUebernehmen(vorschau);
            setOffen(false);
          }}
        >
          Übernehmen
        </button>
      </div>
    </div>
  );
}
