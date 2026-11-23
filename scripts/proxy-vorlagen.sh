#!/usr/bin/env bash
# shellcheck disable=SC1111  # deutsche Anführungszeichen „…“ sind gewollt
# Erzeugt Konfigurationsvorlagen für einen vorhandenen Reverse-Proxy in deploy/generiert/
# (nginx, Caddy, Apache, Nginx Proxy Manager) – passend zu Domain und Port aus .env.
# TLS-Einstellungen angelehnt an BSI TR-02102-2. Wird von deploy.sh automatisch aufgerufen.
source "$(dirname "$0")/lib.sh"

[[ -f "$ENV_DATEI" ]] || fehler ".env fehlt – zuerst scripts/deploy.sh ausführen."
DOMAIN="$(env_wert STEUERBOT_DOMAIN)"
ZIEL="http://$(env_wert STEUERBOT_BIND | sed 's/^0\.0\.0\.0$/127.0.0.1/;s/^$/127.0.0.1/'):$(env_wert STEUERBOT_PORT | sed 's/^$/3000/')"
[[ "$(env_wert STEUERBOT_PROXY)" == "netzwerk" ]] && ZIEL="http://steuerbot-app:3000"
AUS_DIR="$ROOT/deploy/generiert"
mkdir -p "$AUS_DIR"

cat > "$AUS_DIR/nginx-steuerbot.conf" <<EOF
# Steuerbot hinter nginx – z. B. nach /etc/nginx/sites-available/steuerbot kopieren und aktivieren.
# Zertifikatspfade anpassen (z. B. certbot --nginx -d $DOMAIN).
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name $DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    # TLS nach BSI TR-02102-2: nur TLS 1.2/1.3, ECDHE + AES-GCM, NIST-Kurven
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers on;
    ssl_ecdh_curve secp384r1:prime256v1;
    ssl_session_tickets off;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    server_tokens off;
    client_max_body_size 20m;

    location / {
        proxy_pass $ZIEL;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # KI-Antworten werden gestreamt – nicht puffern
        proxy_buffering off;
        proxy_read_timeout 120s;
    }
}
EOF

cat > "$AUS_DIR/Caddyfile-steuerbot" <<EOF
# Steuerbot hinter einem vorhandenen Caddy – in die bestehende Caddyfile übernehmen.
$DOMAIN {
	tls {
		protocols tls1.2 tls1.3
		ciphers TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384 TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256 TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384 TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
		curves secp384r1 secp256r1
	}
	header Strict-Transport-Security "max-age=31536000; includeSubDomains"
	request_body {
		max_size 20MB
	}
	reverse_proxy ${ZIEL#http://} {
		flush_interval -1
	}
}
EOF

cat > "$AUS_DIR/apache-steuerbot.conf" <<EOF
# Steuerbot hinter Apache (Module: ssl, proxy, proxy_http, headers)
<VirtualHost *:443>
    ServerName $DOMAIN
    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/$DOMAIN/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/$DOMAIN/privkey.pem
    SSLProtocol -all +TLSv1.2 +TLSv1.3
    SSLCipherSuite ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256
    SSLOpenSSLConfCmd Curves secp384r1:prime256v1
    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
    LimitRequestBody 20971520
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    # flushpackets: KI-Antworten werden gestreamt
    ProxyPass        / $ZIEL/ flushpackets=on timeout=120
    ProxyPassReverse / $ZIEL/
</VirtualHost>
EOF

cat > "$AUS_DIR/ANLEITUNG-proxy.txt" <<EOF
Steuerbot im vorhandenen Proxy eintragen
========================================

Ziel (Forward):  $ZIEL
Domain:          $DOMAIN

Nginx Proxy Manager („Proxy Hosts“ → „Add Proxy Host“):
  - Domain Names:          $DOMAIN
  - Scheme / Forward:      http / ${ZIEL#http://}   (Hostname: steuerbot-app, Port: 3000)
  - Block Common Exploits: an
  - Websockets Support:    egal
  - SSL-Reiter:            Let's Encrypt-Zertifikat anfordern, „Force SSL“, „HTTP/2“ und „HSTS“ an
  - Advanced → Custom Nginx Configuration:
        proxy_buffering off;
        proxy_read_timeout 120s;
        client_max_body_size 20m;

Andere Proxys: Vorlagen für nginx, Caddy und Apache liegen in diesem Ordner.

Wichtig für alle Proxys:
  - Nur über HTTPS ausliefern (Anmelde-Cookies sind „Secure“ – über HTTP funktioniert die Anmeldung nicht).
  - Host-Header unverändert weiterreichen (sonst lehnt der CSRF-Schutz Anfragen ab).
  - Antworten nicht puffern (KI-Chat wird gestreamt) und Uploads bis 20 MB erlauben.
EOF

ok "Vorlagen erzeugt in deploy/generiert/"
