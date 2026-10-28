# Freelancia

Freelancia is an escrow-protected freelance marketplace prototype. The project
contains a React/Vite frontend, an Express/TypeScript API, a PostgreSQL/Prisma
data layer, and local PostgreSQL, Redis, and RustFS S3-compatible storage.

## Requirements

- Node.js 20 or newer
- npm
- Docker Compose v2 (optional, for starting all local services together)
- PostgreSQL 16+ (only needed when running the API without Docker)

## Local development

1. Copy `.env.example` to `.env`. The example values are for local development
   only; replace secrets before using the app outside a local demo.
2. Start the database, queue, object storage, and API with Docker:

   ```sh
   docker compose up --build
   ```

   The API applies migrations and loads demo data on startup. It is available
   at `http://localhost:3000/healthz` (`/readyz` checks its database
   connection); the Compose PostgreSQL instance is at `localhost:5433`
   (the native Windows PostgreSQL instance uses `localhost:5432`),
      Redis at `localhost:6379`, and the local S3-compatible object-storage
      console at `http://localhost:9001`.
3. In another terminal, start the frontend:

   ```sh
   cd frontend
   npm ci
   npm run dev
   ```

   The prototype is served at `http://localhost:5173`.

The application includes email/password and wallet-based SIWE authentication,
project browsing and publishing, proposals, account dashboards, notifications,
participant-authorized collaboration with Socket.IO message updates, and
wallet-based escrow funding, work submission, revision, dispute, and release
confirmation. Submission uploads use S3-compatible storage and AI verification
runs in a separate worker. Set `ANTHROPIC_API_KEY` in `.env` to enable AI
verification, and configure the S3-compatible storage values if you change the
local MinIO defaults. AI verification is advisory only and never authorizes
payment. Select **Continue as guest** to explore the prototype without a
database account; guest changes are not saved.

### Database contents

PostgreSQL is the source of truth for users and profiles, linked wallets,
projects and requirements, proposals and shortlists, escrows and chain
transaction references, submissions and advisory reports, revisions,
disputes and evidence, messages, reviews, transactions, notifications,
activity, notification preferences, refresh sessions, SIWE nonces, and
testimonials. Prisma migrations create and evolve this relational schema.

The repeatable local seed creates six client accounts, five freelancer
accounts, six browseable projects with eighteen related proposals, a shortlist,
the FL-2048 review workspace with requirement-linked sample submission/report
and messages, plus demo notifications, activity, and testimonials. The sample
workspace has no escrow and the seed creates no transactions; preview amounts
and guest actions are illustrative only and do not represent saved activity or
real transfers. The seed deliberately does not invent wallet addresses or
pretend a sample escrow is funded on a real chain.

### Without Docker (Windows)

Docker is optional. Install PostgreSQL 16 or newer on Windows, then create a
local application role and database from PowerShell:

```powershell
psql -U postgres -h localhost -c "CREATE ROLE freelancia LOGIN PASSWORD 'freelancia';"
psql -U postgres -h localhost -c "CREATE DATABASE freelancia OWNER freelancia;"
```

Use a different local password if preferred and update `DATABASE_URL` to match.
Redis and MinIO are required for queued
submission verification and file uploads; they can run as native services or
be hosted. Docker Compose provides local PostgreSQL, Redis, and RustFS
S3-compatible object storage. Run the API and verification worker in separate
terminals:

Then, in PowerShell:

```powershell
cd backend
Copy-Item ..\.env.example .env
# Edit backend\.env and set DATABASE_URL for your local PostgreSQL instance.
npm ci
npm run db:generate
npm run db:deploy
npm run db:seed
npm run db:check
npm run dev
```

In another `backend` terminal, start the verification worker after configuring
`REDIS_URL`, S3 storage, and (for AI analysis) `ANTHROPIC_API_KEY`:

```powershell
npm run worker:verification
```

In a separate terminal:

```powershell
cd frontend
npm ci
npm run dev
```

In VS Code, use **Terminal → Run Task → Freelancia: Start app** when using
Docker. The task starts the Compose services, then starts Vite and opens the
app at `http://localhost:5173`. It avoids starting a second local API on port
`3000`, which would conflict with the API already running in Docker. Docker
Desktop must be running first. If you are not using Docker, run **Freelancia:
Start API** and **Freelancia: Start frontend** as separate tasks instead.

The **Go Live** button belongs to the Live Server extension, which serves
files statically and does not compile this React/TSX app. Use the Vite task
(or `npm.cmd run dev` from `frontend/`) instead.

You still need a running PostgreSQL database and the migration/seed steps above
before signup or login can use the database. `db:check` confirms database
connectivity and checks the seeded project workspace, proposals, submission,
AI report, and messages.

The demo accounts are `client@freelancia.dev` and
`freelancer@freelancia.dev`. Their local demo password defaults to
`FreelanciaDemo2026!`; set `DEMO_PASSWORD` before seeding to use another one.
The seed is repeatable. These credentials and demo data are for local review
only and must not be used in a deployed environment.

The frontend opens on a sign-in screen when there is no valid session.
Choose **Create account** to register with an email, password, name, and role.
Successful sign-in creates HTTP-only access and refresh cookies; refreshing the
page restores the session, and **Sign out** revokes the refresh session. The
role switch is restricted to roles assigned to the signed-in account. For the
seeded demo, sign in as either demo account using the local demo password above.
Local HTTP development uses non-secure cookies; set `COOKIE_SECURE=true` when
serving the app over HTTPS.

Authentication requests are available under `/api/v1/auth`: signup, login,
refresh, logout, current user, profile/role updates, notification settings,
and SIWE wallet linking/login. Socket.IO authenticates with the HTTP-only
access cookie and authorizes project-room membership against the client or
accepted freelancer relationship. The frontend refreshes an expired session
before retrying a rejected realtime handshake; API requests share a single
in-flight refresh to avoid rotating the same refresh cookie concurrently.
Project messages and related notifications are pushed to authorized clients.
The API verifies on-chain escrow funding,
work-submission, revision, and release receipts against the configured
contract, sender, escrow ID, canonical block, and confirmation threshold.
On-chain dispute resolution requires a linked arbiter wallet, the same wallet
configured as `ARBITER_WALLET_ADDRESS`, and its `ARBITER_ROLE` on the deployed
contract. The arbiter signs the resolution transaction in their browser wallet;
the server does not custody the arbiter private key.
The chain reconciler only rechecks known transactions; a durable event index
with complete reorganization rollback still needs to be added. Contract
deployment, live RPC/database validation, and production security review are
not included in the local prototype.

### Enabling real escrow payments

Real funding or payment release requires a deployed escrow contract and
payment-token contract on the same network as the configured RPC endpoint. Set
these backend environment variables to real values for that network:

- `CHAIN_RPC_URL`: HTTP(S) RPC endpoint.
- `CHAIN_ID`: numeric network ID; for Sepolia, `11155111`.
- `ESCROW_CONTRACT_ADDRESS`: deployed Freelancia-compatible escrow contract.
- `PAYMENT_TOKEN_ADDRESS`: deployed payment token supported by that escrow.
- `PAYMENT_TOKEN_DECIMALS`: token precision (defaults to `6`).
- `CHAIN_CONFIRMATIONS`: confirmations required before the API records a
  transaction (defaults to `3`).

The client must link and connect the same wallet in the browser, switch it to
the configured network when prompted, hire a freelancer, and confirm escrow
funding on-chain before work can be submitted or payment released. The
freelancer must also link a wallet on that network. Before release, the client
must review the submission; the client wallet signs the release transaction.
Never place wallet private keys or seed phrases in the frontend or repository.
Local default configuration leaves chain settings blank, so real payment
actions remain unavailable until a valid deployment and RPC are configured.
Seeded budget figures and preview controls never create a chain transaction.

## Checks

Run `npm run lint`, `npm run typecheck` (frontend only), and `npm run build`
in `frontend/`; run `npm run lint`, `npm test`, and `npm run build` in `backend/`.
GitHub Actions runs these checks on pushes and pull requests.

The backend test suite includes project publishing input validation. To verify a
new project against the running local database, sign in with the client demo
account, publish a valid project from the four-step project form, then confirm
it appears in the client dashboard. Use a distinct test title and cancel or
remove the test project afterward. The form and API enforce a 5–120 character
title, 20–10,000 character description, positive PYUSD amount with up to six
decimal places, a future deadline (the form supplies one if omitted), a
1–365-day duration, and at least one project requirement.

## Security note

The Compose credentials and `.env.example` values are local development
placeholders only. Do not use them for deployment or real funds. The
`ARBITER_PRIVATE_KEY` must remain outside source control and is intended only
for Sepolia testnet use in a later implementation stage.
