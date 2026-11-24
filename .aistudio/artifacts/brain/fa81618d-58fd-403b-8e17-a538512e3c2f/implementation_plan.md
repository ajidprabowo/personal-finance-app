# Personal Finance App — Stage 1 Foundation & Local Database Architecture

**Personal Finance App** (temporary configurable project label) is a local-first personal finance web application storing all user financial data strictly inside the browser via IndexedDB. Stage 1 establishes the layered Next.js application architecture, a versioned 14-table Dexie.js database with migration support, an installation-scoped identity, validated JSON backup/restore utilities, and a neutral, functional internal verification console for testing database health, persistence, and CRUD safety.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> This revised Stage 1 plan incorporates all architectural and scope boundaries while deferring final visual design and product navigation to Stage 2:

- **Configurable Project Identity**: Uses **Personal Finance App** as a temporary project label backed by a centralized configuration constant so the final brand name can be updated cleanly later.
- **Neutral Stage 1 Console (Design Deferred to Stage 2)**: Uses a clean, neutral, functional interface strictly for Stage 1 verification. Neither Light Mode nor Dark Mode is locked as the final default, and the final design system will be implemented in Stage 2.
- **Verification Sidebar vs. Stage 2 App Navigation**: The Stage 1 sidebar serves solely as an internal development and database verification console. Final product navigation (1. Transaction, 2. Investment, 3. Dashboard, 4. Analytics, 5. Budget in a bottom navigation bar, plus Profile & Settings via the header profile section) is reserved for Stage 2.
- **Default Base Currency**: **IDR (Indonesian Rupiah)** is initialized as the default base currency in local `preferences`, with `id-ID` formatting utilities ready for future modules.

---

## 1. Overview & Core Concept

- **What It Does**: Initializes a persistent local IndexedDB vault on first launch, generates a stable `installationId` that survives browser refreshes, and exposes typed repositories, services, and database utilities supporting future modules (Transactions, Investment, Dashboard, Analytics, Budget, Profile & Settings, and server-side Gmail OAuth).
- **Target Audience / Persona**: Privacy-conscious individuals managing personal cashflow, budgets, and investments locally in IDR without cloud databases, sync services, or mandatory user logins.
- **Key Value**: Establishes structural data integrity, safe schema migrations, isolated CRUD verification safety, and portable JSON backups before any module UI or business logic is built.

---

## 2. User Experience & Functional Shell (Stage 1 Scope)

- **Key User Flows**:
  1. **Startup & Vault Initialization**: On opening the app, a deterministic startup sequence opens IndexedDB via Dexie.js, executes any pending versioned migrations, ensures a single `appInstallation` record (with a persistent UUID) and default IDR `preferences` exist, and enters the verification console. If IndexedDB initialization fails, a clear error state offers diagnostics and recovery actions.
  2. **Internal Verification Console Navigation**: A simple, responsive sidebar navigates strictly between Stage 1 verification surfaces (`Overview & Health`, `CRUD Verification`, `Backup & Restore`, and `Schema & Migrations`) along with minimal placeholder views noting Stage 2 module deferrals.
  3. **Safe CRUD Verification Workbench**: Developers and users can create, read, update, and delete verification records via the repository layer. All records created by the workbench are explicitly tagged and visually marked as **Test Data** so they never mix silently with real financial records, and `"Clear Test Data"` removes *only* workbench test records after explicit confirmation.
  4. **Validated JSON Backup & Restore**: Users export a complete JSON snapshot of all 14 tables (preserving IDs and relationships), or upload a `.json` file to inspect its schema validation status and record counts, confirm before overwriting local tables, and safely reject malformed or incompatible files.

- **Stage 1 Visual Posture (Neutral & Functional)**:
  - Clean, neutral utility styling using standard Tailwind neutral slate surfaces, `1px` borders, clear tabular monospace alignment (`tabular-nums`) for IDs, counts, timestamps, and IDR values, and semantic status colors paired with explicit text/icons.
  - No final brand theme, Light/Dark default lock-in, or decorative styling—keeping Stage 2 free to introduce the final design system cleanly.
  - Reusable toast notifications, loading skeletons, and explicit confirmation modals for all destructive actions.

- **Deferred Stage 2 Navigation Roadmap** *(Documented for Continuity, Not Built in Stage 1)*:
  - Bottom Navigation Order: `1. Transaction` -> `2. Investment` -> `3. Dashboard` -> `4. Analytics` -> `5. Budget`.
  - Header Profile Trigger: Clicking the profile section in the application header opens `Profile & Settings`.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Local-First IndexedDB via Dexie.js**:
  - *Chosen Approach*: Store all 14 domain tables exclusively in browser IndexedDB using Dexie.js with versioned schemas and `upgrade()` hooks.
  - *Why*: Eliminates cloud dependency, preserves user ownership of financial data, supports indexed queries without loading the full database, and enables atomic transactions.
  - *Alternatives Considered*: `localStorage` (size/blocking limits, no relational indexes) and online databases like Firebase/Supabase (prohibited by local-first requirements).

- **Decision 2 — Strict Layered Boundary (UI -> Hooks/Services -> Repositories -> Dexie)**:
  - *Chosen Approach*: UI components never import or query Dexie directly; all data access routes through typed repositories and application services, with financial calculations kept separate from UI components.
  - *Why*: Protects maintainability, enforces validation/timestamp consistency, and allows Stage 2 UI redesigns without touching persistence logic.
  - *Alternatives Considered*: Direct Dexie calls inside React components (tightly couples UI to storage mechanics).

- **Decision 3 — Isolated Test-Data Tagging & Destructive Action Guards**:
  - *Chosen Approach*: Tag workbench-created verification records with an explicit `isTestData: true` marker (and display clear `Test Data` indicators in the UI). Restrict `"Clear Test Data"` strictly to records where `isTestData === true`, require confirmation modals before any destructive clear or restore overwrite, and forbid any bulk "delete all financial data" shortcut in the CRUD tester.
  - *Why*: Prevents accidental loss of real user financial records during verification and testing.

- **Decision 4 — Extensible 14-Table Schema Without Premature Business Logic**:
  - *Chosen Approach*: Define the complete 14-table schema with forward-compatible optional fields and indexes (covering Investment Pool / platform cash balances, asset holdings, linked transfers, partial buy/sell quantities, and historical valuations) while deferring calculation engines and module workflows to later stages.
  - *Why*: Enables smooth backward-compatible Dexie migrations as later stages are introduced.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                      Next.js App Router (Stage 1 Shell)                   │
│  ┌──────────────────────┐  ┌─────────────────────┐  ┌──────────────────┐  │
│  │ Configurable App     │  │ Internal Console    │  │ Toast, Loading & │  │
│  │ Metadata & Constants │  │ (Health, Safe CRUD, │  │ Confirm Modals   │  │
│  │ ("Personal Finance") │  │  Backup & Restore)  │  │                  │  │
│  └──────────┬───────────┘  └──────────┬──────────┘  └──────────────────┘  │
└─────────────┼─────────────────────────┼───────────────────────────────────┘
              │                         │ (React Hooks & Services)
              ▼                         ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                      Services & Utilities Layer                           │
│  ┌──────────────────────┐  ┌─────────────────────┐  ┌──────────────────┐  │
│  │ Bootstrap &          │  │ Backup Export,      │  │ Validation, IDR  │  │
│  │ Installation Service │  │ Schema Validator &  │  │ Format & Error   │  │
│  │ (Atomic Init Lock)   │  │ Atomic Restore      │  │ Utilities        │  │
│  └──────────┬───────────┘  └──────────┬──────────┘  └──────────────────┘  │
└─────────────┼─────────────────────────┼───────────────────────────────────┘
              │                         │
              ▼                         ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                           Repository Layer                                │
│   BaseRepository<T> + 14 Typed Repositories (Indexed Queries, Safe        │
│   Test-Record Isolation, Atomic Transactions, No Direct UI DB Access)     │
└───────────────────────────────────────┬───────────────────────────────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                      Dexie.js Database & Migrations                       │
│   PersonalFinanceDB (IndexedDB) · Versioned Schemas · Upgrade Hooks       │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & Extensibility (14 Initial IndexedDB Tables)**:
  - *System & Config*:
    - `appInstallation`: singleton record (`id`, `installationId`, `schemaVersion`, `createdAt`, `updatedAt`, `lastOpenedAt`).
    - `preferences`: installation-scoped settings (`id`, `installationId`, `baseCurrency: 'IDR'`, `locale: 'id-ID'`, `fiscalMonthStart`, `themePreference`, `updatedAt`).
  - *Cashflow, Transfers & Budgeting*:
    - `accounts`: bank, cash, e-wallet, or platform cash-balance accounts (`id`, `name`, `type`, `currency`, `initialBalance`, `platformId?`, `isInvestmentPool?`, `isArchived`, `isTestData?`, timestamps).
    - `categories` & `subcategories`: hierarchical classification (`categoryId` foreign key on subcategories, `isTestData?`).
    - `transactions`: ledger records (`id`, `accountId`, `toAccountId?`, `transferGroupId?`, `categoryId?`, `subcategoryId?`, `type`, `amount`, `currency`, `date`, `status`, `relatedHoldingId?`, `isTestData?`, timestamps) indexed by date, account, category, and transfer group for efficient queries.
    - `budgets`: period limits (`id`, `categoryId`, `subcategoryId?`, `period`, `month`, `year`, `limitAmount`, `currency`, `isTestData?`, timestamps).
  - *Investments (Schema Prepared, Business Logic Deferred)*:
    - `investmentPlatforms`: broker/exchange/custodian definitions supporting platform cash balances (`id`, `name`, `type`, `defaultCurrency`, `cashAccountId?`, `supportsPool?`, `isTestData?`, timestamps).
    - `assetClasses`: asset taxonomy (`id`, `name`, `code`, `isTestData?`, timestamps).
    - `holdings`: asset positions (`id`, `platformId`, `assetClassId`, `symbol`, `name`, `currency`, `quantity`, `averageCost`, `poolId?`, `isTestData?`, timestamps).
    - `investmentActivities`: granular events supporting partial buy/sell, dividends, fees, deposits/withdrawals, and linked transfers (`id`, `holdingId?`, `platformId`, `accountId?`, `linkedTransactionId?`, `activityType`, `quantity?`, `unitPrice?`, `grossAmount`, `feeAmount?`, `currency`, `activityDate`, `isTestData?`, timestamps).
    - `portfolioValuations`: historical snapshots (`id`, `scopeType`, `holdingId?`, `platformId?`, `valuationDate`, `marketValue`, `costBasis?`, `currency`, `isTestData?`, timestamps).
  - *Email Import Readiness (OAuth Deferred)*:
    - `emailConnections`: future Gmail OAuth association (`id`, `installationId`, `provider`, `emailAddress`, `status`, `lastSyncedAt`, timestamps — strictly zero passwords or client secrets).
    - `emailImportHistory`: import audit log (`id`, `connectionId`, `messageId`, `status`, `matchedTransactionId?`, `processedAt`, timestamps).

- **Interactive Component & State Mapping**:
  - **AppBootstrapProvider**: Runs once on startup via an idempotent initialization lock; opens Dexie, executes migrations, creates/loads `appInstallation` (`installationId`) and default IDR `preferences`, and provides `{ status: 'loading' | 'ready' | 'error', installation, preferences, refresh }`.
  - **DatabaseHealthPanel**: Reads per-table counts, active Dexie version, migration check status, and persistent `installationId`; includes a database integrity validator action.
  - **CrudVerificationWorkbench**: Operates strictly through repository services on `isTestData: true` records (e.g., test `accounts`, `categories`, `transactions`), rendering unmistakable `Test Data` tags, supporting create/read/update/delete, and providing a confirmation-gated `"Clear Test Data"` button that removes only records flagged `isTestData === true`.
  - **BackupVaultPanel**: Exports all 14 tables to a versioned JSON file (`personal-finance-backup-YYYY-MM-DD.json`); validates uploaded JSON structure, schema version compatibility, and record shapes before showing a confirmation modal to restore atomically inside a Dexie transaction, safely rejecting invalid files without mutating existing records.

- **Key Dependencies & Vercel Compatibility**:
  - Install `dexie` and `recharts` alongside existing `next`, `react`, `tailwindcss`, and `lucide-react`.
  - Guard all IndexedDB/Dexie access for client-side execution only (`typeof window !== 'undefined'`), ensuring clean Vercel-compatible Next.js production builds.
