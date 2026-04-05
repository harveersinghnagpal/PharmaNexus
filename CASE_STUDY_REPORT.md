# PharmaNexus Case Study Report

## Omnichannel Pharmacy Chain Mobile Web Platform

## 1. Executive Summary

PharmaNexus was designed as an enterprise-ready pharmacy operations platform for a distributed retail chain operating across urban and semi-urban branches. The core idea behind the solution was to build a mobile-friendly web application that allows store teams and administrative stakeholders to work from a single operational system while still respecting the realities of pharmacy retail: prescription-sensitive workflows, batch and expiry control, branch-level inventory pressure, role-based access, intermittent connectivity, and the need for clear auditability.

The implementation that exists today follows a service-oriented architecture inside a Python and PostgreSQL stack. The backend is built with FastAPI and organized into domain routes, services, models, events, and shared core modules. The frontend is built with Next.js and TypeScript and focuses on responsive operations workflows for dashboards, billing, inventory, prescriptions, analytics, audit, and AI-driven insights.

Although the current implementation is still deployed as a modular monolith rather than fully separated microservices, the internal design was intentionally structured to support future decomposition. Each business area was developed as a domain service with clear API boundaries, domain events, and role-aware workflow design so that it can later be extracted into an independent service with minimal redesign.

## 2. Problem Context and Design Intent

The target environment for this platform is a national pharmacy chain with multiple branches, multiple operational roles, compliance-sensitive products, and mixed connectivity conditions. This creates several design pressures:

- branch staff need fast, low-friction mobile workflows for sales, prescription intake, and stock handling
- managers need branch-specific visibility into stock risk, performance, and replenishment
- regional and central administrators need broader reporting and cross-store coordination
- the system must keep role access strict so users only see what they are genuinely allowed to act on
- business operations must continue even when a branch temporarily loses internet connectivity
- the system must retain a clear audit trail for sensitive events such as prescription handling, billing, approvals, and AI-assisted decisions

These pressures shaped the overall implementation approach. Instead of treating the application as a generic admin dashboard, the platform was built around pharmacy-specific domain services and role-aware operational surfaces.

## 3. High-Level Architecture

The solution is divided into three layers:

1. UI layer
2. service/API layer
3. data layer

### 3.1 UI Layer

The UI is implemented in Next.js with client-side authenticated pages for:

- Dashboard
- Inventory
- Billing
- Analytics
- AI Insights
- Prescriptions
- Audit Trail

The frontend was designed to be mobile-compatible and role-aware. Shared shell components handle layout, navigation, unauthorized redirects, and offline status indicators. Pages use centralized capability checks so that the visible UI matches backend permissions as closely as possible.

### 3.2 Service/API Layer

The backend is implemented in FastAPI. It exposes well-defined endpoints grouped by domain:

- `auth`
- `inventory`
- `billing`
- `analytics`
- `ai`
- `audit`
- `prescriptions`
- `sync`

The backend is organized around:

- `api/routes` for HTTP contracts
- `services` for business logic
- `models` for persistence entities
- `events` for domain event publication and subscription
- `core` for shared concerns like security, config, and database access

This structure was chosen deliberately to keep the business logic modular and allow future service extraction.

### 3.3 Data Layer

PostgreSQL is used as the system of record. The schema supports:

- users and roles
- stores
- medicines
- batches
- inventory
- sales and sale items
- transfers
- prescriptions
- audit logs
- AI decision logs

This data model was selected because pharmacy workflows require traceable relationships between a sale, the exact batch used, the store location, the user who performed the action, and any linked prescription or approval history.

## 4. Architectural Thought Process

The architecture was guided by six principles:

### 4.1 Domain Separation

Even before full microservice extraction, the application needed clean separation between domains. Billing logic, inventory movement, analytics, prescriptions, AI, and audit were separated into their own routes and services so the code would remain maintainable and each business concern could evolve independently.

### 4.2 Event-Oriented Thinking

Important business actions such as sale creation, batch addition, transfer creation, prescription approval, and AI decision logging publish domain events. This pattern was chosen to reduce tight coupling and to prepare for a future broker-backed microservice environment. It also made audit logging easier because the audit service can subscribe to domain events instead of being manually duplicated in every route.

### 4.3 Compliance by Design

Because pharmacy operations include prescription-only and controlled items, compliance was treated as part of the workflow rather than as an afterthought. Billing validates prescription requirements, prescriptions support intake and approval, uploads are size and file-type constrained, and audit logs capture sensitive activity.

### 4.4 Store Scope and Role Scope

The platform distinguishes between branch-scoped and network-scoped users. This affects both backend query behavior and frontend rendering. A sales staff user should work inside a branch boundary, while a regional or super admin can view broader operational data.

### 4.5 Offline Tolerance

Branches may experience intermittent connectivity, so critical actions like billing and inventory operations needed queue-based fallbacks. This led to the introduction of an offline queue in the frontend and a sync replay route in the backend.

### 4.6 Submission Practicality

The implementation needed to demonstrate the final solution blueprint while still being realistically buildable within the repo. For that reason, the system currently implements a strong modular monolith that behaves like a microservice-ready platform, while clearly identifying what remains for full production-grade decomposition.

## 5. Service-by-Service Explanation

## 5.1 Authentication and Access Control Service

### Purpose

The authentication layer establishes who the user is, what role they belong to, and what parts of the platform they may access.

### How it was built

The auth API handles login, logout, and current-user resolution. JWT access tokens are generated on login, and secure session continuity is supported through cookies and authenticated `me` resolution. The backend dependencies layer resolves the current user and exposes reusable role guards such as manager-only, inventory-level, or super-admin access.

On the frontend, authentication state is maintained through a shared auth context. The app rehydrates user state through a backend call rather than blindly trusting client-side role data. This reduced the risk of UI drift and allowed navigation and route protection to depend on server-validated identity.

### RBAC thought process

The RBAC design was corrected to avoid the common problem where the backend blocks an action but the frontend still shows the menu item or page. To solve this, a centralized capability model was introduced. Instead of scattering role checks everywhere, capabilities such as dashboard access, billing access, inventory access, analytics access, AI access, prescription access, and audit access were defined centrally and reused in route guards, shell navigation, and page rendering.

This gave the platform three major advantages:

- the sidebar and bottom navigation now reflect actual access
- protected pages fail early and redirect appropriately
- role-specific dashboards can be assembled from capability-aware widgets

## 5.2 Dashboard Service

### Purpose

The dashboard serves as the operational landing page for each user role.

### How it was built

The dashboard was redesigned to become role-sensitive instead of a generic page with hidden widgets. Each role now sees a more focused workspace:

- sales staff focus on billing, prescription intake, and immediate branch alerts
- inventory supervisors focus on stock pressure, expiry exposure, and transfers
- managers and admins see broader operational summaries and performance context

### Design rationale

In pharmacy environments, dashboards should reduce cognitive load rather than add it. A counter sales user does not need enterprise BI on login, and a regional administrator does not need a narrow POS-first surface. The dashboard was therefore treated as a role workspace rather than a one-size-fits-all homepage.

## 5.3 Inventory Service

### Purpose

The inventory domain manages stock visibility, batch-level control, expiry awareness, and inter-store transfer logic.

### How it was built

The inventory module includes:

- medicine listing
- batch retrieval
- low-stock and expiry views
- transfer support
- replenishment planning
- cross-store transfer recommendation logic

Inventory records were modeled separately from batch records because the system needs both:

- aggregate quantity visibility per store and medicine
- batch-level traceability for expiry, cost, and dispensing

### Thought process

Pharmacy inventory cannot be treated as simple SKU counts. Medicines are often managed by batch, expiry, and cost basis. This is why the design supports both inventory totals and batch granularity. It enables:

- expiry-sensitive operations
- accurate margin reporting
- transfer decisions based on real stock availability
- linkage between billed items and exact inventory batches

### Replenishment planning

The replenishment planner was added as a dedicated service to move the solution beyond simple alerts. The planner classifies shortages into:

- stock that can be satisfied through internal transfer
- stock that likely requires procurement

This was chosen because operationally, branches do not just need to know that stock is low. They need recommended next actions.

## 5.4 Billing Service

### Purpose

The billing service supports OTC and prescription-linked sales while enforcing inventory deduction and compliance checks.

### How it was built

Billing creates a sale header and sale item records, validates stock, deducts batch quantities, updates aggregate inventory totals, and optionally links a prescription. The billing route also publishes sale-created events so audit logging and downstream tracking remain decoupled from the transactional logic.

The billing UI was built as a POS-like experience:

- branch store selection
- medicine search
- batch selection
- cart management
- invoice generation
- recent transactions

### Compliance thought process

Billing was not treated as a pure checkout engine. A pharmacy sale must respect prescription requirements, so compliance validation is executed before the transaction is finalized. This design ensures that restricted medicines cannot be dispensed without the correct prescription context.

### Print and invoice thought process

Invoice generation was improved so the user gets both:

- an on-screen billing summary
- a dedicated printable invoice document

This was necessary because the initial modal-based print behavior produced vague output. The print flow was redesigned to produce a proper receipt layout including store identity, cashier, timestamp, line items, totals, payment mode, and prescription reference.

## 5.5 Prescription Service

### Purpose

The prescription service handles prescription intake, review, approval, rejection, document upload, and linkage to dispensing.

### How it was built

Prescription records include patient data, doctor details, prescription dates, validity windows, workflow status, review metadata, and optional document storage. The route layer supports:

- creation by authenticated staff
- list and detail retrieval
- approval by elevated roles
- rejection with reason
- document upload

### Thought process

Prescription workflows are sensitive because they combine compliance, patient-linked data, and pharmacy operations. The system therefore needed:

- status-based progression
- store-scoped access control
- auditability around creation, approval, rejection, and document handling
- upload restrictions on file type and size

This service was designed to support both operational intake and compliance review while keeping the route logic understandable.

## 5.6 Analytics and BI Service

### Purpose

The analytics module provides business intelligence for sales, orders, product performance, branch benchmarking, margin, expiry loss, and compliance-sensitive categories.

### How it was built

The analytics API exposes multiple focused endpoints rather than one monolithic reporting payload. These include:

- KPI summary
- sales trend
- top products
- margin tracking
- expiry loss
- store performance
- category insights

The frontend analytics workspace combines these into a BI dashboard with cards and charts.

### Thought process

The analytics layer was designed around operational questions:

- how is revenue moving over time
- which products are performing best
- what categories generate the highest margin
- which branches are under stock pressure
- how much value is being lost to expiry
- how much revenue is tied to compliance-sensitive product categories

### Seed and time-window handling

Analytics required special treatment because demo or seeded environments often contain historical sales data rather than same-day activity. To prevent blank dashboards, the reporting layer was adjusted to anchor time windows to the latest available sale date instead of assuming fresh live data.

### Resilience thought process

The analytics page was hardened to avoid failing completely when a single endpoint has a problem. Partial rendering is important in BI systems because it is better to show available insight than to blank the entire workspace due to one failing section.

## 5.7 AI Insights Service

### Purpose

The AI module demonstrates agentic features aligned to pharmacy operations:

- demand forecasting
- anomaly detection
- conversational analytics

### How it was built

The AI routes and supporting data logs provide structured AI output for specific operational use cases. Forecasting uses historical signals, anomaly detection flags unusual behavior, and the conversational layer enables natural-language operational queries.

### Thought process

The AI module was designed to solve operational questions rather than exist as a generic chatbot. In a pharmacy chain, useful AI should answer questions such as:

- what is likely to go out of stock soon
- which medicine demand is increasing
- where billing usage looks abnormal
- how a manager can query branch performance without navigating complex reports

AI decisions were also tied into audit logging so that AI-assisted outputs are not invisible from a governance perspective.

## 5.8 Audit Service

### Purpose

The audit service creates traceability for sensitive business events and user actions.

### How it was built

An audit log model was introduced to capture:

- entity type and ID
- action type
- responsible user
- store context
- old and new values
- human-readable description
- request correlation ID
- IP address where available

The audit service listens to domain events and writes audit records asynchronously. Additional direct logging was added for events such as logout, prescription rejection, and document upload.

### Thought process

Auditability was treated as a system concern rather than a UI feature. Instead of manually sprinkling log writes across unrelated routes, the event-subscriber approach keeps audit capture consistent and prepares the architecture for distributed deployment later.

This service is especially important in regulated retail because it supports forensic review, accountability, operational debugging, and governance.

## 5.9 Offline Sync Service

### Purpose

The sync service supports branch operations during network interruptions.

### How it was built

The frontend uses an offline queue to store pending actions locally. When the application regains connectivity, queued events are replayed to the backend sync route. The sync result reports applied, duplicate, conflict, and failed event counts.

Current offline-safe flows include:

- sale creation
- batch addition
- transfer creation

### Thought process

Offline capability is not simply about caching pages. In retail operations, the system must preserve intent and replay actual transactions safely. This is why the design uses queued domain-like events instead of just storing raw screen state.

The sync feedback model was also designed to help users understand what happened to queued actions rather than silently replaying them in the background.

## 5.10 Replenishment and Transfer Recommendation Service

### Purpose

This service helps reduce wastage and stock-outs by recommending how inventory should move across the branch network.

### How it was built

Two supporting services shape this area:

- transfer recommendation logic
- replenishment planning logic

These services inspect stock levels, low-stock thresholds, and branch conditions to suggest:

- where an internal transfer is practical
- where procurement is more appropriate

### Thought process

The requirement was not just to display low stock alerts, but to support operational decision-making. The planner therefore bridges the gap between alerting and action. This is particularly useful in chains where one branch may be overstocked while another is nearing stock-out.

## 6. Frontend Design and Mobile-First Workflow Strategy

The frontend was built to support branch staff working on smaller screens, tablets, and handheld operational devices. This affected several design decisions:

- navigation was centralized and role-filtered
- a shell provider manages shared structure consistently
- duplicate layout rendering was removed to fix broken dashboard behavior
- pages were reoriented toward operational tasks instead of generic admin views
- offline state is visible through banners and sync feedback
- print flows were improved for practical branch use

The mobile-first goal was not merely responsive resizing. It was to make core workflows short, understandable, and role-correct under real store conditions.

## 7. Security and Compliance Controls

Security and compliance were built in layers.

### 7.1 Authentication and session controls

- JWT-based authentication
- cookie support for authenticated sessions
- backend current-user validation
- role guard dependencies

### 7.2 Authorization

- centralized capability mapping on the frontend
- backend role dependencies for enforcement
- store-scoped filtering for branch users
- unauthorized route handling

### 7.3 Compliance-aware operations

- prescription validation before restricted sales
- prescription approval workflow
- upload restrictions for prescription documents
- explicit branch/store scoping for sensitive prescription data

### 7.4 Auditability

- event-driven audit records
- request correlation IDs
- logout and prescription action logging
- AI decision audit support

### 7.5 Privacy and regulated-data handling

The solution already introduces stronger foundations for protecting sensitive workflows, but full production-grade privacy controls such as retention policy enforcement, field masking, and advanced access review are still part of future scope.

## 8. Observability and Operational Controls

Observability was strengthened with:

- request IDs
- request timing headers
- structured logging setup
- health endpoint
- liveness endpoint
- readiness endpoint
- basic metrics endpoint

The reasoning here was to make the application easier to operate in a production-like environment. Even before a full observability stack is introduced, engineers and reviewers should be able to inspect uptime, request behavior, database readiness, and coarse request metrics.

## 9. Data Model Rationale

The data model supports traceable pharmacy operations.

### Core entities

- `User`: identity, role, branch association
- `Store`: branch identity and region
- `Medicine`: product master and compliance flags
- `Batch`: batch number, expiry date, cost, quantity, store
- `Inventory`: aggregated stock total by store and medicine
- `Sale`: billing transaction header
- `SaleItem`: billed medicine lines tied to exact batches
- `Transfer`: cross-store movement
- `Prescription`: intake, approval, and linkage record
- `AuditLog`: compliance and forensic trace
- `AIDecisionLog`: AI governance support

### Why both `Inventory` and `Batch`

This is a key design choice. Aggregate inventory is useful for quick operational visibility and alerts, but batch detail is essential for pharmacy compliance and expiry-aware dispensing. The system therefore keeps both models and synchronizes them through stock operations.

## 10. Core Workflows Implemented

### 10.1 User Login and Role Landing

The user signs in, the backend resolves identity, the frontend revalidates current user state, and the UI shell renders only the pages and actions appropriate to that role.

### 10.2 Billing Workflow

The user selects store scope, searches medicines, chooses a valid batch, builds a cart, and creates a sale. The backend validates compliance, checks stock, deducts batch quantities, updates aggregate inventory, and returns invoice data for receipt generation and printing.

### 10.3 Prescription Intake and Review

Any authorized staff member can intake a prescription. Elevated roles can review, approve, or reject it. Uploaded prescription documents are validated and tied to the workflow record. Approved prescriptions can later support compliant dispensing.

### 10.4 Inventory Monitoring

Store teams and managers can view stock position, low-stock exposure, expiry risk, and available batch detail. Transfers and replenishment planning support operational decision-making beyond passive reporting.

### 10.5 Replenishment and Transfers

The planner analyzes stock pressure and suggests where transfers can solve shortages and where procurement is needed instead.

### 10.6 Analytics Consumption

Managers and admins use BI dashboards to monitor revenue, orders, fast-moving products, category performance, margin, expiry loss, and branch comparison.

### 10.7 Offline Branch Operations

If connectivity is unavailable, critical actions can be queued locally and replayed later. The system reports replay outcome instead of failing silently.

## 11. Why the Current Solution Is Microservice-Ready

The project brief expects a microservices-based solution. The current codebase is best described as a microservice-ready modular monolith. This was a deliberate implementation strategy.

### Already aligned with microservice extraction

- domain-specific route modules
- service-layer business logic
- shared data contracts
- domain event publication
- cross-cutting audit subscription
- clearly separated frontend modules by business area

### Likely future extraction plan

The following services can be extracted with limited redesign:

- Auth Service
- Inventory Service
- Billing Service
- Prescription Service
- Analytics Service
- AI Service
- Audit Service
- Sync/Offline Reconciliation Service

This staged strategy is often more practical than prematurely splitting services before the domain boundaries are stable.

## 12. Non-Functional Requirement Coverage

### Performance

- async FastAPI backend
- targeted endpoints instead of oversized payloads
- separate analytics queries by use case

### Scalability

- modular backend domains
- event-based decoupling
- service extraction path already visible

### Security

- token-based auth
- role guards
- store scoping
- cookie support
- audit logging

### Reliability

- health/readiness endpoints
- offline queueing
- sync replay feedback
- seeded startup backfill for demo consistency

### Observability

- request IDs
- response time headers
- logs
- metrics endpoint

### Auditability

- domain-event audit strategy
- direct audit of critical edge actions

## 13. Remaining Gaps

To present the case study honestly, the following items should still be described as future work:

- full deployment as independent microservices
- broker-backed event streaming
- refresh-token lifecycle and MFA
- richer conflict handling for all offline scenarios
- full production observability stack with dashboards and alerts
- stronger AI governance and model monitoring
- data retention, masking, and advanced privacy controls
- broader automated testing and performance/security test coverage

These are platform-hardening and production-maturity gaps rather than proof-of-concept gaps. The core business system is already substantively implemented.

## 14. Conclusion

PharmaNexus was implemented as an omnichannel pharmacy operations platform that combines role-aware workflows, branch-scoped operations, inventory intelligence, compliance-aware billing, prescription handling, BI analytics, offline resilience, and auditable AI-assisted capabilities in one coherent system.

The most important architectural decision was to build the platform as a modular, service-oriented Python application that already behaves like a microservice system internally while remaining practical to implement and iterate within a single repository. This allowed rapid delivery of core business value without sacrificing future scalability.

From a case study perspective, the project demonstrates:

- domain-driven service thinking
- careful RBAC and workflow design
- pharmacy-specific inventory and compliance logic
- realistic handling of low-connectivity branches
- BI and AI capabilities tied to concrete business use cases
- growing maturity in observability, auditability, and secure operations

This makes the current implementation a strong solution blueprint as well as a working foundation for a production-grade pharmacy chain platform.
