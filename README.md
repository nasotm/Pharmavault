# PharmaVault — Pharmacy Inventory App Foundation

Offline-first pharmacy inventory foundation built with **React + Vite + TypeScript**, local **SQLite-Wasm (`@sqlite.org/sqlite-wasm`)** backed by the **Origin Private File System (OPFS)** behind a strict `DatabasePort` boundary, and a **Supabase Postgres** sync target schema.

---

## Why COOP & COEP Headers Are Required (`Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`)

Both `vite.config.ts` (development/preview) and `_headers` / `public/_headers` (production static hosting) send the following HTTP response headers:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### Technical Rationale

1. **`SharedArrayBuffer` & Cross-Origin Isolation (`window.crossOriginIsolated`)**:
   `@sqlite.org/sqlite-wasm`'s Origin Private File System (OPFS) virtual file system (`opfs` / `OpfsDb`) relies on `SharedArrayBuffer` and `Atomics` to coordinate synchronous SQLite C-API VFS file I/O operations with asynchronous browser OPFS worker handles.
2. **Browser Security Gate (Spectre Mitigation)**:
   Modern browsers disable `SharedArrayBuffer` unless the top-level document opts into **cross-origin isolation** by serving both:
   - `Cross-Origin-Opener-Policy: same-origin` (isolates the browsing context group from cross-origin popups/windows)
   - `Cross-Origin-Embedder-Policy: require-corp` (ensures all subresources explicitly grant permission to be loaded via CORP or CORS)
3. **Without these headers**:
   `window.crossOriginIsolated` evaluates to `false`, `SharedArrayBuffer` is unavailable, and `@sqlite.org/sqlite-wasm` cannot activate the synchronous OPFS VFS (`sqlite3.oo1.OpfsDb`), degrading or failing persistent OPFS storage.

---

## Architecture & Enforced Boundaries

1. **`DatabasePort` & `SqliteWasmAdapter` (`src/db/port.ts`, `src/db/sqlite-wasm-adapter.ts`)**:
   - `DatabasePort` exposes `query`, `exec`, and `transaction`.
   - `SqliteWasmAdapter` is the **only** module permitted to import or touch `@sqlite.org/sqlite-wasm` (enforced by ESLint `no-restricted-imports` and Vitest architectural boundary checks).
2. **Three-Layer Medication Schema (`src/db/migrations/001_initial_schema.sql`)**:
   - **Layer 1 (Catalog / Reference)**: Imported reference data (`brand_name`, `generic_name`, `strength`, `dosage_form`, `category`, `atc_code`, `manufacturer`, `barcode`, `storage`).
   - **Layer 2 (Local Inventory)**: Pharmacist-managed physical storage (`zone`, `shelf`, `bin`, `location_note`, `reorder_level`, `lead_time_days`).
   - **Layer 3 (Price)**: Pharmacist-confirmed integer cents (`unit_price_cents`, `cost_price_cents`, `currency`, `units_per_pack`, `price_source`, `price_confirmed`, `price_updated_at`).
3. **Strict Money & Nullability Rules**:
   - Money is **INTEGER minor units (cents)** everywhere. Floats and decimal strings are rejected.
   - `unit_price_cents = NULL` means **UNKNOWN / price not entered** — never coerced or defaulted to `0`.
4. **Append-Only Audit Ledgers**:
   - `stock_movement` and `price_history` are strictly append-only (no `UPDATE` or `DELETE` methods in the repository, plus `BEFORE UPDATE` and `BEFORE DELETE` SQLite `RAISE(ABORT, ...)` triggers).
5. **AI Layer Boundary**:
   - The future AI layer must **never** write to `price`, `atc_code`, `generic_name`, `manufacturer`, or any Layer 1 catalog / Layer 3 pricing field.
6. **Supabase Postgres Sync Target (`supabase/migrations/001_initial_schema.sql`)**:
   - Defines the matching Postgres tables, constraints, indexes, and append-only triggers for cloud synchronization.

---

## Scripts

```bash
# Run numbered SQL migrations (idempotent, tracked in schema_migrations)
npm run migrate

# Seed 5 sample medications (including aliases, batches, 1 low-stock item, and 1 NULL-price item)
npm run seed

# Run Vitest unit & integration suite
npm test

# Run ESLint + TypeScript typecheck
npm run lint

# Start development server on port 3000 with COOP/COEP headers
npm run dev
```
