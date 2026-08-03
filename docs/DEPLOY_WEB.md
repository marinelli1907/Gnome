# Deploying the Gnome website to the VPS

Target: `gnomefarmersmarket.com` → Hostinger KVM VPS `147.79.75.242` (the box
that already hosts the other Boone sites). The site is the read-only Next.js
app in `web/`, built as a standalone bundle and run by PM2 behind nginx.

## 1. DNS (Hostinger hPanel, one time)

| Type  | Name | Value            |
|-------|------|------------------|
| A     | @    | 147.79.75.242    |
| CNAME | www  | gnomefarmersmarket.com |

Propagation is usually minutes since both the domain and the VPS are at
Hostinger.

## 2. One-time server prep (ssh to the VPS)

Skip anything the box already has (it likely has node/pm2/nginx from the other
sites):

```bash
# Node 20+ and PM2
node -v || (curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs)
pm2 -v  || npm i -g pm2

# nginx site
cp /var/www/gnome-web/…  # (deploy first, see step 3) or copy web/deploy/nginx-gnome.conf manually
cp nginx-gnome.conf /etc/nginx/sites-available/gnome
ln -s /etc/nginx/sites-available/gnome /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# TLS after DNS resolves
certbot --nginx -d gnomefarmersmarket.com -d www.gnomefarmersmarket.com
```

Port: the app listens on `127.0.0.1:3007` (see `ecosystem.config.cjs`). If 3007
is taken by another site on the box, change it in BOTH `ecosystem.config.cjs`
and `nginx-gnome.conf`.

## 3. Deploy (from this repo, any time)

```bash
cd web/deploy
VPS_HOST=root@147.79.75.242 ./deploy.sh
```

Builds locally (`output: 'standalone'`), rsyncs `server.js` + static assets +
`public/` to `/var/www/gnome-web`, and `pm2 startOrReload`s the app. The
Supabase URL + anon key are inlined at build time from `web/.env.local` (they
are public client values; RLS is the security boundary).

## Notes

- **Apply migration 0015 before deploying** a build from `feat/beta-prep` —
  the market pages select `public_markets.verified_email` (see BETA_PREP.md).
- ISR revalidation (60–600s) runs in the node process; no cron needed.
- Rollback: previous bundle is gone after `--delete` — redeploy from the prior
  git commit if needed (`git checkout <sha> -- web && cd web/deploy && ./deploy.sh`).
