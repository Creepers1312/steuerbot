"use client";

import { useState } from "react";
import { formatZahlEingabe, parseZahl } from "@/lib/zahl";

/** Zahlenfeld, das deutsche Schreibweise versteht (Komma, Tausenderpunkt) und auf dem Handy die Ziffern-Tastatur zeigt. */
export function NumField({
  label,
  value,
  onChange,
  ganzzahl = false,
  einheit,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  ganzzahl?: boolean;
  einheit?: string;
  hint?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [fehler, setFehler] = useState(false);
  return (
    <div className="field">
      <label>
        {label}
        {hint && <span className="hint"> – {hint}</span>}
      </label>
      <div className="input-unit">
        <input
          type="text"
          inputMode={ganzzahl ? "numeric" : "decimal"}
          enterKeyHint="next"
          autoComplete="off"
          value={text ?? formatZahlEingabe(value)}
          placeholder="0"
          aria-invalid={fehler}
          onFocus={(e) => {
            setText(formatZahlEingabe(value));
            e.currentTarget.select();
          }}
          onChange={(e) => {
            setText(e.target.value);
            const n = parseZahl(e.target.value);
            setFehler(n === null);
            if (n !== null) onChange(Math.max(0, ganzzahl ? Math.round(n) : n));
          }}
          onBlur={() => {
            setText(null);
            setFehler(false);
          }}
        />
        {einheit && <span className="unit">{einheit}</span>}
      </div>
    </div>
  );
}
