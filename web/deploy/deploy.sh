#!/usr/bin/env bash
# Gnome public website — build locally, ship to the Hostinger VPS, reload PM2.
#
# Usage:
#   VPS_HOST=root@147.79.75.242 ./deploy.sh
#
# Optional env:
#   VPS_HOST   ssh target                     (default root@147.79.75.242)
#   VPS_DIR    install dir on the VPS         (default /var/www/gnome-web)
#
# One-time server prep is in docs/DEPLOY_WEB.md (node, pm2, nginx, certbot).
set -euo pipefail

VPS_HOST="${VPS_HOST:-root@147.79.75.242}"
VPS_DIR="${VPS_DIR:-/var/www/gnome-web}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"   # web/

echo "▸ Building (standalone)…"
cd "$HERE"
npm ci
npm run build

# Standalone layout: server.js + pruned node_modules live in .next/standalone;
# static assets and /public must be placed alongside it by hand.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R .next/standalone/. "$STAGE"/
mkdir -p "$STAGE/.next"
cp -R .next/static "$STAGE/.next/static"
[ -d public ] && cp -R public "$STAGE/public"
cp deploy/ecosystem.config.cjs "$STAGE"/

echo "▸ Shipping to ${VPS_HOST}:${VPS_DIR}…"
ssh "$VPS_HOST" "mkdir -p '$VPS_DIR'"
rsync -az --delete "$STAGE"/ "${VPS_HOST}:${VPS_DIR}"/

echo "▸ Reloading PM2…"
ssh "$VPS_HOST" "cd '$VPS_DIR' && pm2 startOrReload ecosystem.config.cjs && pm2 save"

echo "✓ Deployed. Check https://gnomefarmersmarket.com"
