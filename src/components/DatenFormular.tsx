"use client";

import { useState } from "react";
import { BUNDESLAENDER, type Bundesland } from "@/lib/tax/params";
import { KindSchema, PersonSchema, parseTaxInput, type Person, type TaxInput } from "@/lib/tax/schema";

interface Props {
  input: TaxInput;
  onChange: (next: TaxInput) => void;
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  hint?: string;
}) {
  return (
    <div className="field">
      <label title={hint}>{label}</label>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        value={Number.isFinite(value) && value !== 0 ? value : ""}
        placeholder="0"
        onChange={(e) => onChange(e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))}
      />
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export default function DatenFormular({ input, onChange }: Props) {
  const [tab, setTab] = useState<string>("p0");
  const update = (patch: Partial<TaxInput>) => onChange(parseTaxInput({ ...input, ...patch }));
  const updatePerson = (i: number, patch: Partial<Person>) => {
    const personen = input.personen.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    update({ personen });
  };

  const sichtbar = input.zusammenveranlagung ? input.personen : input.personen.slice(0, 1);
  const tabs = [
    ...sichtbar.map((p, i) => ({ id: `p${i}`, label: p.name || `Person ${i + 1}` })),
    { id: "haushalt", label: "Haushalt & Kinder" },
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "p0";

  return (
    <div className="card">
      <h2>Deine Angaben</h2>
      <div className="grid" style={{ marginBottom: 12 }}>
        <div className="field">
          <label>Steuerjahr</label>
          <select value={input.jahr} onChange={(e) => update({ jahr: Number(e.target.value) as 2025 | 2026 })}>
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
          </select>
        </div>
        <div className="field">
          <label>Bundesland</label>
          <select value={input.bundesland} onChange={(e) => update({ bundesland: e.target.value as Bundesland })}>
            {Object.entries(BUNDESLAENDER).map(([k, v]) => (
              <option key={k} value={k}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ justifyContent: "flex-end" }}>
          <Check
            label="Verheiratet, gemeinsame Erklärung"
            checked={input.zusammenveranlagung}
            onChange={(v) => update({ zusammenveranlagung: v, alleinerziehend: v ? false : input.alleinerziehend })}
          />
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${activeTab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {sichtbar.map((p, i) =>
        activeTab === `p${i}` ? <PersonForm key={i} p={p} jahr={input.jahr} onChange={(patch) => updatePerson(i, patch)} /> : null,
      )}

      {activeTab === "haushalt" && (
        <div>
          <h3>Kinder</h3>
          {input.kinder.length === 0 && <p className="muted">Keine Kinder eingetragen.</p>}
          {input.kinder.map((k, i) => (
            <div key={i} className="grid" style={{ marginBottom: 8 }}>
              <div className="field">
                <label>Name</label>
                <input
                  type="text"
                  value={k.name}
                  onChange={(e) => update({ kinder: input.kinder.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                />
              </div>
              <NumField
                label="Monate mit Kindergeld"
                value={k.monate}
                onChange={(v) => update({ kinder: input.kinder.map((x, j) => (j === i ? { ...x, monate: Math.min(12, Math.round(v)) } : x)) })}
              />
              {!input.zusammenveranlagung && (
                <div className="field" style={{ justifyContent: "flex-end" }}>
                  <Check
                    label="Voller Freibetrag (anderer Elternteil fällt aus)"
                    checked={k.vollerFreibetrag}
                    onChange={(v) => update({ kinder: input.kinder.map((x, j) => (j === i ? { ...x, vollerFreibetrag: v } : x)) })}
                  />
                </div>
              )}
              <div className="field" style={{ justifyContent: "flex-end" }}>
                <button className="secondary" onClick={() => update({ kinder: input.kinder.filter((_, j) => j !== i) })}>
                  Entfernen
                </button>
              </div>
            </div>
          ))}
          <div className="row">
            <button className="secondary" onClick={() => update({ kinder: [...input.kinder, KindSchema.parse({ name: `Kind ${input.kinder.length + 1}` })] })}>
              + Kind hinzufügen
            </button>
            {!input.zusammenveranlagung && input.kinder.length > 0 && (
              <Check label="Alleinerziehend" checked={input.alleinerziehend} onChange={(v) => update({ alleinerziehend: v })} />
            )}
          </div>

          <h3>Sonderausgaben</h3>
          <div className="grid">
            <NumField label="Spenden & Mitgliedsbeiträge (€)" value={input.spenden} onChange={(v) => update({ spenden: v })} />
            <NumField
              label="Kinderbetreuung (Kita, Tagesmutter) (€)"
              value={input.kinderbetreuungskosten}
              onChange={(v) => update({ kinderbetreuungskosten: v })}
            />
            <NumField label="Kirchensteuer nachgezahlt (€)" value={input.weitereKirchensteuer} onChange={(v) => update({ weitereKirchensteuer: v })} />
          </div>

          <h3>Haushalt & Gesundheit</h3>
          <div className="grid">
            <NumField
              label="Handwerker – nur Lohnkosten (€)"
              value={input.handwerkerLohnkosten}
              onChange={(v) => update({ handwerkerLohnkosten: v })}
              hint="Arbeits- und Fahrtkosten inkl. MwSt., ohne Material. Per Überweisung bezahlt."
            />
            <NumField
              label="Haushaltsnahe Dienstleistungen (€)"
              value={input.haushaltsnaheDienstleistungen}
              onChange={(v) => update({ haushaltsnaheDienstleistungen: v })}
              hint="Reinigung, Gartenpflege, Hausmeister, Treppenhausreinigung (z. B. aus der Nebenkostenabrechnung)"
            />
            <NumField
              label="Krankheitskosten (€)"
              value={input.krankheitskosten}
              onChange={(v) => update({ krankheitskosten: v })}
              hint="Zuzahlungen, Brille, Zahnersatz – nach Erstattung durch die Krankenkasse"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PersonForm({ p, jahr, onChange }: { p: Person; jahr: number; onChange: (patch: Partial<Person>) => void }) {
  return (
    <div>
      <div className="grid">
        <div className="field">
          <label>Name</label>
          <input type="text" value={p.name} onChange={(e) => onChange({ name: e.target.value })} />
        </div>
        <div className="field" style={{ justifyContent: "flex-end" }}>
          <Check label="Kirchenmitglied" checked={p.kirchenmitglied} onChange={(v) => onChange({ kirchenmitglied: v })} />
        </div>
      </div>

      <h3>Lohnsteuerbescheinigung</h3>
      <div className="grid">
        <NumField label="Bruttoarbeitslohn – Zeile 3" value={p.bruttolohn} onChange={(v) => onChange({ bruttolohn: v })} />
        <NumField label="Lohnsteuer – Zeile 4" value={p.lohnsteuer} onChange={(v) => onChange({ lohnsteuer: v })} />
        <NumField label="Solidaritätszuschlag – Zeile 5" value={p.soliEinbehalten} onChange={(v) => onChange({ soliEinbehalten: v })} />
        <NumField
          label="Kirchensteuer – Zeile 6/7"
          value={p.kirchensteuerEinbehalten}
          onChange={(v) => onChange({ kirchensteuerEinbehalten: v })}
        />
        <NumField label="RV Arbeitgeber – Zeile 22a" value={p.rvArbeitgeber} onChange={(v) => onChange({ rvArbeitgeber: v })} />
        <NumField label="RV Arbeitnehmer – Zeile 23a" value={p.rvArbeitnehmer} onChange={(v) => onChange({ rvArbeitnehmer: v })} />
        <NumField label="Krankenversicherung – Zeile 25" value={p.kvArbeitnehmer} onChange={(v) => onChange({ kvArbeitnehmer: v })} />
        <NumField label="Pflegeversicherung – Zeile 26" value={p.pvArbeitnehmer} onChange={(v) => onChange({ pvArbeitnehmer: v })} />
        <NumField label="Arbeitslosenvers. – Zeile 27" value={p.avArbeitnehmer} onChange={(v) => onChange({ avArbeitnehmer: v })} />
        <NumField
          label="Elterngeld / ALG I / Kurzarbeitergeld"
          value={p.lohnersatzleistungen}
          onChange={(v) => onChange({ lohnersatzleistungen: v })}
          hint="Steuerfrei, erhöht aber den Steuersatz (Progressionsvorbehalt)"
        />
      </div>

      <h3>Werbungskosten</h3>
      <div className="grid">
        <NumField label="Arbeitsweg einfach (km)" value={p.entfernungKm} onChange={(v) => onChange({ entfernungKm: v })} />
        <NumField label="Tage im Büro" value={p.arbeitstageBuero} onChange={(v) => onChange({ arbeitstageBuero: Math.round(v) })} />
        <NumField label="Tage im Homeoffice" value={p.homeofficeTage} onChange={(v) => onChange({ homeofficeTage: Math.round(v) })} />
        <NumField label="Arbeitsmittel (€)" value={p.arbeitsmittel} onChange={(v) => onChange({ arbeitsmittel: v })} />
        <NumField label="Fortbildung (€)" value={p.fortbildung} onChange={(v) => onChange({ fortbildung: v })} />
        <NumField
          label={jahr >= 2026 ? "Gewerkschaft (€, zusätzlich)" : "Gewerkschaft (€)"}
          value={p.gewerkschaftsbeitraege}
          onChange={(v) => onChange({ gewerkschaftsbeitraege: v })}
        />
        <NumField
          label="Sonstige (Bewerbung, Umzug …) (€)"
          value={p.sonstigeWerbungskosten}
          onChange={(v) => onChange({ sonstigeWerbungskosten: v })}
        />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <Check label="Mit eigenem Auto zur Arbeit" checked={p.mitPkw} onChange={(v) => onChange({ mitPkw: v })} />
        <Check label="Kontoführungspauschale 16 €" checked={p.kontofuehrungspauschale} onChange={(v) => onChange({ kontofuehrungspauschale: v })} />
      </div>

      <h3>Behinderung</h3>
      <div className="grid">
        <div className="field">
          <label>Grad der Behinderung</label>
          <select value={p.gradDerBehinderung} onChange={(e) => onChange({ gradDerBehinderung: Number(e.target.value) })}>
            {[0, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((g) => (
              <option key={g} value={g}>
                {g === 0 ? "keine" : g}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ justifyContent: "flex-end" }}>
          <Check label="Merkzeichen H / Bl / TBl" checked={p.merkzeichenHilflos} onChange={(v) => onChange({ merkzeichenHilflos: v })} />
        </div>
      </div>
    </div>
  );
}

export const leerePerson = () => PersonSchema.parse({});
