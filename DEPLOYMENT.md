# Quartiplay deployment — verified setup vs remaining checks

> **Status:** Source/build fixes are on the `fix/untrack-config-secrets-20261106` branch only. This document does **not** assert that payments, authentication, production deployment, or database connectivity have passed end-to-end tests.

## Local development

1. Install Node.js 22 and npm.
2. Install dependencies in both places:
   ```bash
   npm install
   npm --prefix client install
   ```
3. Create a **local, untracked** `.env` from `.env.example` and supply real values only on your machine or in the hosting provider's secret store. Never commit the file.
4. The Node/Express API runs with `npm start` (default port 3000). Configure `DATABASE_URL`, `JWT_SECRET` and other integrations used by your routes.
5. The Vite/React UI runs using `npm run client:dev` (default port 5173). Its build-time public variables are `VITE_API_URL` and `VITE_PAYPAL_CLIENT_ID`. **Do not put payment secrets, JWT secrets, passwords, or API private keys in any `VITE_*` variable.**

The frontend uses `import.meta.env.VITE_API_URL` and defaults to `http://localhost:3000` if unset. Configure `CORS_ORIGIN` on the backend for any additional frontend origins.

## Build verification

```bash
npm --prefix client run build
npm run build
docker compose config
docker compose build
```

A successful build checks syntax and packaging; it does **not** establish successful authentication, payment processing, data integrity, or compliance with financial regulations.

## Docker

The client is built with Vite (not Create React App). Its bundle is located in `client/dist`; the client container serves it on port 5173. The Docker build accepts `VITE_API_URL` and `VITE_PAYPAL_CLIENT_ID` as build arguments from Compose.

The database password `DB_PASSWORD` is required; the Compose file does not use a public default. PostgreSQL's host port is bound to loopback only. The root `.dockerignore` excludes local `.env` files from Docker build contexts. Never deploy with local-development credentials.

The server container runs Node 22 and no longer copies `.env` into its image. For deployments on cloud hosts, configure secrets in their environment stores, not in Git.

## Deployment destinations (proposed, not verified)

- **Backend:** any supported Node.js host with PostgreSQL; do not infer a live Render URL from this guide.
- **Frontend:** a static hosting platform such as Vercel; use framework **Vite**, root directory `client`, build command `npm run build`, output directory `dist`.
- Configure `VITE_API_URL` as the publicly reachable backend origin **before building**.
- Update backend `CORS_ORIGIN` to the exact live frontend origin.

## Security and go-live gates

- Remove tracked `.env` and all historic secrets from the repository and its Git history, including PR references/caches as appropriate. The branch-only deletion does not clean `main` or history.
- Revoke/rotate every credential published in Git history, including JWT/session/encryption/admin/database credentials wherever reused.
- Use production-approved payment credentials only after integration tests and merchant verification; **payments have not been tested end-to-end**.
- Run API, login, payment-sandbox, Postgres, Docker and live smoke tests before claiming the site is production-ready.
- Set up monitoring, backups, rate limits, authorization checks, and necessary legal/regulatory review for an investment-related platform.
