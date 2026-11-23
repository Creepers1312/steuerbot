#!/usr/bin/env bash
# Steuerbot erstmalig auf einem Server einrichten und starten.
#
#   scripts/deploy.sh                                  # fragt Domain, TLS und ersten Benutzer ab
#   scripts/deploy.sh --domain steuer.example.de --tls admin@example.de --benutzer anna
#   PASSWORT=… scripts/deploy.sh --domain steuerbot.local --tls internal --benutzer anna --ja
#
# Was passiert:
#   1. Voraussetzungen prüfen (Docker, Compose, git, openssl)
#   2. .env anlegen (Rechte 600) mit zufälligem Sitzungsschlüssel
#   3. Image bauen – Lint, Typprüfung und Tests laufen im Build
#   4. Ersten Benutzer anlegen (Passwort wird verdeckt abgefragt, nur der scrypt-Hash wird gespeichert)
#   5. Container starten und warten, bis die App gesund ist
source "$(dirname "$0")/lib.sh"

DOMAIN=""; TLS=""; BENUTZER=""; JA=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --tls) TLS="$2"; shift 2 ;;
    --benutzer) BENUTZER="$2"; shift 2 ;;
    --ja|-y) JA=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) fehler "Unbekannte Option: $1" ;;
  esac
done

frage() { # frage <Text> <Standard>
  local antwort
  if [[ $JA -eq 1 || ! -t 0 ]]; then echo "$2"; return; fi
  read -r -p "$1 [$2]: " antwort
  echo "${antwort:-$2}"
}

voraussetzungen
mkdir -p "$ROOT/deploy"
log "=== Deploy gestartet ($(git rev-parse --short HEAD 2>/dev/null || echo ohne-git)) ==="

# --- 1. Konfiguration ---
if [[ ! -f "$ENV_DATEI" ]]; then
  umask 077
  cp "$ROOT/.env.example" "$ENV_DATEI"
  chmod 600 "$ENV_DATEI"
  [[ -n "$DOMAIN" ]] || DOMAIN="$(frage "Domain oder Hostname (z. B. steuer.meinefamilie.de)" "localhost")"
  [[ -n "$TLS" ]] || TLS="$(frage "E-Mail für Let's Encrypt – oder 'internal' fürs Heimnetz" "internal")"
  env_setzen STEUERBOT_DOMAIN "$DOMAIN"
  env_setzen STEUERBOT_TLS "$TLS"
  env_setzen STEUERBOT_SESSION_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
  ok ".env angelegt (Rechte 600)"
else
  ok ".env vorhanden – wird nicht überschrieben"
  [[ -n "$DOMAIN" ]] && env_setzen STEUERBOT_DOMAIN "$DOMAIN"
  [[ -n "$TLS" ]] && env_setzen STEUERBOT_TLS "$TLS"
  if [[ "$(env_wert STEUERBOT_SESSION_SECRET | wc -c)" -lt 33 ]]; then
    env_setzen STEUERBOT_SESSION_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
    ok "Sitzungsschlüssel erzeugt"
  fi
fi
chmod 600 "$ENV_DATEI"

# --- 2. Image bauen ---
TAG="$(git rev-parse --short=12 HEAD 2>/dev/null || echo lokal)-$(date +%Y%m%d%H%M)"
image_bauen "$TAG"
ok "Image steuerbot:$TAG gebaut (Tests bestanden)"
env_setzen STEUERBOT_IMAGE_TAG "$TAG"

# --- 3. Erster Benutzer ---
if [[ -z "$(env_wert STEUERBOT_BENUTZER)" ]]; then
  [[ -n "$BENUTZER" ]] || BENUTZER="$(frage "Erster Benutzername" "admin")"
  "$ROOT/scripts/benutzer.sh" "$BENUTZER" --ohne-neustart
fi

# --- 4. Starten ---
compose up -d --no-build --remove-orphans
log "Warte auf Healthcheck …"
if warte_gesund 180; then
  ok "Steuerbot läuft: https://$(env_wert STEUERBOT_DOMAIN)"
else
  compose logs --tail 50 app >&2 || true
  fehler "App wurde nicht gesund – siehe Logs oben."
fi

if [[ "$(env_wert STEUERBOT_TLS)" == "internal" ]]; then
  warn "Eigenes Zertifikat (Heimnetz): Damit Browser nicht warnen, das Stammzertifikat auf den Geräten installieren:"
  echo "    docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > steuerbot-root.crt"
fi
echo "Benutzer hinzufügen:   scripts/benutzer.sh <name>"
echo "Aktualisieren:         scripts/update.sh"
echo "Firewall: nur die Ports 80 und 443 freigeben."
