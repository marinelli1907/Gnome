# Gnome

Gnome is a neighborhood marketplace for local food and garden goods, built by Boone Systems LLC. This repository contains the mobile app, web app, admin app, and Supabase backend.

## Repository layout

- [expo/](expo/): Expo and React Native mobile app.
- [web/](web/): Next.js web app.
- [admin/](admin/): separate Expo admin app. Read [admin/AGENTS.md](admin/AGENTS.md) before changing it.
- [supabase/](supabase/): database migrations, functions, scripts, and backend documentation.
- [docs/](docs/): product, billing, operations, compliance, and release documentation.

The source includes listings, markets, pickup coordination, garden features, and subscription allowances. Feature availability and payment activation depend on backend configuration and release decisions.

## Local development

Each app has its own package manifest and lockfile. Install and run commands from that app's directory.

### Mobile app

```sh
cd expo
npm ci
cp .env.example .env
npm start
```

Fill in local configuration before testing authenticated flows. Keep credentials out of version control.

Mobile checks are `npm run typecheck` and `npm run lint`. Native builds are available through `npm run ios` and `npm run android`.

### Web app

```sh
cd web
npm ci
cp .env.example .env.local
npm run dev
```

Web checks are `npm run typecheck` and `npm run build`.

### Admin app

The admin app has its own dependencies and Expo version. Use its [package manifest](admin/package.json) and [architecture guide](docs/admin/ADMIN_ARCHITECTURE.md); do not reuse the mobile app's dependency directory.

## Where to start

- [Monetization model and payment activation requirements](docs/MONETIZATION.md)
- [Market operations](docs/MARKET_OPS.md)
- [Backend setup](supabase/README.md)
- [Migration integrity](docs/db/MIGRATION_INTEGRITY.md)
- [Web deployment](docs/DEPLOY_WEB.md)
- [Release documentation](docs/release/)

Older planning documents describe earlier product scopes. Check the relevant implementation and release documentation before changing behavior or deploying. Live payments, schema changes, and production releases require their own review.
