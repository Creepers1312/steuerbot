# Sicherheitskonzept Steuerbot

Steuerbot verarbeitet Steuerdaten (Einkommen, Familienstand, Gesundheit, Religion) – nach BSI-Systematik ein
**hoher Schutzbedarf** bei der Vertraulichkeit. Die technischen Maßnahmen orientieren sich am
**BSI IT-Grundschutz-Kompendium** (insbesondere APP.3.1 Webanwendungen, SYS.1.6 Containerisierung,
ORP.4 Identitäts- und Berechtigungsmanagement, OPS.1.1.3 Patch- und Änderungsmanagement, OPS.1.1.5 Protokollierung,
CON.1 Kryptokonzept) und an der **BSI TR-02102-2** (TLS).

> Wichtig: Das ist **keine BSI-Zertifizierung** und kein vollständiger Grundschutz-Check. Grundschutz umfasst auch
> organisatorische Anforderungen (Verantwortlichkeiten, Backups, Notfallplanung, Schulung, Datenschutz-Dokumentation),
> die beim Betreiber liegen. Dieses Dokument beschreibt, welche technischen Anforderungen die Software und das
> mitgelieferte Betriebsmodell abdecken – und welche Restrisiken bleiben.

## Umgesetzte Maßnahmen

### Anmeldung und Sitzungen (APP.3.1, ORP.4)
| Maßnahme | Umsetzung |
|---|---|
| Individuelle Konten statt Sammelpasswort | `STEUERBOT_BENUTZER` mit je einem Eintrag pro Person (`scripts/benutzer.sh`) |
| Sichere Passwortspeicherung | scrypt (N=2¹⁵, r=8, p=1, 16 Byte Salt), nur Hash in `.env` |
| Passwortlänge | mindestens 12 Zeichen (Passphrasen empfohlen) |
| Schutz vor Raten | Sperre nach 5 Fehlversuchen je Konto bzw. 20 je IP für 15 Minuten, künstliche Verzögerung, gleiche Antwortzeit für unbekannte Benutzer |
| Sitzungs-Token | HMAC-SHA-256-signiert, Ablauf (Standard 8 h), an den aktuellen Passwort-Hash gebunden – Passwortänderung oder Entfernen des Kontos beendet laufende Sitzungen sofort |
| Cookie | `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` |
| Abmelden | löscht die Sitzung; zusätzlich „Daten löschen“ für den Browser |
| Sicherer Standard | Im Produktivbetrieb ohne Benutzer/Schlüssel ist die App **gesperrt** (HTTP 503) |

### Schutz der Webanwendung (APP.3.1)
| Maßnahme | Umsetzung |
|---|---|
| Content-Security-Policy | pro Anfrage neue Nonce, `strict-dynamic`, keine externen Quellen, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'` |
| Weitere Header | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, COOP/CORP, HSTS (Proxy), kein `X-Powered-By`/`Server` |
| CSRF | `SameSite=Strict` + Prüfung des `Origin`-Headers bei allen schreibenden Anfragen |
| Eingabevalidierung | Schema-Prüfung (zod) aller API-Eingaben, Größenlimits (Chat 3 MB, Belege 15 MB) |
| Datei-Uploads | Typprüfung anhand des Inhalts (Magic Bytes), nicht nur des angegebenen MIME-Typs |
| Missbrauch / Kosten | Rate-Limits je Benutzer für KI-Chat (60/h) und Belegerkennung (40/h) |
| Fehlermeldungen | keine Stacktraces oder internen Details an den Client |
| Caching | API-Antworten `Cache-Control: no-store` |
| Open Redirect | Weiterleitung nach Login nur auf interne Pfade |

### Transportverschlüsselung (CON.1, TR-02102-2)
- Caddy als einziger von außen erreichbarer Dienst, automatische Zertifikate (Let's Encrypt oder interne CA)
- Nur TLS 1.2 und TLS 1.3; HTTP wird per 308 auf HTTPS umgeleitet; HSTS 1 Jahr
- TLS 1.2: ausschließlich ECDHE + AES-GCM (Forward Secrecy, AEAD); CBC, ChaCha20 und RSA-Schlüsseltransport abgelehnt
- Schlüsselaustausch nur über NIST P-256/P-384 (X25519 ist in TR-02102-2 nicht empfohlen)
- Geprüft mit `openssl s_client`: TLS 1.0/1.1, ChaCha20/CBC unter TLS 1.2 und X25519 werden abgelehnt

### Container und Betrieb (SYS.1.6)
| Maßnahme | Umsetzung |
|---|---|
| Minimales Image | Distroless (ohne Shell, Paketmanager), per Digest festgenagelt |
| Keine Root-Rechte | Benutzer 65532, Anwendungsdateien gehören root (nur lesbar) |
| Dateisystem | read-only, nur `tmpfs` für `/tmp` und den Next-Cache |
| Rechte | `cap_drop: ALL`, `no-new-privileges`; Caddy nur `NET_BIND_SERVICE` |
| Ressourcen | Speicher-, CPU- und Prozesslimits |
| Netz | App ohne veröffentlichten Port, nur über den Proxy erreichbar |
| Geheimnisse | nicht im Image; `.env` mit Rechten 600; Build-Secrets (Proxy-CA) werden nicht ins Image übernommen |
| Healthcheck | `/api/health` ohne Details; Neustart bei Fehlern |
| Build | Lint, Typprüfung und alle Tests laufen im Build – fehlerhafte Versionen werden nicht ausgerollt |

### Patch- und Änderungsmanagement (OPS.1.1.3)
- `scripts/update.sh`: holt den Code (nur Fast-Forward), baut mit aktuellen Basis-Images neu, tauscht die Container,
  prüft den Healthcheck und **rollt bei Fehlern automatisch zurück** (Image und Code)
- Empfohlen: wöchentlich per Cron, z. B. `17 4 * * 1 /opt/steuerbot/scripts/update.sh --ja`
- Dependabot meldet Updates für npm-Pakete, Docker-Images und GitHub Actions
- CI: `npm audit` (HIGH), Trivy-Scan des Images (HIGH/CRITICAL mit Fix), gehärteter Container-Smoke-Test, ShellCheck,
  wöchentlicher Lauf auch ohne Code-Änderung
- Bekannte Schwachstelle in `postcss` (Build-Abhängigkeit von Next.js) per `overrides` auf korrigierte Version gehoben

### Protokollierung (OPS.1.1.5)
- Sicherheitsereignisse als JSON auf stdout: `login_erfolgreich`, `login_fehlgeschlagen`, `login_gesperrt`
- Datensparsam: IP-Adressen gekürzt (/24 bzw. /48), keine Passwörter, keine Steuerdaten
- Docker-Logrotation (10 MB × 5 Dateien); Betriebsprotokoll der Skripte in `deploy/betrieb.log`

### Datenhaltung und Datenschutz
- Steuerdaten liegen **nur im Browser** (localStorage) des jeweiligen Geräts – der Server speichert keine Steuerdaten
- An die Claude-API (Anthropic) gehen nur Chat-Nachrichten, der Datenstand und hochgeladene Belege – der Fragebogen
  funktioniert vollständig ohne KI; ohne `ANTHROPIC_API_KEY` verlässt nichts den Server
- Der Assistent fragt nicht nach Steuer-ID, IBAN oder Adresse

## Restrisiken und offene Punkte

| Punkt | Bewertung / Empfehlung |
|---|---|
| **Keine Zwei-Faktor-Authentisierung** | Für hohen Schutzbedarf empfiehlt das BSI 2FA. Ausgleich: lange Passphrasen, Sperre, nur TLS. Ausbaustufe: TOTP oder Zugriff nur über VPN/Heimnetz. |
| Daten im Browser unverschlüsselt | Wer Zugriff auf das entsperrte Gerät hat, kann die Daten lesen. Geräte mit Bildschirmsperre nutzen, auf gemeinsam genutzten Geräten „Daten löschen“. |
| Übermittlung an Anthropic (USA) | Nur bei Nutzung von KI-Chat/Belegerkennung. Für streng vertrauliche Daten den Fragebogen ohne KI verwenden bzw. `ANTHROPIC_API_KEY` leer lassen. |
| Rate-Limits im Speicher | Nach Neustart zurückgesetzt, nur für eine Instanz. Für den Familienbetrieb ausreichend. |
| CSP `style-src 'unsafe-inline'` | Nötig für Style-Attribute von React; Skripte bleiben streng per Nonce geschützt. |
| TLS-1.3-Cipher-Suites | Werden von Go fest vorgegeben (inkl. ChaCha20-Poly1305 als Ausweichoption); Browser handeln AES-GCM aus. |
| Organisatorisches | Backups (nur `.env` und Caddy-Volumes nötig), Zuständigkeiten, Notfallplan und Datenschutz-Dokumentation sind Aufgabe des Betreibers. |

## Schwachstellen melden

Bitte nicht öffentlich als Issue, sondern direkt an die Betreiberin/den Betreiber des Repositories.
