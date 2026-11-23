#!/usr/bin/env bash
# Steuerbot aktualisieren – mit automatischem Rollback.
#
#   scripts/update.sh                 # neuesten Stand des aktuellen Branches holen und ausrollen
#   scripts/update.sh --ref v1.2.0    # bestimmten Tag/Branch ausrollen (nur Fast-Forward)
#   scripts/update.sh --nur-images    # ohne Code-Änderung: Basis-Images neu ziehen (Sicherheitsupdates)
#   scripts/update.sh --ja            # ohne Rückfrage (für Cron)
#
# Ablauf: Code holen → Image neu bauen (mit aktuellen Basis-Images, Tests laufen im Build)
#         → Proxy-Image aktualisieren → Container tauschen → Healthcheck
#         → bei Fehler: vorheriges Image und vorherigen Code wiederherstellen.
# Regelmäßig ausführen, z. B. wöchentlich per Cron:
#   17 4 * * 1  /opt/steuerbot/scripts/update.sh --ja
source "$(dirname "$0")/lib.sh"

REF=""; NUR_IMAGES=0; JA=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --nur-images) NUR_IMAGES=1; shift ;;
    --ja|-y) JA=1; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) fehler "Unbekannte Option: $1" ;;
  esac
done

voraussetzungen
[[ -f "$ENV_DATEI" ]] || fehler ".env fehlt – zuerst scripts/deploy.sh ausführen."

# Nur ein Update gleichzeitig
exec 9>"$ROOT/deploy/.update.lock"
command -v flock >/dev/null && { flock -n 9 || fehler "Es läuft bereits ein Update."; }

log "=== Update gestartet ==="
ALT_SHA="$(git rev-parse HEAD)"
ALT_TAG="$(env_wert STEUERBOT_IMAGE_TAG)"

zurueckrollen() {
  warn "Rollback auf Image steuerbot:$ALT_TAG und Code $ALT_SHA …"
  git reset --hard "$ALT_SHA" >/dev/null
  env_setzen STEUERBOT_IMAGE_TAG "$ALT_TAG"
  compose up -d --no-build >/dev/null || true
  if warte_gesund 120; then warn "Rollback erfolgreich – alte Version läuft wieder."; else log "${ROT}Rollback: App nicht gesund – bitte manuell prüfen (docker compose logs app).${AUS}"; fi
  exit 1
}

# --- 1. Code holen ---
if [[ $NUR_IMAGES -eq 0 ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    fehler "Lokale Änderungen im Arbeitsverzeichnis – bitte committen oder verwerfen (git status)."
  fi
  if [[ -n "$REF" ]]; then
    git fetch --tags origin "$REF"
    ZIEL="FETCH_HEAD"
  else
    git fetch origin
    ZIEL="@{u}"
  fi
  NEU_SHA="$(git rev-parse "$ZIEL")"
  if [[ "$NEU_SHA" == "$ALT_SHA" ]]; then
    ok "Code ist aktuell ($(git rev-parse --short HEAD)) – baue trotzdem neu, um Sicherheitsupdates der Basis-Images zu übernehmen."
  else
    echo "Neue Änderungen:"
    git log --oneline "$ALT_SHA..$NEU_SHA" | head -20
    if [[ $JA -eq 0 && -t 0 ]]; then
      read -r -p "Ausrollen? [j/N] " a; [[ "$a" =~ ^[jJyY]$ ]] || fehler "Abgebrochen."
    fi
    git merge --ff-only "$NEU_SHA" >/dev/null || fehler "Kein Fast-Forward möglich – lokaler Stand weicht ab."
    ok "Code aktualisiert auf $(git rev-parse --short HEAD)"
  fi
fi

# --- 2. Neues Image bauen (Tests im Build; bei Fehlern bleibt die alte Version unverändert) ---
NEU_TAG="$(git rev-parse --short=12 HEAD)-$(date +%Y%m%d%H%M)"
if ! image_bauen "$NEU_TAG"; then
  git reset --hard "$ALT_SHA" >/dev/null
  fehler "Build fehlgeschlagen – nichts geändert, alte Version läuft weiter."
fi
ok "Image steuerbot:$NEU_TAG gebaut"

# --- 3. Proxy-Image aktualisieren ---
if compose pull caddy >/dev/null 2>&1; then ok "Caddy-Image aktualisiert"; else warn "Caddy-Image konnte nicht aktualisiert werden – verwende vorhandenes."; fi

# --- 4. Ausrollen ---
env_setzen STEUERBOT_IMAGE_TAG "$NEU_TAG"
compose up -d --no-build --remove-orphans || zurueckrollen
log "Warte auf Healthcheck …"
warte_gesund 180 || zurueckrollen

ok "Update erfolgreich: steuerbot:$NEU_TAG läuft"
[[ -n "$ALT_TAG" && "$ALT_TAG" != "latest" ]] && docker tag "steuerbot:$ALT_TAG" steuerbot:rollback 2>/dev/null || true
images_aufraeumen 3
