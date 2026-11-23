# syntax=docker/dockerfile:1
#
# Steuerbot – Container-Image (mehrstufig)
#  1. deps   – Abhängigkeiten exakt nach package-lock.json
#  2. build  – Lint, Typprüfung, Tests, Produktions-Build (bricht bei Fehlern ab)
#  3. runtime – minimales Distroless-Image ohne Shell/Paketmanager, läuft als Nicht-root
#
# Basis-Images sind über Build-Argumente austauschbar (z. B. Spiegel-Registry);
# update.sh baut regelmäßig mit --pull neu (aktuelle Sicherheitsupdates des Build-Images).

ARG BUILD_IMAGE=node:22-alpine

FROM ${BUILD_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: keine Install-Skripte fremder Pakete ausführen.
# Optional: CA-Zertifikat eines Firmen-Proxys als Build-Secret „npm_ca“ (wird nicht ins Image übernommen);
# den Proxy selbst über die Standard-Build-Argumente HTTPS_PROXY/HTTP_PROXY angeben.
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export npm_config_cafile=/run/secrets/npm_ca; fi; \
    npm ci --ignore-scripts --no-audit --no-fund

FROM ${BUILD_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run lint && npx tsc --noEmit && npm test && npm run build

# Laufzeit-Image per Digest festgenagelt – Dependabot schlägt Aktualisierungen vor
FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e AS runtime
ARG VERSION=unbekannt
LABEL org.opencontainers.image.title="Steuerbot" \
      org.opencontainers.image.description="Steuererstattung schätzen – Familienbetrieb" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/Creepers1312/steuerbot"
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    STEUERBOT_VERSION=${VERSION}
# Nur das Nötigste: Standalone-Server, statische Dateien, Healthcheck – gehört root, ist für die App nur lesbar
COPY --from=build --chown=0:0 /app/.next/standalone ./
COPY --from=build --chown=0:0 /app/.next/static ./.next/static
COPY --from=build --chown=0:0 /app/public ./public
COPY --chown=0:0 deploy/healthcheck.mjs ./healthcheck.mjs
USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["/nodejs/bin/node", "/app/healthcheck.mjs"]
CMD ["server.js"]
