#!/usr/bin/env bash
# Gemeinsame Hilfsfunktionen für deploy.sh, update.sh und benutzer.sh
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DATEI="$ROOT/.env"
LOG_DATEI="$ROOT/deploy/betrieb.log"
cd "$ROOT"

if [[ -t 1 ]]; then GRUEN=$'\e[32m'; ROT=$'\e[31m'; GELB=$'\e[33m'; AUS=$'\e[0m'; else GRUEN=""; ROT=""; GELB=""; AUS=""; fi

log()    { local m; m="[$(date '+%F %T')] $*"; echo "$m" >> "$LOG_DATEI" 2>/dev/null || true; echo "$*"; }
ok()     { log "${GRUEN}✓${AUS} $*"; }
warn()   { log "${GELB}!${AUS} $*"; }
fehler() { log "${ROT}✗ $*${AUS}" >&2; exit 1; }

voraussetzungen() {
  command -v docker >/dev/null || fehler "Docker ist nicht installiert (https://docs.docker.com/engine/install/)."
  docker compose version >/dev/null 2>&1 || fehler "Docker Compose v2 fehlt (Paket docker-compose-plugin)."
  docker info >/dev/null 2>&1 || fehler "Docker läuft nicht oder keine Berechtigung (Benutzer in Gruppe 'docker' oder sudo)."
  command -v git >/dev/null || fehler "git ist nicht installiert."
  command -v openssl >/dev/null || fehler "openssl ist nicht installiert."
}

# Wert aus .env lesen (ohne die Datei als Shell auszuführen)
env_wert() {
  local key="$1"
  [[ -f "$ENV_DATEI" ]] || return 0
  grep -E "^${key}=" "$ENV_DATEI" | tail -n1 | cut -d= -f2- || true
}

# Wert in .env setzen oder ergänzen
env_setzen() {
  local key="$1" wert="$2" tmp
  tmp="$(mktemp "$ROOT/.env.XXXXXX")"
  if grep -qE "^${key}=" "$ENV_DATEI"; then
    awk -v k="$key" -v v="$wert" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$ENV_DATEI" > "$tmp"
  else
    cat "$ENV_DATEI" > "$tmp"
    printf '%s=%s\n' "$key" "$wert" >> "$tmp"
  fi
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_DATEI"
}

# Image bauen (Tests laufen im Build – bei Fehlern wird nichts ausgerollt)
image_bauen() {
  local tag="$1"; shift
  local args=(--pull -t "steuerbot:$tag" --build-arg "VERSION=$tag")
  local build_image ca proxy
  build_image="$(env_wert BUILD_IMAGE)"; [[ -n "$build_image" ]] && args+=(--build-arg "BUILD_IMAGE=$build_image")
  proxy="$(env_wert HTTPS_PROXY)"; [[ -n "$proxy" ]] && args+=(--build-arg "HTTPS_PROXY=$proxy" --network host)
  ca="$(env_wert NPM_CA_FILE)"; [[ -n "$ca" ]] && args+=(--secret "id=npm_ca,src=$ca")
  log "Baue Image steuerbot:$tag …"
  docker build "${args[@]}" "$@" "$ROOT"
}

compose() {
  local caddy
  caddy="$(env_wert CADDY_IMAGE)"
  CADDY_IMAGE="${caddy:-caddy:2-alpine}" docker compose --env-file "$ENV_DATEI" -f "$ROOT/docker-compose.yml" "$@"
}

# Warten, bis der App-Container „healthy“ ist
warte_gesund() {
  local timeout="${1:-120}" start id status
  start=$(date +%s)
  while (( $(date +%s) - start < timeout )); do
    id="$(compose ps -q app 2>/dev/null || true)"
    if [[ -n "$id" ]]; then
      status="$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo unbekannt)"
      [[ "$status" == "healthy" ]] && return 0
      [[ "$status" == "unhealthy" ]] && return 1
    fi
    sleep 3
  done
  return 1
}

# Ältere Images aufräumen (die neuesten $1 behalten)
images_aufraeumen() {
  local behalten="${1:-3}"
  docker images steuerbot --format '{{.CreatedAt}}\t{{.Tag}}' \
    | sort -r | awk -F'\t' '$2!="latest" && $2!="rollback" {print $2}' \
    | tail -n +"$((behalten + 1))" | while read -r t; do docker rmi "steuerbot:$t" >/dev/null 2>&1 || true; done
  docker image prune -f >/dev/null 2>&1 || true
}
