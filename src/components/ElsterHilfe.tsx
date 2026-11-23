"use client";

import { ausfuellhilfe } from "@/lib/tax/ausfuellhilfe";
import type { TaxResult } from "@/lib/tax/engine";
import type { TaxInput } from "@/lib/tax/schema";
import { euro } from "@/lib/format";


export default function ElsterHilfe({ input, r }: { input: TaxInput; r: TaxResult }) {
  const abschnitte = ausfuellhilfe(input, r);
  return (
    <div className="card elster-hilfe">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Ausfüllhilfe für Mein ELSTER – {input.jahr}</h2>
        <button className="secondary no-print" onClick={() => window.print()}>
          Drucken / als PDF
        </button>
      </div>
      <p className="muted">
        Tipp: In Mein ELSTER „Belegabruf“ bzw. „vorausgefüllte Steuererklärung“ nutzen – Lohnsteuerbescheinigung,
        Sozialversicherung und Rentenbeiträge werden dann automatisch übernommen. Die Feldnamen können sich je nach
        Formularjahr leicht unterscheiden.
      </p>
      {abschnitte.map((a) => (
        <div key={a.anlage} style={{ breakInside: "avoid" }}>
          <h3>{a.anlage}</h3>
          <table className="breakdown">
            <tbody>
              {a.eintraege.map((e, i) => (
                <tr key={i}>
                  <td>
                    {e.feld}
                    {e.hinweis && <div className="muted">{e.hinweis}</div>}
                  </td>
                  <td style={{ whiteSpace: "normal" }}>{e.wert}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="disclaimer">
        Voraussichtliches Ergebnis: {r.erstattung >= 0 ? "Erstattung" : "Nachzahlung"} {euro(Math.abs(r.erstattung), 2)}. Schätzung
        ohne Gewähr.
      </p>
    </div>
  );
}
