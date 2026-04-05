# PharmaNexus

PharmaNexus is an omnichannel pharmacy chain operations platform built for multi-branch retail pharmacy and wellness stores. It combines role-based operations, billing, batch-aware inventory, prescriptions, analytics, auditability, offline-safe workflows, and AI-assisted insights in a Python + PostgreSQL + Next.js stack.

## What It Covers

- Secure login with role-based access for super admin, regional admin, store manager, inventory supervisor, and sales staff
- Role-correct dashboards and navigation
- OTC and prescription-aware billing
- Batch, expiry, and low-stock-aware inventory operations
- Replenishment planning and inter-store transfer recommendations
- BI dashboards for revenue, orders, margin, expiry loss, branch benchmarking, and compliance-sensitive categories
- Prescription intake, approval, rejection, and document upload
- Audit trail for critical operational events
- Offline queueing and sync support for selected branch workflows
- AI-assisted forecasting, anomaly detection, and conversational insights

## Tech Stack

### Frontend

- Next.js
- TypeScript
- React
- Recharts

### Backend

- FastAPI
- SQLAlchemy (async)
- PostgreSQL
- Pydantic
- Loguru

### Deployment / Local Runtime

- Docker
- Docker Compose

## Project Structure

```text
PharmaNexus/
├── backend/
│   ├── app/
│   │   ├── api/routes/         # Domain APIs
│   │   ├── core/               # Config, DB, security
│   │   ├── events/             # Domain event bus
│   │   ├── models/             # SQLAlchemy models
│   │   ├── schemas/            # Pydantic schemas
│   │   ├── services/           # Business services
│   │   └── utils/              # Logging and helpers
│   ├── alembic/                # Migrations
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── app/                    # Next.js routes/pages
│   ├── components/             # Shared UI shell/components
│   ├── context/                # Auth state
│   ├── hooks/                  # Offline sync and helpers
│   ├── lib/                    # RBAC, nav, queue logic
│   ├── services/               # API clients
│   └── Dockerfile
├── docker-compose.yml
├── CASE_STUDY_REPORT.md
└── README.md
```

## Core Modules

### 1. Authentication and RBAC

The platform uses backend-enforced role checks and frontend capability-based rendering. Navigation, page access, and action visibility are aligned so users only see what they are allowed to access.

### 2. Dashboard

Each role gets a more focused operational dashboard instead of a single generic admin view. Sales staff see counter workflows, inventory staff see stock pressure, and managers/admins see broader branch/network context.

### 3. Inventory

Inventory is modeled with both aggregate stock and batch-level detail. This supports expiry-aware operations, low-stock monitoring, cost tracking, transfer decisions, and realistic pharmacy retail workflows.

### 4. Billing

Billing supports OTC and prescription-linked sales, stock deduction, and invoice generation. Recent improvements include a clearer invoice modal and a dedicated printable receipt document.

### 5. Prescriptions

Prescription workflows include intake, approval, rejection, upload, and store-scoped access control. Sensitive actions are also audited.

### 6. Analytics

The analytics workspace includes KPIs, revenue trend, branch performance, margin, expiry loss, top products, and compliance-sensitive category insights. The reporting layer was adjusted to work reliably with seeded historical data.

### 7. AI Insights

The AI module demonstrates forecasting, anomaly detection, and conversational operational querying tied to pharmacy use cases.

### 8. Audit and Observability

The backend includes audit logging, request IDs, health/readiness endpoints, and a metrics endpoint to improve operational traceability.

### 9. Offline Sync

Selected branch actions can be queued locally and replayed later through sync endpoints, helping the app tolerate intermittent branch connectivity.

## Running Locally

### With Docker Compose

```bash
docker compose up --build
```

Services:

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`
- PostgreSQL: `localhost:5432`

## Demo Accounts

The development seed creates demo users for each role. The current demo password is:

```text
PharmaNexus@2026!
```

Example accounts:

- `admin@pharmanexus.com`
- `regional@pharmanexus.com`
- `manager@pharmanexus.com`
- `inventory@pharmanexus.com`
- `sales@pharmanexus.com`

## Important Notes Before Pushing

- Root `.gitignore` and `.dockerignore` have been added for the entire workspace.
- Local secrets, uploads, logs, virtual environments, and build artifacts are ignored.
- A nested `frontend/.git` directory exists from an earlier initialization and is ignored at the root level.

## Current Status

The project is a strong modular monolith with microservice-ready domain separation. Major business workflows are implemented, but full production-grade decomposition into independently deployable microservices, stronger auth hardening, broader automated testing, and deeper observability are still future work.

For a descriptive solution write-up, see [CASE_STUDY_REPORT.md](./CASE_STUDY_REPORT.md).
