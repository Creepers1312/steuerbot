"use client";

import { useState, type ReactNode } from "react";
import type { TaxResult } from "@/lib/tax/engine";
import { BUNDESLAENDER, type Bundesland, type SupportedYear } from "@/lib/tax/params";
import { KindSchema, parseTaxInput, type Person, type TaxInput } from "@/lib/tax/schema";
import HochrechnungPanel from "./HochrechnungPanel";
import { NumField } from "./NumField";

interface Props {
  input: TaxInput;
  ergebnis: TaxResult;
  onChange: (next: TaxInput) => void;
}

const eur0 = (n: number) => `${Math.round(n).toLocaleString("de-DE")} €`;

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Aufklappbarer Abschnitt mit kurzer Zusammenfassung rechts. */
function Abschnitt({ titel, info, offen, children }: { titel: string; info?: string; offen?: boolean; children: ReactNode }) {
  // Nur der Anfangszustand kommt von außen – danach entscheidet die Person (nicht zuklappen, während man tippt)
  const [auf, setAuf] = useState(!!offen);
  return (
    <details className="section" open={auf} onToggle={(e) => setAuf(e.currentTarget.open)}>
      <summary>
        <span className="section-title">{titel}</span>
        {info && <span className="section-info">{info}</span>}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

export default function DatenFormular({ input, ergebnis, onChange }: Props) {
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

  const sonderausgabenInfo = input.spenden + input.kinderbetreuungskosten + input.weitereKirchensteuer;
  const haushaltInfo = input.handwerkerLohnkosten + input.haushaltsnaheDienstleistungen + input.krankheitskosten;

  return (
    <div className="card">
      <h2>Deine Angaben</h2>
      <div className="grid" style={{ marginBottom: 12 }}>
        <div className="field">
          <label>Steuerjahr</label>
          <select value={input.jahr} onChange={(e) => update({ jahr: Number(e.target.value) as SupportedYear })}>
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
        <div className="field field-check">
          <Check
            label="Verheiratet, gemeinsame Erklärung"
            checked={input.zusammenveranlagung}
            onChange={(v) => update({ zusammenveranlagung: v, alleinerziehend: v ? false : input.alleinerziehend })}
          />
        </div>
      </div>

      <div className="tabs segmented">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${activeTab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {sichtbar.map((p, i) =>
        activeTab === `p${i}` ? (
          <PersonForm
            key={i}
            p={p}
            jahr={input.jahr}
            ergebnis={ergebnis.personen[i]}
            onChange={(patch) => updatePerson(i, patch)}
          />
        ) : null,
      )}

      {activeTab === "haushalt" && (
        <div>
          <Abschnitt titel="Kinder" info={input.kinder.length ? `${input.kinder.length}` : "keine"} offen>
            {input.kinder.map((k, i) => (
              <div key={i} className="kind">
                <div className="grid">
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
                    ganzzahl
                    value={k.monate}
                    onChange={(v) => update({ kinder: input.kinder.map((x, j) => (j === i ? { ...x, monate: Math.min(12, v) } : x)) })}
                  />
                </div>
                <div className="row" style={{ marginTop: 6, justifyContent: "space-between" }}>
                  {!input.zusammenveranlagung ? (
                    <Check
                      label="Voller Freibetrag (anderer Elternteil fällt aus)"
                      checked={k.vollerFreibetrag}
                      onChange={(v) => update({ kinder: input.kinder.map((x, j) => (j === i ? { ...x, vollerFreibetrag: v } : x)) })}
                    />
                  ) : (
                    <span />
                  )}
                  <button className="link danger" onClick={() => update({ kinder: input.kinder.filter((_, j) => j !== i) })}>
                    Entfernen
                  </button>
                </div>
              </div>
            ))}
            <div className="row">
              <button
                className="secondary"
                onClick={() => update({ kinder: [...input.kinder, KindSchema.parse({ name: `Kind ${input.kinder.length + 1}` })] })}
              >
                + Kind hinzufügen
              </button>
              {!input.zusammenveranlagung && input.kinder.length > 0 && (
                <Check label="Alleinerziehend" checked={input.alleinerziehend} onChange={(v) => update({ alleinerziehend: v })} />
              )}
            </div>
          </Abschnitt>

          <Abschnitt titel="Spenden & Kinderbetreuung" info={sonderausgabenInfo ? eur0(sonderausgabenInfo) : undefined}>
            <div className="grid">
              <NumField label="Spenden & Mitgliedsbeiträge" einheit="€" value={input.spenden} onChange={(v) => update({ spenden: v })} />
              <NumField
                label="Kinderbetreuung"
                hint="Kita, Tagesmutter, Hort"
                einheit="€"
                value={input.kinderbetreuungskosten}
                onChange={(v) => update({ kinderbetreuungskosten: v })}
              />
              <NumField
                label="Kirchensteuer nachgezahlt"
                einheit="€"
                value={input.weitereKirchensteuer}
                onChange={(v) => update({ weitereKirchensteuer: v })}
              />
            </div>
          </Abschnitt>

          <Abschnitt titel="Handwerker, Haushalt & Gesundheit" info={haushaltInfo ? eur0(haushaltInfo) : undefined}>
            <div className="grid">
              <NumField
                label="Handwerker – nur Lohnkosten"
                hint="ohne Material, überwiesen"
                einheit="€"
                value={input.handwerkerLohnkosten}
                onChange={(v) => update({ handwerkerLohnkosten: v })}
              />
              <NumField
                label="Haushaltsnahe Dienstleistungen"
                hint="Reinigung, Garten, Hausmeister"
                einheit="€"
                value={input.haushaltsnaheDienstleistungen}
                onChange={(v) => update({ haushaltsnaheDienstleistungen: v })}
              />
              <NumField
                label="Krankheitskosten"
                hint="nach Erstattung der Kasse"
                einheit="€"
                value={input.krankheitskosten}
                onChange={(v) => update({ krankheitskosten: v })}
              />
            </div>
          </Abschnitt>
        </div>
      )}
    </div>
  );
}

function PersonForm({
  p,
  jahr,
  ergebnis,
  onChange,
}: {
  p: Person;
  jahr: SupportedYear;
  ergebnis?: TaxResult["personen"][number];
  onChange: (patch: Partial<Person>) => void;
}) {
  const posten = ergebnis?.werbungskostenPosten ?? [];
  const summe = (filter: (label: string) => boolean) => posten.filter((x) => filter(x.label)).reduce((s, x) => s + x.betrag, 0);
  const wegInfo = summe((l) => l.startsWith("Entfernungspauschale") || l.startsWith("Homeoffice"));
  const weitereInfo = summe((l) => !l.startsWith("Entfernungspauschale") && !l.startsWith("Homeoffice"));

  return (
    <div>
      <div className="grid" style={{ marginBottom: 8 }}>
        <div className="field">
          <label>Name</label>
          <input type="text" value={p.name} onChange={(e) => onChange({ name: e.target.value })} />
        </div>
        <div className="field field-check">
          <Check label="Kirchenmitglied" checked={p.kirchenmitglied} onChange={(v) => onChange({ kirchenmitglied: v })} />
        </div>
      </div>

      <Abschnitt
        titel="Lohnsteuerbescheinigung"
        info={p.bruttolohn ? `Brutto ${eur0(p.bruttolohn)}` : "noch leer"}
        offen={!p.bruttolohn}
      >
        <HochrechnungPanel
          jahr={jahr}
          onUebernehmen={(werte) => onChange({ ...werte, kirchenmitglied: p.kirchenmitglied || werte.kirchensteuerEinbehalten > 0 })}
        />
        <div className="grid">
          <NumField label="Bruttoarbeitslohn" hint="Zeile 3" einheit="€" value={p.bruttolohn} onChange={(v) => onChange({ bruttolohn: v })} />
          <NumField label="Lohnsteuer" hint="Zeile 4" einheit="€" value={p.lohnsteuer} onChange={(v) => onChange({ lohnsteuer: v })} />
          <NumField label="Solidaritätszuschlag" hint="Zeile 5" einheit="€" value={p.soliEinbehalten} onChange={(v) => onChange({ soliEinbehalten: v })} />
          <NumField
            label="Kirchensteuer"
            hint="Zeile 6/7"
            einheit="€"
            value={p.kirchensteuerEinbehalten}
            onChange={(v) => onChange({ kirchensteuerEinbehalten: v })}
          />
          <NumField label="Rente Arbeitgeber" hint="Zeile 22a" einheit="€" value={p.rvArbeitgeber} onChange={(v) => onChange({ rvArbeitgeber: v })} />
          <NumField label="Rente Arbeitnehmer" hint="Zeile 23a" einheit="€" value={p.rvArbeitnehmer} onChange={(v) => onChange({ rvArbeitnehmer: v })} />
          <NumField label="Krankenversicherung" hint="Zeile 25" einheit="€" value={p.kvArbeitnehmer} onChange={(v) => onChange({ kvArbeitnehmer: v })} />
          <NumField label="Pflegeversicherung" hint="Zeile 26" einheit="€" value={p.pvArbeitnehmer} onChange={(v) => onChange({ pvArbeitnehmer: v })} />
          <NumField label="Arbeitslosenvers." hint="Zeile 27" einheit="€" value={p.avArbeitnehmer} onChange={(v) => onChange({ avArbeitnehmer: v })} />
          <NumField
            label="Elterngeld / ALG I / Kurzarbeitergeld"
            einheit="€"
            value={p.lohnersatzleistungen}
            onChange={(v) => onChange({ lohnersatzleistungen: v })}
          />
        </div>
      </Abschnitt>

      <Abschnitt titel="Arbeitsweg & Homeoffice" info={wegInfo ? eur0(wegInfo) : undefined}>
        <div className="grid">
          <NumField label="Arbeitsweg (einfach)" einheit="km" value={p.entfernungKm} onChange={(v) => onChange({ entfernungKm: v })} />
          <NumField label="Tage im Büro" ganzzahl einheit="Tage" value={p.arbeitstageBuero} onChange={(v) => onChange({ arbeitstageBuero: v })} />
          <NumField label="Tage im Homeoffice" ganzzahl einheit="Tage" value={p.homeofficeTage} onChange={(v) => onChange({ homeofficeTage: v })} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <Check label="Mit eigenem Auto zur Arbeit" checked={p.mitPkw} onChange={(v) => onChange({ mitPkw: v })} />
        </div>
      </Abschnitt>

      <Abschnitt titel="Weitere Werbungskosten" info={weitereInfo ? eur0(weitereInfo) : undefined}>
        <div className="grid">
          <NumField label="Arbeitsmittel" hint="Laptop, Fachbücher" einheit="€" value={p.arbeitsmittel} onChange={(v) => onChange({ arbeitsmittel: v })} />
          <NumField label="Fortbildung" einheit="€" value={p.fortbildung} onChange={(v) => onChange({ fortbildung: v })} />
          <NumField
            label="Gewerkschaft"
            hint={jahr >= 2026 ? "zusätzlich zum Pauschbetrag" : undefined}
            einheit="€"
            value={p.gewerkschaftsbeitraege}
            onChange={(v) => onChange({ gewerkschaftsbeitraege: v })}
          />
          <NumField
            label="Sonstige"
            hint="Bewerbung, Umzug …"
            einheit="€"
            value={p.sonstigeWerbungskosten}
            onChange={(v) => onChange({ sonstigeWerbungskosten: v })}
          />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <Check label="Kontoführungspauschale 16 €" checked={p.kontofuehrungspauschale} onChange={(v) => onChange({ kontofuehrungspauschale: v })} />
        </div>
        {ergebnis?.pauschbetragGenutzt && ergebnis.bruttolohn > 0 && (
          <p className="muted" style={{ marginBottom: 0 }}>
            Unter dem Pauschbetrag von 1.230 € – es wird automatisch der Pauschbetrag angesetzt.
          </p>
        )}
      </Abschnitt>

      <Abschnitt titel="Behinderung" info={p.gradDerBehinderung ? `GdB ${p.gradDerBehinderung}` : undefined}>
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
          <div className="field field-check">
            <Check label="Merkzeichen H / Bl / TBl" checked={p.merkzeichenHilflos} onChange={(v) => onChange({ merkzeichenHilflos: v })} />
          </div>
        </div>
      </Abschnitt>
    </div>
  );
}
