#!/usr/bin/env bash
# shellcheck disable=SC1111  # deutsche Anführungszeichen „…“ sind gewollt
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

# docker compose mit den zur Proxy-Variante passenden Dateien (STEUERBOT_PROXY in .env)
compose_dateien() {
  local proxy
  proxy="$(env_wert STEUERBOT_PROXY)"
  echo "$ROOT/docker-compose.yml"
  case "${proxy:-caddy}" in
    caddy | traefik | port | netzwerk) echo "$ROOT/deploy/compose.${proxy:-caddy}.yml" ;;
    *) fehler "Unbekannte Proxy-Variante STEUERBOT_PROXY=$proxy (caddy|traefik|port|netzwerk)" ;;
  esac
}

compose() {
  local caddy datei args=()
  caddy="$(env_wert CADDY_IMAGE)"
  while IFS= read -r datei; do args+=(-f "$datei"); done < <(compose_dateien)
  CADDY_IMAGE="${caddy:-caddy:2-alpine}" docker compose --project-directory "$ROOT" --env-file "$ENV_DATEI" "${args[@]}" "$@"
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

# ---------------------------------------------------------------------------
# Interaktive Abfragen (bei --ja oder ohne Terminal wird der Standardwert genommen)
# ---------------------------------------------------------------------------
INTERAKTIV=1
[[ -t 0 ]] || INTERAKTIV=0

frage() { # frage <Text> <Standard> → Antwort auf stdout
  local antwort
  if [[ $INTERAKTIV -eq 0 ]]; then echo "$2"; return; fi
  read -r -p "  $1 [${2:-leer}]: " antwort </dev/tty
  echo "${antwort:-$2}"
}

frage_jn() { # frage_jn <Text> <j|n> → Rückgabewert 0 = ja
  local antwort std="$2" hinweis
  [[ "$std" == "j" ]] && hinweis="J/n" || hinweis="j/N"
  if [[ $INTERAKTIV -eq 0 ]]; then [[ "$std" == "j" ]]; return; fi
  read -r -p "  $1 [$hinweis]: " antwort </dev/tty
  antwort="${antwort:-$std}"
  [[ "$antwort" =~ ^[jJyY] ]]
}

auswahl() { # auswahl <Text> <Standard-Nr> <Option>... → Nummer auf stdout
  local text="$1" std="$2" i antwort; shift 2
  if [[ $INTERAKTIV -eq 0 ]]; then echo "$std"; return; fi
  {
    echo "  $text"
    i=1; for o in "$@"; do printf '    %d) %s\n' "$i" "$o"; i=$((i + 1)); done
  } >/dev/tty
  while true; do
    read -r -p "  Auswahl [$std]: " antwort </dev/tty
    antwort="${antwort:-$std}"
    [[ "$antwort" =~ ^[0-9]+$ ]] && (( antwort >= 1 && antwort <= $# )) && { echo "$antwort"; return; }
    echo "  Bitte eine Zahl von 1 bis $# eingeben." >/dev/tty
  done
}

geheim() { # geheim <Text> → verdeckte Eingabe auf stdout
  local antwort=""
  if [[ $INTERAKTIV -eq 0 ]]; then echo ""; return; fi
  read -r -s -p "  $1: " antwort </dev/tty
  echo >/dev/tty
  echo "$antwort"
}

abschnitt() { echo; echo "${GRUEN}── $* ──${AUS}"; }

# ---------------------------------------------------------------------------
# Erkennung auf dem Server
# ---------------------------------------------------------------------------
port_belegt() { # port_belegt <Port> → 0 wenn belegt
  local p="$1"
  if command -v ss >/dev/null; then
    ss -ltnH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}$" && return 0
  fi
  docker ps --format '{{.Ports}}' 2>/dev/null | grep -qE "(0\.0\.0\.0|\[::\]|:::?):${p}->" && return 0
  return 1
}

# Gibt erkannte Reverse-Proxys aus, je Zeile „art|beschreibung|netzwerk“
proxys_erkennen() {
  local name image netz
  while read -r name image; do
    [[ -z "$name" || "$name" == steuerbot-* ]] && continue
    netz="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$name" 2>/dev/null | awk '{print $1}')"
    case "$image" in
      *traefik*) echo "traefik|Traefik (Container „$name“)|$netz" ;;
      *nginx-proxy-manager*) echo "netzwerk|Nginx Proxy Manager (Container „$name“)|$netz" ;;
      *swag* | *nginx* | *caddy* | *haproxy* | *httpd*) echo "netzwerk|${image%%:*} (Container „$name“)|$netz" ;;
    esac
  done < <(docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null)
  if command -v systemctl >/dev/null; then
    local d
    for d in nginx apache2 httpd caddy haproxy; do
      systemctl is-active --quiet "$d" 2>/dev/null && echo "port|$d (Systemdienst)|"
    done
  fi
  return 0
}
