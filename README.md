# TokTickIT

TokTickIT is an IT service desk application being built through the CPE334 individual sprint workflow.

## Current branch scope

This branch contains the Issue 1 foundation, Issue 2 API health check, Issue 3 category seed, and Issue 4 category list:
* React + TypeScript + Vite frontend with Bootstrap styling
* Node.js + Express + TypeScript backend
* PostgreSQL database
* Prisma schema and generated-client configuration
* Vitest and Supertest test commands
* Environment and repository safety templates
* GET `/api/health` with a Supertest verification
* React health status, loading state, and backend-unavailable error state
* Prisma Category model, migration, and idempotent seed for four IT request categories
* GET `/api/categories` backed by Prisma with predictable ID ordering
* React category list loaded from the API with loading and error states

No later application features are implemented on this branch.

## Prerequisites

* Node.js (v18 or higher)
* npm
* PostgreSQL running locally (or via Docker)

## Setup
From the repository root, set up your environment variables:
```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

## Setup Backend
```bash
cd server
npm install
npx prisma generate
npx prisma migrate dev --name init
npx prisma db seed
```

# Setup Frontend
```bash
cd ../client
npm install
```

The local database is PostgreSQL at localhost:5432. The migration creates the Category table and the seed creates Account and Access, Hardware, Software, and Network without duplicates when rerun. The client reads VITE_API_BASE_URL from client/.env; its development value is http://localhost:3000. The database credentials are development-only values from .env.example; never commit either .env file or any real credentials.

## Run the foundation and health check
Backend:
```bash
cd server
npm run dev
```

Frontend:
```bash
cd client
npm run dev
```

Open the Vite URL shown in the client terminal. The page should show the TokTickIT heading, a Bootstrap-styled foundation card, the live backend API status, and the seeded IT request categories.

## Test
Backend Tests (Supertest):
```bash
cd server
npm test
```

Frontend Tests (Vitest):
```bash
cd client
npm test
```