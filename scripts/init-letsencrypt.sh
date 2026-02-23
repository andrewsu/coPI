#!/bin/bash
# -----------------------------------------------------------
# init-letsencrypt.sh — Initial Let's Encrypt certificate setup
#
# Obtains the first SSL certificate for the domain using certbot.
# Run this ONCE on the server before starting the full stack.
#
# Prerequisites:
#   - Docker and Docker Compose installed
#   - DNS A record pointing DOMAIN to this server's public IP
#   - Ports 80 and 443 open in security group / firewall
#   - .env file with DOMAIN and CERTBOT_EMAIL set
#
# Usage:
#   chmod +x scripts/init-letsencrypt.sh
#   ./scripts/init-letsencrypt.sh
#
# What it does:
#   1. Creates required directories for certbot
#   2. Downloads recommended TLS parameters (if not present)
#   3. Creates a temporary self-signed certificate so nginx can start
#   4. Starts nginx (needs a cert to listen on 443)
#   5. Deletes the temporary self-signed certificate
#   6. Requests a real Let's Encrypt certificate via certbot
#   7. Reloads nginx with the real certificate
# -----------------------------------------------------------

set -euo pipefail

# Load environment
if [ -f .env ]; then
    # Export only DOMAIN and CERTBOT_EMAIL from .env
    export DOMAIN=$(grep '^DOMAIN=' .env | cut -d'=' -f2-)
    export CERTBOT_EMAIL=$(grep '^CERTBOT_EMAIL=' .env | cut -d'=' -f2-)
fi

# Validate required variables
if [ -z "${DOMAIN:-}" ]; then
    echo "Error: DOMAIN is not set. Add DOMAIN=yourdomain.com to .env"
    exit 1
fi

if [ -z "${CERTBOT_EMAIL:-}" ]; then
    echo "Error: CERTBOT_EMAIL is not set. Add CERTBOT_EMAIL=you@example.com to .env"
    exit 1
fi

# Use staging for testing (set CERTBOT_STAGING=1 to use Let's Encrypt staging)
STAGING_ARG=""
if [ "${CERTBOT_STAGING:-0}" = "1" ]; then
    STAGING_ARG="--staging"
    echo "Using Let's Encrypt STAGING environment (certificates will not be trusted)"
fi

COMPOSE="docker compose -f docker-compose.prod.yml"
DATA_PATH="./certbot"
RSA_KEY_SIZE=4096

echo "=== CoPI Let's Encrypt Certificate Setup ==="
echo "Domain: ${DOMAIN}"
echo "Email:  ${CERTBOT_EMAIL}"
echo ""

# Check for existing certificates
if [ -d "${DATA_PATH}/conf/live/${DOMAIN}" ]; then
    read -p "Existing certificate found for ${DOMAIN}. Replace? (y/N) " decision
    if [ "$decision" != "Y" ] && [ "$decision" != "y" ]; then
        echo "Keeping existing certificate."
        exit 0
    fi
fi

# 1. Create required directories
echo "--- Creating directories..."
mkdir -p "${DATA_PATH}/conf/live/${DOMAIN}"
mkdir -p "${DATA_PATH}/www"

# 2. Download recommended TLS parameters
if [ ! -e "${DATA_PATH}/conf/options-ssl-nginx.conf" ] || [ ! -e "${DATA_PATH}/conf/ssl-dhparams.pem" ]; then
    echo "--- Downloading recommended TLS parameters..."
    curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
        > "${DATA_PATH}/conf/options-ssl-nginx.conf"
    curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem \
        > "${DATA_PATH}/conf/ssl-dhparams.pem"
fi

# 3. Create a temporary self-signed certificate (nginx needs a cert to start)
echo "--- Creating temporary self-signed certificate..."
openssl req -x509 -nodes -newkey rsa:${RSA_KEY_SIZE} -days 1 \
    -keyout "${DATA_PATH}/conf/live/${DOMAIN}/privkey.pem" \
    -out "${DATA_PATH}/conf/live/${DOMAIN}/fullchain.pem" \
    -subj "/CN=localhost" \
    2>/dev/null

# 4. Start nginx (it needs a cert file to start the 443 listener)
echo "--- Starting nginx..."
${COMPOSE} up -d nginx
echo "Waiting for nginx to start..."
sleep 5

# 5. Delete the temporary self-signed certificate
echo "--- Removing temporary certificate..."
rm -rf "${DATA_PATH}/conf/live/${DOMAIN}"

# 6. Request a real certificate from Let's Encrypt
echo "--- Requesting Let's Encrypt certificate for ${DOMAIN}..."
${COMPOSE} run --rm certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "${CERTBOT_EMAIL}" \
    --agree-tos \
    --no-eff-email \
    --rsa-key-size ${RSA_KEY_SIZE} \
    ${STAGING_ARG} \
    -d "${DOMAIN}"

# 7. Reload nginx with the real certificate
echo "--- Reloading nginx..."
${COMPOSE} exec nginx nginx -s reload

echo ""
echo "=== Certificate obtained successfully! ==="
echo "Certificate location: ${DATA_PATH}/conf/live/${DOMAIN}/"
echo ""
echo "Now start the full stack:"
echo "  ${COMPOSE} up -d"
echo ""
echo "Certificates will auto-renew via the certbot service."
