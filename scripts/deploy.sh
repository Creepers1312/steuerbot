#!/usr/bin/env bash
# shellcheck disable=SC1111  # deutsche Anführungszeichen „…“ sind gewollt
# Steuerbot auf einem Server einrichten – geführter Assistent.
#
#   scripts/deploy.sh                    # fragt alles Nötige ab (empfohlen)
#   scripts/deploy.sh --konfigurieren    # bestehende Installation neu konfigurieren
#
# Fragen des Assistenten: Erreichbarkeit (Internet / Heimnetz / lokal), Domain, vorhandener Reverse-Proxy
# (wird automatisch erkannt: Traefik, Nginx Proxy Manager, nginx/Apache/Caddy …), TLS, erster Benutzer,
# KI ja/nein, automatische Updates, Firewall.
#
# Ohne Rückfragen (z. B. für Automatisierung) – alle Werte als Optionen, Rest Standard:
#   PASSWORT=… scripts/deploy.sh --ja --modus internet --domain steuer.example.de --tls admin@example.de \
#     --proxy caddy --benutzer anna [--port 3000 --bind 127.0.0.1] [--netzwerk proxy] \
#     [--entrypoint websecure --certresolver letsencrypt] [--ki] [--modell claude-sonnet-5-5] [--cron]
#   (API-Schlüssel für --ki über die Umgebungsvariable ANTHROPIC_API_KEY)
source "$(dirname "$0")/lib.sh"

# ---------------------------------------------------------------------------
# Optionen
# ---------------------------------------------------------------------------
MODUS=""; DOMAIN=""; TLS=""; PROXY=""; PORT=""; BIND=""; NETZWERK=""; ENTRYPOINT=""; CERTRESOLVER=""
BENUTZER=""; KI=""; MODELL=""; CRON=""; KONFIGURIEREN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --modus) MODUS="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --tls) TLS="$2"; shift 2 ;;
    --proxy) PROXY="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --bind) BIND="$2"; shift 2 ;;
    --netzwerk) NETZWERK="$2"; shift 2 ;;
    --entrypoint) ENTRYPOINT="$2"; shift 2 ;;
    --certresolver) CERTRESOLVER="$2"; shift 2 ;;
    --benutzer) BENUTZER="$2"; shift 2 ;;
    --ki) KI=1; shift ;;
    --ohne-ki) KI=0; shift ;;
    --modell) MODELL="$2"; shift 2 ;;
    --cron) CRON=1; shift ;;
    --kein-cron) CRON=0; shift ;;
    --konfigurieren) KONFIGURIEREN=1; shift ;;
    --ja | -y) INTERAKTIV=0; shift ;;
    -h | --help) sed -n '2,17p' "$0"; exit 0 ;;
    *) fehler "Unbekannte Option: $1 (Hilfe: --help)" ;;
  esac
done

voraussetzungen
mkdir -p "$ROOT/deploy"
echo "${GRUEN}Steuerbot – Einrichtung${AUS}  ($(git rev-parse --short HEAD 2>/dev/null || echo ohne-git))"
log "=== Deploy gestartet ==="

# ---------------------------------------------------------------------------
# Vorprüfung: Ressourcen
# ---------------------------------------------------------------------------
RAM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
FREI_MB="$(df -Pm "$ROOT" | awk 'NR==2 {print $4}')"
[[ "$RAM_MB" -gt 0 && "$RAM_MB" -lt 1500 ]] && warn "Nur ${RAM_MB} MB Arbeitsspeicher – der Build braucht etwa 1,5 GB (ggf. Swap anlegen)."
[[ "${FREI_MB:-0}" -lt 3000 ]] && warn "Nur ${FREI_MB} MB freier Speicherplatz – empfohlen sind mindestens 3 GB."

# ---------------------------------------------------------------------------
# Bestehende Konfiguration?
# ---------------------------------------------------------------------------
if [[ -f "$ENV_DATEI" ]]; then
  echo
  echo "  Vorhandene Konfiguration: Domain $(env_wert STEUERBOT_DOMAIN), Proxy $(env_wert STEUERBOT_PROXY | grep . || echo caddy), Benutzer: $(env_wert STEUERBOT_BENUTZER | tr ',' '\n' | cut -d= -f1 | paste -sd, -)"
  if [[ $KONFIGURIEREN -eq 0 ]] && ! frage_jn "Konfiguration ändern? (Nein = nur neu bauen und starten)" n; then
    KONFIGURIEREN=0
  else
    KONFIGURIEREN=1
  fi
else
  umask 077
  cp "$ROOT/.env.example" "$ENV_DATEI"
  chmod 600 "$ENV_DATEI"
  KONFIGURIEREN=1
fi

if [[ $KONFIGURIEREN -eq 1 ]]; then
  # Vorherigen Stand sichern – bei Abbruch wird er wiederhergestellt
  SICHERUNG="$(mktemp "$ROOT/.env.vorher.XXXXXX")"
  cp -p "$ENV_DATEI" "$SICHERUNG"
  zuruecksetzen() { mv -f "$SICHERUNG" "$ENV_DATEI"; chmod 600 "$ENV_DATEI"; }
  trap 'zuruecksetzen; echo; fehler "Abgebrochen – vorherige Konfiguration wiederhergestellt."' INT

  # -------------------------------------------------------------------------
  abschnitt "1/6 Erreichbarkeit"
  # -------------------------------------------------------------------------
  if [[ -z "$MODUS" ]]; then
    case "$(auswahl "Wie soll Steuerbot erreichbar sein?" 1 \
      "Im Internet unter einer eigenen Domain (z. B. steuer.meinefamilie.de)" \
      "Nur im Heimnetz oder per VPN (z. B. steuerbot.local)" \
      "Nur auf diesem Rechner (zum Testen)")" in
      1) MODUS=internet ;; 2) MODUS=heimnetz ;; 3) MODUS=lokal ;;
    esac
  fi
  case "$MODUS" in internet | heimnetz | lokal) ;; *) fehler "--modus muss internet, heimnetz oder lokal sein" ;; esac

  if [[ -z "$DOMAIN" ]]; then
    case "$MODUS" in
      internet) DOMAIN="$(frage "Domain (muss per DNS auf diesen Server zeigen)" "$(env_wert STEUERBOT_DOMAIN | grep -v '^localhost$' || true)")" ;;
      heimnetz) DOMAIN="$(frage "Hostname oder IP im Heimnetz" "$(hostname 2>/dev/null || echo steuerbot).local")" ;;
      lokal) DOMAIN="localhost" ;;
    esac
  fi
  [[ -n "$DOMAIN" ]] || fehler "Keine Domain angegeben."
  if [[ "$MODUS" == "internet" ]]; then
    IP="$(getent ahosts "$DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}' || true)"
    if [[ -z "$IP" ]]; then
      warn "„$DOMAIN“ lässt sich nicht auflösen – DNS-Eintrag (A/AAAA) auf diesen Server anlegen, sonst klappt das Zertifikat nicht."
      if [[ $INTERAKTIV -eq 1 ]]; then frage_jn "Trotzdem fortfahren?" n || fehler "Abgebrochen – bitte zuerst DNS einrichten."; fi
    else
      ok "$DOMAIN zeigt auf $IP – bitte prüfen, dass das die öffentliche Adresse dieses Servers ist."
    fi
  fi

  # -------------------------------------------------------------------------
  abschnitt "2/6 Reverse-Proxy"
  # -------------------------------------------------------------------------
  ERKANNT="$(proxys_erkennen)"
  STD=1
  if [[ -n "$ERKANNT" ]]; then
    echo "  Gefunden:"
    echo "$ERKANNT" | while IFS='|' read -r _ beschreibung netz; do echo "    • $beschreibung${netz:+ – Netz: $netz}"; done
    case "$(echo "$ERKANNT" | head -1 | cut -d'|' -f1)" in traefik) STD=2 ;; port) STD=3 ;; netzwerk) STD=4 ;; esac
  fi
  BELEGT=""
  port_belegt 80 && BELEGT+=" 80"
  port_belegt 443 && BELEGT+=" 443"
  [[ -n "$BELEGT" ]] && { echo "  Belegte Ports:$BELEGT – ein anderer Dienst (vermutlich ein Proxy) läuft bereits."; [[ $STD -eq 1 ]] && STD=3; }

  if [[ -z "$PROXY" ]]; then
    case "$(auswahl "Gibt es auf diesem Server schon einen Reverse-Proxy?" "$STD" \
      "Nein – den mitgelieferten Caddy verwenden (TLS automatisch, BSI-konform eingestellt)" \
      "Ja, Traefik (Docker)" \
      "Ja, nginx / Apache / Caddy direkt auf dem Server" \
      "Ja, ein Proxy als Container in einem Docker-Netz (z. B. Nginx Proxy Manager)")" in
      1) PROXY=caddy ;; 2) PROXY=traefik ;; 3) PROXY=port ;; 4) PROXY=netzwerk ;;
    esac
  fi
  STD_NETZ="$(echo "$ERKANNT" | awk -F'|' -v a="$PROXY" '$1==a && $3!="" {print $3; exit}')"

  case "$PROXY" in
    caddy)
      if [[ -n "$BELEGT" ]]; then
        if [[ "$MODUS" == "internet" ]]; then
          fehler "Ports$BELEGT sind belegt – Let's Encrypt braucht 80/443. Bitte den vorhandenen Proxy wählen (erneut starten) oder ihn stoppen."
        fi
        warn "Ports$BELEGT belegt – Caddy nutzt stattdessen andere Ports."
        env_setzen STEUERBOT_HTTP_PORT "$(frage "HTTP-Port für Caddy" 8080)"
        env_setzen STEUERBOT_HTTPS_PORT "$(frage "HTTPS-Port für Caddy" 8443)"
      fi
      if [[ -z "$TLS" ]]; then
        if [[ "$MODUS" == "internet" ]]; then
          TLS="$(frage "E-Mail-Adresse für Let's Encrypt (Ablaufwarnungen)" "$(env_wert STEUERBOT_TLS | grep '@' || true)")"
          [[ "$TLS" == *@* ]] || fehler "Für Let's Encrypt wird eine E-Mail-Adresse benötigt."
        else
          TLS="internal"
        fi
      fi
      env_setzen STEUERBOT_TLS "$TLS"
      ;;
    traefik)
      NETZWERK="${NETZWERK:-$(frage "Docker-Netz von Traefik" "${STD_NETZ:-proxy}")}"
      ENTRYPOINT="${ENTRYPOINT:-$(frage "Traefik-Entrypoint für HTTPS" websecure)}"
      CERTRESOLVER="${CERTRESOLVER:-$(frage "Traefik-Certresolver" letsencrypt)}"
      docker network inspect "$NETZWERK" >/dev/null 2>&1 || fehler "Docker-Netz „$NETZWERK“ existiert nicht (docker network ls)."
      env_setzen STEUERBOT_PROXY_NETZWERK "$NETZWERK"
      env_setzen TRAEFIK_ENTRYPOINT "$ENTRYPOINT"
      env_setzen TRAEFIK_CERTRESOLVER "$CERTRESOLVER"
      ;;
    port)
      BIND="${BIND:-$(frage "Adresse für die App (127.0.0.1 = nur der Proxy auf diesem Server)" 127.0.0.1)}"
      [[ "$BIND" == "127.0.0.1" ]] || warn "Die App ist dann direkt über $BIND erreichbar – nur sinnvoll, wenn der Proxy auf einem anderen Rechner läuft (Firewall!)."
      PORT="${PORT:-$(frage "Port für die App" 3000)}"
      [[ "$PORT" =~ ^[0-9]+$ ]] || fehler "Ungültiger Port: $PORT"
      if port_belegt "$PORT" && [[ "$(compose ps -q app 2>/dev/null)" == "" ]]; then fehler "Port $PORT ist bereits belegt."; fi
      env_setzen STEUERBOT_BIND "$BIND"
      env_setzen STEUERBOT_PORT "$PORT"
      ;;
    netzwerk)
      NETZWERK="${NETZWERK:-$(frage "Docker-Netz des Proxys" "${STD_NETZ:-proxy}")}"
      docker network inspect "$NETZWERK" >/dev/null 2>&1 || fehler "Docker-Netz „$NETZWERK“ existiert nicht (docker network ls)."
      env_setzen STEUERBOT_PROXY_NETZWERK "$NETZWERK"
      ;;
    *) fehler "--proxy muss caddy, traefik, port oder netzwerk sein" ;;
  esac
  env_setzen STEUERBOT_PROXY "$PROXY"
  env_setzen STEUERBOT_DOMAIN "$DOMAIN"

  # -------------------------------------------------------------------------
  abschnitt "3/6 Anmeldung"
  # -------------------------------------------------------------------------
  if [[ -z "$(env_wert STEUERBOT_BENUTZER)" ]]; then
    [[ -n "$BENUTZER" ]] || BENUTZER="$(frage "Erster Benutzername" admin)"
    echo "  Das Passwort wird nach dem Bauen verdeckt abgefragt (mind. 12 Zeichen)."
  else
    ok "Benutzer vorhanden – weitere mit scripts/benutzer.sh <name>"
  fi
  if [[ "$(env_wert STEUERBOT_SESSION_SECRET | wc -c)" -lt 33 ]]; then
    env_setzen STEUERBOT_SESSION_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
  fi
  STUNDEN="$(frage "Automatisch abmelden nach wie vielen Stunden? (1–24)" "$(env_wert STEUERBOT_SITZUNG_STUNDEN | grep . || echo 8)")"
  if ! [[ "$STUNDEN" =~ ^[0-9]+$ ]] || (( STUNDEN < 1 || STUNDEN > 24 )); then warn "Ungültig – verwende 8 Stunden."; STUNDEN=8; fi
  env_setzen STEUERBOT_SITZUNG_STUNDEN "$STUNDEN"

  # -------------------------------------------------------------------------
  abschnitt "4/6 KI-Assistent (optional)"
  # -------------------------------------------------------------------------
  echo "  Fragebogen und Rechner funktionieren ohne KI. Mit KI kommen Chat und Belegerkennung dazu;"
  echo "  dafür gehen Chat-Nachrichten, Datenstand und Belege an die Claude-API (Anthropic, USA)."
  if [[ -z "$KI" ]]; then frage_jn "KI-Funktionen aktivieren?" "$([[ -n "$(env_wert ANTHROPIC_API_KEY)" ]] && echo j || echo n)" && KI=1 || KI=0; fi
  if [[ "$KI" -eq 1 ]]; then
    SCHLUESSEL="${ANTHROPIC_API_KEY:-}"
    [[ -n "$SCHLUESSEL" ]] || SCHLUESSEL="$(geheim "Claude-API-Schlüssel (leer = vorhandenen behalten)")"
    [[ -n "$SCHLUESSEL" ]] || SCHLUESSEL="$(env_wert ANTHROPIC_API_KEY)"
    [[ "$SCHLUESSEL" == sk-ant-* ]] || warn "Der Schlüssel beginnt nicht mit „sk-ant-“ – bitte prüfen."
    env_setzen ANTHROPIC_API_KEY "$SCHLUESSEL"
    if [[ -z "$MODELL" ]]; then
      case "$(auswahl "Welches Modell?" 1 "Claude Opus 5.5 – am genauesten (Standard)" "Claude Sonnet 5.5 – etwa halb so teuer")" in
        1) MODELL=claude-opus-5-5 ;; 2) MODELL=claude-sonnet-5-5 ;;
      esac
    fi
    env_setzen STEUERBOT_MODEL "$MODELL"
    echo "  Tipp: In der Claude-Konsole ein monatliches Ausgabenlimit setzen."
  else
    env_setzen ANTHROPIC_API_KEY ""
  fi

  # -------------------------------------------------------------------------
  abschnitt "5/6 Automatische Updates"
  # -------------------------------------------------------------------------
  if [[ -z "$CRON" ]]; then frage_jn "Wöchentlich automatisch aktualisieren (Montag 04:17, mit Rollback bei Fehlern)?" j && CRON=1 || CRON=0; fi

  # -------------------------------------------------------------------------
  abschnitt "6/6 Zusammenfassung"
  # -------------------------------------------------------------------------
  cat <<ZUSAMMEN
  Erreichbar:   $MODUS – $DOMAIN
  Proxy:        $PROXY$( [[ "$PROXY" == port ]] && echo " ($BIND:$PORT)" )$( [[ "$PROXY" == traefik || "$PROXY" == netzwerk ]] && echo " (Netz $NETZWERK)" )
  TLS:          $( [[ "$PROXY" == caddy ]] && echo "${TLS/internal/eigene Zertifizierungsstelle (Heimnetz)}" || echo "übernimmt der vorhandene Proxy" )
  KI:           $( [[ "$KI" -eq 1 ]] && echo "an ($MODELL)" || echo "aus" )
  Auto-Update:  $( [[ "$CRON" -eq 1 ]] && echo "wöchentlich" || echo "nein" )
ZUSAMMEN
  if ! frage_jn "So einrichten?" j; then
    zuruecksetzen
    fehler "Abgebrochen – vorherige Konfiguration wiederhergestellt, nichts geändert."
  fi
  trap - INT
  rm -f "$SICHERUNG"
fi
chmod 600 "$ENV_DATEI"

# ---------------------------------------------------------------------------
# Bauen, Benutzer, Starten
# ---------------------------------------------------------------------------
abschnitt "Image bauen (inkl. Tests)"
TAG="$(git rev-parse --short=12 HEAD 2>/dev/null || echo lokal)-$(date +%Y%m%d%H%M)"
image_bauen "$TAG"
ok "Image steuerbot:$TAG gebaut"
env_setzen STEUERBOT_IMAGE_TAG "$TAG"

if [[ -z "$(env_wert STEUERBOT_BENUTZER)" ]]; then
  abschnitt "Ersten Benutzer anlegen"
  "$ROOT/scripts/benutzer.sh" "${BENUTZER:-admin}" --ohne-neustart
fi

abschnitt "Starten"
compose up -d --no-build --remove-orphans
warte_gesund 180 || { compose logs --tail 50 app >&2 || true; fehler "App wurde nicht gesund – siehe Logs oben."; }
ok "App läuft und ist gesund"

# ---------------------------------------------------------------------------
# Automatische Updates (Cron) und Firewall
# ---------------------------------------------------------------------------
if [[ "${CRON:-0}" -eq 1 ]] && command -v crontab >/dev/null; then
  ZEILE="17 4 * * 1 $ROOT/scripts/update.sh --ja >> $ROOT/deploy/betrieb.log 2>&1 # steuerbot-update"
  { crontab -l 2>/dev/null | grep -v '# steuerbot-update' || true; echo "$ZEILE"; } | crontab -
  ok "Wöchentliches Update eingerichtet (crontab -l)"
elif [[ "${CRON:-0}" -eq 1 ]]; then
  warn "crontab nicht gefunden – bitte manuell einrichten: 17 4 * * 1 $ROOT/scripts/update.sh --ja"
fi

PROXY="$(env_wert STEUERBOT_PROXY)"; PROXY="${PROXY:-caddy}"
if [[ "$PROXY" == "caddy" ]] && command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  HP="$(env_wert STEUERBOT_HTTP_PORT)"; SP="$(env_wert STEUERBOT_HTTPS_PORT)"
  if frage_jn "Firewall (ufw) ist aktiv – Ports ${HP:-80} und ${SP:-443} freigeben?" j; then
    ufw allow "${HP:-80}/tcp" >/dev/null && ufw allow "${SP:-443}/tcp" >/dev/null && ok "Firewall-Regeln ergänzt"
  fi
fi

# ---------------------------------------------------------------------------
# Hinweise und Vorlagen für vorhandene Proxys
# ---------------------------------------------------------------------------
DOMAIN="$(env_wert STEUERBOT_DOMAIN)"
"$ROOT/scripts/proxy-vorlagen.sh" >/dev/null
abschnitt "Fertig"
case "$PROXY" in
  caddy)
    HTTPS_PORT="$(env_wert STEUERBOT_HTTPS_PORT)"
    ok "Steuerbot: https://$DOMAIN${HTTPS_PORT:+:$HTTPS_PORT}"
    if [[ "$(env_wert STEUERBOT_TLS)" == "internal" ]]; then
      warn "Eigenes Zertifikat: Stammzertifikat einmal auf den Geräten installieren, sonst warnt der Browser:"
      echo "    docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > steuerbot-root.crt"
    fi
    echo "  Firewall/Router: Ports ${HTTPS_PORT:-443} (und 80 für Let's Encrypt) freigeben."
    ;;
  traefik)
    ok "Traefik routet https://$DOMAIN auf Steuerbot (Labels sind gesetzt)."
    echo "  Hinweis: Zertifikat und Weiterleitung von HTTP liegen bei Traefik."
    ;;
  port)
    ok "App läuft auf http://$(env_wert STEUERBOT_BIND):$(env_wert STEUERBOT_PORT) – jetzt im vorhandenen Proxy eintragen:"
    echo "    nginx:  deploy/generiert/nginx-steuerbot.conf"
    echo "    Caddy:  deploy/generiert/Caddyfile-steuerbot"
    echo "    Apache: deploy/generiert/apache-steuerbot.conf"
    echo "  Wichtig: HTTPS am Proxy, Puffer für Streaming aus, Host-Header weiterreichen (steht in den Vorlagen)."
    ;;
  netzwerk)
    ok "App ist im Netz „$(env_wert STEUERBOT_PROXY_NETZWERK)“ als http://steuerbot-app:3000 erreichbar."
    echo "  Anleitung für den Proxy (z. B. Nginx Proxy Manager): deploy/generiert/ANLEITUNG-proxy.txt"
    ;;
esac
echo
echo "  Benutzer hinzufügen:  scripts/benutzer.sh <name>"
echo "  Aktualisieren:        scripts/update.sh"
echo "  Neu konfigurieren:    scripts/deploy.sh --konfigurieren"
