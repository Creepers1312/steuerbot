#!/usr/bin/env bash
# Benutzer anlegen, Passwort ändern oder entfernen.
#
#   scripts/benutzer.sh anna              # anlegen bzw. Passwort ändern (verdeckte Abfrage)
#   scripts/benutzer.sh anna --entfernen
#   PASSWORT=… scripts/benutzer.sh anna   # nicht-interaktiv
#
# Gespeichert wird nur der scrypt-Hash in .env (STEUERBOT_BENUTZER). Node.js muss auf dem Server
# nicht installiert sein – der Hash wird im Steuerbot-Image (ohne Netzwerk) berechnet.
source "$(dirname "$0")/lib.sh"

NAME="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"; shift || true
ENTFERNEN=0; NEUSTART=1
for a in "$@"; do
  case "$a" in
    --entfernen) ENTFERNEN=1 ;;
    --ohne-neustart) NEUSTART=0 ;;
    *) fehler "Unbekannte Option: $a" ;;
  esac
done
[[ "$NAME" =~ ^[a-z0-9._-]{1,64}$ ]] || fehler "Aufruf: scripts/benutzer.sh <name> [--entfernen]   (a–z, 0–9, . _ -)"
[[ -f "$ENV_DATEI" ]] || fehler ".env fehlt – zuerst scripts/deploy.sh ausführen."

# Bestehende Einträge ohne diesen Namen
REST="$(env_wert STEUERBOT_BENUTZER | tr ',' '\n' | grep -v -E "^${NAME}=" | grep -v '^$' | paste -sd, - || true)"

if [[ $ENTFERNEN -eq 1 ]]; then
  env_setzen STEUERBOT_BENUTZER "$REST"
  ok "Benutzer '$NAME' entfernt"
else
  TAG="$(env_wert STEUERBOT_IMAGE_TAG)"
  docker image inspect "steuerbot:${TAG:-latest}" >/dev/null 2>&1 || fehler "Image steuerbot:${TAG:-latest} fehlt – zuerst scripts/deploy.sh ausführen."
  TTY=(-i); [[ -t 0 && -z "${PASSWORT:-}" ]] && TTY=(-it)
  EINTRAG="$(docker run --rm "${TTY[@]}" --network none --read-only --cap-drop ALL \
    -e PASSWORT="${PASSWORT:-}" -v "$ROOT/scripts:/s:ro" --entrypoint /nodejs/bin/node \
    "steuerbot:${TAG:-latest}" /s/passwort-hash.mjs "$NAME" | tr -d '\r' | grep -E "^${NAME}=scrypt\." || true)"
  [[ -n "$EINTRAG" ]] || fehler "Kein Hash erzeugt (Passwort zu kurz oder Abbruch)."
  env_setzen STEUERBOT_BENUTZER "${REST:+$REST,}$EINTRAG"
  ok "Benutzer '$NAME' gespeichert"
fi

if [[ $NEUSTART -eq 1 ]] && [[ -n "$(compose ps -q app 2>/dev/null || true)" ]]; then
  compose up -d --no-build --force-recreate app >/dev/null
  if warte_gesund 120; then ok "App mit neuer Benutzerliste neu gestartet"; else fehler "App nach Neustart nicht gesund."; fi
fi
