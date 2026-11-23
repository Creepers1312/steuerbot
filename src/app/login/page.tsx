"use client";

import { useState } from "react";

export default function Login() {
  const [benutzer, setBenutzer] = useState("");
  const [passwort, setPasswort] = useState("");
  const [fehler, setFehler] = useState("");
  const [laedt, setLaedt] = useState(false);

  async function anmelden(e: React.FormEvent) {
    e.preventDefault();
    setLaedt(true);
    setFehler("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ benutzer, passwort }),
      });
      if (res.ok) {
        const ziel = new URLSearchParams(window.location.search).get("weiter");
        // Nur interne Ziele zulassen (kein Open Redirect)
        window.location.href = ziel && ziel.startsWith("/") && !ziel.startsWith("//") ? ziel : "/";
        return;
      }
      const data = await res.json().catch(() => ({}));
      setFehler(data.error ?? "Anmeldung fehlgeschlagen.");
    } catch {
      setFehler("Keine Verbindung zum Server.");
    } finally {
      setPasswort("");
      setLaedt(false);
    }
  }

  return (
    <div className="shell login">
      <form className="card" onSubmit={anmelden}>
        <h1>Steuerbot</h1>
        <p className="muted">Bitte melde dich an.</p>
        <div className="field">
          <label htmlFor="benutzer">Benutzername</label>
          <input id="benutzer" type="text" autoComplete="username" autoCapitalize="none" value={benutzer} onChange={(e) => setBenutzer(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="passwort">Passwort</label>
          <input id="passwort" type="password" autoComplete="current-password" value={passwort} onChange={(e) => setPasswort(e.target.value)} required />
        </div>
        {fehler && (
          <div className="meldung fehler" role="alert">
            {fehler}
          </div>
        )}
        <button className="primary" type="submit" disabled={laedt}>
          {laedt ? "Prüfe …" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
