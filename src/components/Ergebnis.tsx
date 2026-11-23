"use client";

import type { TaxResult } from "@/lib/tax/engine";

const eur = (n: number, digits = 0) =>
  n.toLocaleString("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits });

function Row({ label, value, sum, indent, minus }: { label: string; value: number; sum?: boolean; indent?: boolean; minus?: boolean }) {
  return (
    <tr className={`${sum ? "sum" : ""} ${indent ? "indent" : ""}`}>
      <td>{label}</td>
      <td>{minus && value > 0 ? "− " : ""}{eur(value, 2)}</td>
    </tr>
  );
}

export function ErgebnisHero({
  r,
  onAngaben,
  onAssistent,
}: {
  r: TaxResult;
  onAngaben?: () => void;
  onAssistent?: () => void;
}) {
  const plus = r.erstattung >= 0;
  const keineDaten = r.bereitsGezahlt.gesamt === 0 && r.summeEinkuenfte === 0;
  return (
    <div className="card hero">
      <div className="label">Voraussichtlich für {r.jahr}</div>
      <div className={`amount ${keineDaten ? "" : plus ? "plus" : "minus"}`}>
        {keineDaten ? "–" : `${plus ? "+" : "−"} ${eur(Math.abs(r.erstattung))}`}
      </div>
      <div className="sub">
        {keineDaten
          ? "Trag deine Lohnsteuerbescheinigung ein oder erzähl dem Assistenten davon."
          : plus
            ? "Erstattung vom Finanzamt"
            : "Nachzahlung ans Finanzamt"}
      </div>
      {!keineDaten && (
        <div className="sub" style={{ marginTop: 6 }}>
          Grenzsteuersatz {(r.grenzsteuersatz * 100).toFixed(1)} % – jeder weitere Euro Werbungskosten bringt etwa{" "}
          {Math.round(r.grenzsteuersatz * 100)} Cent.
        </div>
      )}
      {!keineDaten && r.personen.some((p) => p.arbeitsland === "CH") && r.bereitsGezahlt.vorauszahlungen === 0 && !plus && (
        <div className="sub hinweis-grenz">
          Grenzgänger: Deutsche Steuer wird nicht vom Lohn abgezogen. Hast du Vorauszahlungen ans Finanzamt geleistet? Trag sie
          unter „Angaben → Haushalt“ ein – sie mindern die Nachzahlung.
        </div>
      )}
      {(onAngaben || onAssistent) && (
        <div className="hero-actions d-hide">
          {onAssistent && (
            <button className={keineDaten ? "primary" : "secondary"} onClick={onAssistent}>
              💬 {keineDaten ? "Mit dem Assistenten starten" : "Assistent fragen"}
            </button>
          )}
          {onAngaben && (
            <button className="secondary" onClick={onAngaben}>
              📝 {keineDaten ? "Selbst eintragen" : "Angaben bearbeiten"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ErgebnisDetails({ r }: { r: TaxResult }) {
  return (
    <div className="card">
      <h2>So wird gerechnet</h2>
      <table className="breakdown">
        <tbody>
          {r.personen.map((p) => (
            <Personenzeilen key={p.name} p={p} />
          ))}
          <Row label="Summe der Einkünfte" value={r.summeEinkuenfte} sum />
          {r.entlastungsbetragAlleinerziehende > 0 && (
            <Row label="Entlastungsbetrag Alleinerziehende" value={r.entlastungsbetragAlleinerziehende} minus indent />
          )}
          <Row label="Vorsorgeaufwendungen (Rente, Kranken-, Pflegevers.)" value={r.vorsorgeaufwendungen} minus indent />
          <Row label="Weitere Sonderausgaben" value={r.weitereSonderausgaben} minus indent />
          {r.aussergewoehnlicheBelastungen > 0 && (
            <Row label="Außergewöhnliche Belastungen" value={r.aussergewoehnlicheBelastungen} minus indent />
          )}
          {r.kinderfreibetraege > 0 && <Row label="Kinderfreibeträge" value={r.kinderfreibetraege} minus indent />}
          <Row label="Zu versteuerndes Einkommen" value={r.zvE} sum />
          <Row label={`Einkommensteuer (${r.splitting ? "Splittingtarif" : "Grundtarif"})`} value={r.tariflicheESt} />
          {r.steuerermaessigung35a > 0 && <Row label="Ermäßigung Handwerker/Haushalt" value={r.steuerermaessigung35a} minus indent />}
          {r.kindergeldHinzurechnung > 0 && <Row label="+ Hinzurechnung Kindergeld" value={r.kindergeldHinzurechnung} indent />}
          {r.soli > 0 && <Row label="+ Solidaritätszuschlag" value={r.soli} indent />}
          {r.kirchensteuer > 0 && <Row label="+ Kirchensteuer" value={r.kirchensteuer} indent />}
          <Row label="Steuer insgesamt" value={r.steuerGesamt} sum />
          {r.bereitsGezahlt.quellensteuer > 0 || r.bereitsGezahlt.vorauszahlungen > 0 ? (
            <>
              {r.bereitsGezahlt.lohnsteuer > 0 && (
                <Row label="Lohnsteuer, Soli, KiSt (deutscher Arbeitgeber)" value={r.bereitsGezahlt.lohnsteuer + r.bereitsGezahlt.soli + r.bereitsGezahlt.kirchensteuer} indent />
              )}
              {r.bereitsGezahlt.quellensteuer > 0 && <Row label="Schweizer Quellensteuer (angerechnet)" value={r.bereitsGezahlt.quellensteuer} indent />}
              {r.bereitsGezahlt.vorauszahlungen > 0 && <Row label="Vorauszahlungen ans Finanzamt" value={r.bereitsGezahlt.vorauszahlungen} indent />}
              <Row label="Bereits gezahlt / angerechnet" value={r.bereitsGezahlt.gesamt} />
            </>
          ) : (
            <Row label="Bereits gezahlt (Lohnsteuer, Soli, KiSt)" value={r.bereitsGezahlt.gesamt} />
          )}
          <Row label={r.erstattung >= 0 ? "Erstattung" : "Nachzahlung"} value={Math.abs(r.erstattung)} sum />
        </tbody>
      </table>

      {r.hinweise.length > 0 && (
        <>
          <h3>Hinweise</h3>
          <ul className="hints">
            {r.hinweise.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </>
      )}
      <p className="disclaimer">
        Schätzung ohne Gewähr, keine Steuerberatung. Nicht abgebildet: Selbstständigkeit, Vermietung, Kapitalerträge,
        Auslandseinkünfte, Unterhalt, doppelte Haushaltsführung, Riester. Der verbindliche Betrag steht im Steuerbescheid.
      </p>
    </div>
  );
}

function Personenzeilen({ p }: { p: TaxResult["personen"][number] }) {
  return (
    <>
      <Row label={`${p.name}: Bruttoarbeitslohn${p.arbeitsland === "CH" ? " (Schweiz, in € umgerechnet)" : ""}`} value={p.bruttolohn} />
      {p.werbungskostenPosten.map((w) => (
        <Row key={w.label} label={w.label} value={w.betrag} indent />
      ))}
      <Row
        label={p.pauschbetragGenutzt ? "Werbungskosten (Pauschbetrag)" : "Werbungskosten (tatsächlich)"}
        value={p.werbungskostenAngesetzt}
        minus
        indent
      />
      <Row label={`${p.name}: Einkünfte`} value={p.einkuenfte} />
    </>
  );
}
