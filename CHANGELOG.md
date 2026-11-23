# Änderungsprotokoll

## 1.0.0 – 2026-11-23

Erste vollständige Version für den Familienbetrieb.

### Funktionen
- Erstattungsrechner 2025/2026 (Grund-/Splittingtarif, Soli, Kirchensteuer, Werbungskosten, Vorsorge,
  Kinder-Günstigerprüfung, § 35a, Progressionsvorbehalt) – mit veröffentlichten Tabellenwerten abgeglichen
- Hochrechnung aus der Gehaltsabrechnung für das laufende Jahr
- Grenzgänger:innen in die Schweiz (Lohnausweis in CHF, Quellensteuer-Anrechnung, AHV/BVG, Vorauszahlungen)
- Geführter Fragebogen ohne KI im Chat-Stil; optionaler Claude-Assistent mit Belegerkennung
- ELSTER-Ausfüllhilfe zum Drucken, Handy-Ansicht, als App installierbar

### Sicherheit und Betrieb
- Anmeldung mit individuellen Konten, signierten Sitzungen, Sperre nach Fehlversuchen
- CSP mit Nonce, Security-Header, CSRF-Schutz, Größen- und Rate-Limits
- Gehärteter Distroless-Container, Caddy mit TLS nach BSI TR-02102-2
- `scripts/deploy.sh`, `scripts/update.sh` (mit Rollback), `scripts/benutzer.sh`
- CI mit Lint, Typprüfung, Tests, `npm audit`, Trivy-Scan, Container-Smoke-Test und ShellCheck; Dependabot

### Intern
- Gemeinsame Module für Formatierung (`src/lib/format.ts`) und Belegfelder (`src/lib/tax/belegfelder.ts`)
- Rechenkern in benannte Schritte zerlegt (ergebnisgleich per Differenztest)
