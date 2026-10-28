# Freelancia: Concepts and Software Guide

This project is a freelance marketplace prototype with escrow protection, collaborative project work, blockchain-based payment checks, AI review hooks, and a real-time communication layer. It combines a React frontend, an Express/TypeScript backend, PostgreSQL data storage, Redis-based work queues, object storage for uploaded files, and Ethereum-compatible smart contracts for escrow logic.

---

## 1) What this project does

Freelancia is designed around a simple workflow:

1. A client posts a job/project.
2. Freelancers submit proposals.
3. The client shortlists or accepts a freelancer.
4. The client funds an escrow.
5. The freelancer completes work and submits it.
6. The client reviews it.
7. Payment is released or a dispute is raised.
8. AI checks can review work before final approval.

The app is not just a job board. It is more like a mini marketplace + workflow system + payment and dispute management app.

---

## 2) Main system architecture

The system has four main layers:

### Frontend
- React + Vite + TypeScript
- Runs in the browser
- Lets users sign in, view projects, create proposals, manage dashboards, and interact in real time

### Backend API
- Node.js + TypeScript + Express
- Handles authentication, projects, proposals, escrow logic, notifications, submissions, and API endpoints
- Validates requests and connects to the database

### Database layer
- PostgreSQL as the source of truth
- Prisma ORM maps TypeScript models to database tables
- Stores users, wallets, projects, messages, transactions, disputes, and escrow records

### External services
- Redis for background jobs and queueing
- RustFS / MinIO-compatible storage for file uploads
- Ethereum RPC + smart contracts for escrow/payment verification
- Anthropic AI API for optional advisory review of submissions

---

## 3) Important concepts in the app

### 3.1 Escrow
An escrow is a trusted holding mechanism. Money is not sent directly to the freelancer at the start. Instead, the client locks funds in a smart contract or a tracked escrow record until the work is accepted.

In this project:
- The client funds an escrow for a project.
- The freelancer completes work.
- The client releases the funds or requests a revision.
- If there is a dispute, an arbiter or contract logic decides the result.

This reduces fraud for both sides.

### 3.2 Freelancer and client roles
The app is built around two main user types:
- Client: posts jobs, funds escrow, reviews work
- Freelancer: applies to jobs, delivers work, may receive payment

Users can have multiple roles in theory, but the app uses a primary active role, plus wallet-linked identity and project-specific permissions.

### 3.3 Project lifecycle
A typical project goes through stages like:
- OPEN
- IN_PROGRESS
- AWAITING_REVIEW
- COMPLETED
- DISPUTED
- CANCELLED

This helps the backend and UI track the progress of work in a structured way.

### 3.4 Proposal system
A freelancer can send a proposal for a project. The proposal includes:
- price
- delivery time
- message to the client

The client can shortlist or accept a proposal. This is similar to a hiring process built directly into the marketplace.

### 3.5 Submission and revision flow
After a freelancer delivers work:
- Work is submitted to the platform
- The client can request revisions
- The freelancer can resubmit after revisions
- The final payment is released only when the work meets requirements

### 3.6 Disputes and arbitration
If there is disagreement about the outcome, a dispute can be opened. In this project, there is a concept of:
- client vs freelancer conflict
- evidence attached to a dispute
- arbiter wallet and on-chain dispute resolution

This makes the system closer to a real marketplace dispute workflow.

### 3.7 Real-time collaboration
The backend uses Socket.IO so messages, notifications, and project updates can be pushed to authorized clients in real time.

This is important for:
- project messaging
- live update of dashboards
- push notifications without page refreshes

### 3.8 Wallet-based authentication (SIWE)
SIWE stands for Sign-In with Ethereum.

Instead of only username/password login, the app supports wallet-based login using a browser wallet such as MetaMask-like wallet software. The user signs a message proving wallet ownership; then the app verifies the signature server-side. This is a common Web3 login flow.

### 3.9 JWT and refresh-token auth
The backend uses JSON Web Tokens for access and refresh flows.

- Access token: short lived, used for API access
- Refresh token: longer lived, used to reissue access tokens
- Cookies are used to keep the session secure and convenient in browser apps

This is standard web auth for SPA + API setups.

### 3.10 S3-compatible object storage
The app stores files such as project submissions in object storage instead of a local disk. This is useful because object storage is:
- scalable
- cheap for file uploads
- easy to integrate with CDN-like access patterns

In this project, RustFS is used as a MinIO-compatible S3 service.

### 3.11 AI verification (advisory only)
A separate verification worker can analyze a submission using an AI model from Anthropic. It checks if the work satisfies the project requirements and gives a review.

Important: the AI result is advisory only. It does not automatically authorize payment. The app still requires human review and contract/system rules to release funds.

### 3.12 On-chain verification
The backend checks transaction receipts against the configured blockchain contract, sender wallet, escrow ID, canonical block, and confirmation threshold.

This means the app does not blindly trust the database. It verifies blockchain events and receipts before treating a payment action as valid.

---

## 4) Software used in this project

## 4.1 Core programming software

### Node.js
Node.js is the JavaScript runtime used by the backend and tooling. It allows TypeScript, Express, Redis, Prisma, and queue workers to run together in one ecosystem.

Why it matters here:
- Most backend logic is in TypeScript
- Worker processes and API run on Node.js
- Build, tests, and development tasks are Node-based

### TypeScript
TypeScript adds static typing to JavaScript.

Benefits in this repo:
- Safer API and contract code
- Better editor support
- Easier refactoring
- Fewer runtime surprises

---

## 4.2 Frontend software

### React
React is the UI library used to build the user interface.

It lets the app:
- render components
- manage state
- react to user actions
- update parts of the page without full reloads

### Vite
Vite is the frontend build tool and dev server.

It provides:
- fast development hot reloading
- optimized production builds
- TypeScript support

### React Router
Used to navigate between pages and views such as sign-in, dashboards, project listings, and detail pages.

### TanStack React Query
React Query is used for data fetching and cache management.

It helps with:
- loading and caching server data
- refreshing data when needed
- keeping UI synchronized with backend state

### Socket.IO Client
The browser app connects to the backend realtime service using Socket.IO so messages and notifications can appear instantly.

### Tailwind CSS
Tailwind is used for styling the user interface through utility classes.

This is useful for:
- rapid UI development
- consistent design patterns
- easier layout composition

### Lucide React
Lucide provides icons used in the frontend UI.

---

## 4.3 Backend software

### Express
Express is the web server framework used for API routes and middleware.

It is responsible for:
- HTTP routing
- request validation
- authentication checks
- error handling
- serving backend endpoints

### Prisma
Prisma is the ORM and database toolkit used to interact with PostgreSQL.

It provides:
- type-safe database access
- schema-first database modeling
- migrations
- query generation and validation

This repo uses it heavily for users, projects, proposals, messages, and escrow data.

### PostgreSQL
PostgreSQL is the relational database engine used as the main source of truth.

It stores:
- users and profiles
- wallet data
- projects and proposals
- messages
- notifications
- transactions
- disputes and evidence
- activity logs

### Redis
Redis is used as an in-memory data store and queue system.

In this project, it supports:
- background job scheduling
- queued AI verification tasks
- realtime coordination with workers

### BullMQ
BullMQ is a queue system built for Node.js and Redis.

It enables background processing such as:
- verification jobs
- asynchronous tasks
- retryable work

### Zod
Zod is used for schema validation.

It ensures input conforms to expected types before it is processed, helping protect APIs from malformed requests.

### JWT / Jose
The project uses JWT and the Jose library for secure token creation and verification.

This is used for:
- access tokens
- refresh tokens
- signing and verifying login/session data

### Argon2
Argon2 is a password hashing library.

It is used to securely hash user passwords rather than storing plain text passwords.

### Helmet
Helmet adds HTTP security headers to the Express API to improve app security.

### CORS
CORS allows the frontend (typically at localhost:5173) to talk to the backend API safely during development and expected deployments.

### Cookie Parser
This middleware parses browser cookies so the backend can read access or refresh session cookies.

### Express Rate Limit
This protects routes from brute-force or spammy requests by limiting how often a client can hit the API.

### Pino
Pino is the logger used in the backend.

It logs operational events with structured output, which helps debugging and monitoring.

### Socket.IO
Socket.IO is the real-time communication layer used for live collaboration and push events.

---

## 4.4 Data storage and infrastructure software

### Docker Compose
Docker Compose is used to orchestrate the local environment.

It starts:
- the API service
- the verification worker
- PostgreSQL
- Redis
- RustFS (object storage)

This gives the project a reproducible development environment.

### PostgreSQL 16
This is the version used in the dev stack.

It powers the app’s relational data model and migrations.

### Redis 7
Redis 7 is the queue and cache service used for async jobs and in-memory coordination.

### RustFS
RustFS is the object storage layer used as an S3-compatible storage server.

It is used for storing uploaded project files and other binary assets.

### MinIO compatibility
This project uses a MinIO-like S3 pattern, which means the storage system is compatible with standard S3 APIs.

That is useful because common SDKs and tools can interact with it in a standard way.

---

## 4.5 Blockchain and smart contract software

### Solidity
Solidity is the smart contract language used to write the escrow logic.

The escrow contract manages:
- funded state
- work submission
- revision request
- dispute
- release of funds
- refund logic

### Hardhat
Hardhat is the Ethereum development environment used to compile, test, and deploy smart contracts.

This project uses it in the contracts folder.

### OpenZeppelin Contracts
OpenZeppelin provides secure, audited building blocks like:
- AccessControl
- ReentrancyGuard
- Pausable
- SafeERC20

This reduces common smart-contract risks.

### Ethers
Ethers is the JavaScript library used to interact with Ethereum-compatible networks from the backend and tooling.

It is used to:
- validate on-chain transactions
- query contract state
- work with wallet addresses and RPC endpoints

### ERC20 token support
The escrow contract is designed around an ERC20 token, such as a stablecoin (for example PYUSD). The contract uses SafeERC20 transfers to move funds.

---

## 4.6 AI verification software

### Anthropic API
The backend can call Anthropic's AI model for review tasks. The AI worker checks project submissions against requirements and returns an advisory verdict.

This is not a payment authority; it is a recommendation system.

### Verification worker
A separate Node.js process runs as a worker and processes verification tasks in the background. This keeps heavy AI analysis out of the main HTTP request flow.

---

## 4.7 Development and quality tooling

### ESLint
ESLint enforces code quality and consistency across the frontend and backend.

### TypeScript compiler
The TypeScript compiler checks types and does build validation.

### npm
npm is the package manager used to install dependencies and run scripts for all project areas.

### Prisma CLI
The Prisma CLI is used for:
- generating Prisma client
- deploying migrations
- checking database connectivity
- seeding demo data

### Git
Git is used for source control and version management.

---

## 5) Why these technologies fit this app

This project is a full-stack, semi-web3 application. That means it needs:
- a fast modern frontend
- a secure backend API
- a relational database
- real-time communication
- async workers
- file storage
- blockchain/payment verification
- AI insight loops

The chosen stack is a good fit because each tool solves a specific problem:

- React/Vite: user-facing app experience
- Express/Node: API and backend logic
- PostgreSQL + Prisma: durable data model
- Redis + BullMQ: async job processing
- Socket.IO: live updates
- RustFS/MinIO: file uploads
- Solidity + Hardhat + OpenZeppelin: smart contract safety and escrow logic
- Ethers: blockchain integration
- Anthropic: AI review automation
- Docker Compose: easy local orchestration

---

## 6) Core design patterns in this project

### Stateless API + persistent database
The API itself is stateless; the important state lives in PostgreSQL and the blockchain contract.

### Event-driven background processing
Many actions trigger queued work. For example, a submission may require AI review or database-level processing after a user event.

### Trust boundary between app and blockchain
The app validates blockchain receipts before trusting payment data. This is important in Web3-integrated systems.

### Role-based access
Users are restricted by role and by project participation. The app enforces who can create projects, submit proposals, accept work, and resolve disputes.

### Advisory AI, not autonomous authority
The AI system helps with analysis, but all critical actions still depend on the app logic, user actions, and contract conditions.

---

## 7) Summary

Freelancia is a full-stack freelance marketplace prototype that deliberately mixes modern web development with blockchain concepts. It uses a clean three-part architecture:

- UI layer: React + Vite + TypeScript
- API layer: Express + Node.js + Prisma + Socket.IO
- Trust layer: PostgreSQL + Redis + S3 + blockchain smart contracts

It demonstrates several modern software engineering concepts at once:
- user authentication
- secure APIs
- relational modeling
- realtime collaboration
- background jobs
- external storage
- blockchain-backed escrow payments
- AI-assisted verification
- dispute workflows

This is a strong example of a real-world product architecture that blends traditional backend systems with decentralized trust mechanisms.

---

## 8) Quick technology checklist

Frontend:
- React
- Vite
- TypeScript
- React Router
- React Query
- Tailwind CSS
- Socket.IO client
- Lucide icons

Backend:
- Node.js
- TypeScript
- Express
- Prisma
- PostgreSQL
- Redis
- BullMQ
- Socket.IO
- JWT/Jose
- Argon2
- Zod
- Helmet
- CORS
- Pino

Blockchain:
- Solidity
- Hardhat
- OpenZeppelin
- Ethers
- ERC20 stablecoin model

Infrastructure:
- Docker Compose
- PostgreSQL 16
- Redis 7
- RustFS / MinIO-compatible S3

AI / tooling:
- Anthropic API
- ESLint
- TypeScript compiler
- npm
- Prisma CLI

