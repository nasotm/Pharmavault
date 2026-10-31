import type { DatabasePort } from './port';

export interface MigrationDefinition {
  /** Numbered prefix (e.g. '001') */
  version: string;
  /** Filename (e.g. '001_initial_schema.sql') */
  name: string;
  /** Raw SQL statements */
  sql: string;
}

export interface MigrationRunResult {
  applied: string[];
  skipped: string[];
}

export interface SchemaMigrationRecord {
  version: string;
  name: string;
  applied_at: string;
}

const INITIAL_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  rate_to_da REAL NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO currencies (code, name, symbol, rate_to_da) VALUES
  ('DZD', 'Algerian Dinar', 'DA', 1),
  ('EUR', 'Euro', '€', 146.5),
  ('USD', 'US Dollar', '$', 134.5),
  ('GBP', 'British Pound', '£', 171.0),
  ('CAD', 'Canadian Dollar', 'CA$', 98.5),
  ('CHF', 'Swiss Franc', 'CHF', 152.0),
  ('CNY', 'Chinese Yuan', '¥', 18.8),
  ('TRY', 'Turkish Lira', '₺', 4.1),
  ('AED', 'UAE Dirham', 'AED', 36.6),
  ('SAR', 'Saudi Riyal', 'SAR', 35.8);

-- LAYER 1: catalog / reference (imported, not typed by hand)
CREATE TABLE IF NOT EXISTS medication (
  id INTEGER PRIMARY KEY,
  brand_name TEXT NOT NULL,
  generic_name TEXT,
  strength TEXT,
  dosage_form TEXT,
  category TEXT,
  atc_code TEXT,
  manufacturer TEXT,
  barcode TEXT UNIQUE,
  storage TEXT,
  -- Detailed medical information
  posology TEXT,
  interactions TEXT,
  composition TEXT,
  therapeutic_class TEXT,
  indications TEXT,
  precautions TEXT,
  route TEXT,
  side_effects TEXT,
  -- LAYER 2: local inventory (pharmacist only)
  zone TEXT,
  shelf TEXT,
  bin TEXT,
  location_note TEXT,
  reorder_level INTEGER DEFAULT 10,
  lead_time_days INTEGER DEFAULT 7,
  -- LAYER 3: price (pharmacist confirms; never fetched silently)
  unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR typeof(unit_price_cents) = 'integer'), -- NULL = unknown, NOT 0
  cost_price_cents INTEGER CHECK (cost_price_cents IS NULL OR typeof(cost_price_cents) = 'integer'),
  currency TEXT DEFAULT 'DZD',
  currency_code TEXT DEFAULT 'DZD' REFERENCES currencies(code),
  units_per_pack INTEGER DEFAULT 1,
  price_source TEXT CHECK (price_source IS NULL OR price_source IN ('manual', 'official_tariff', 'imported')),
  price_confirmed INTEGER DEFAULT 0 CHECK (price_confirmed IN (0, 1)), -- 1 = pharmacist confirmed
  price_updated_at TEXT,
  updated_at TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  search_text TEXT
);

CREATE TABLE IF NOT EXISTS medication_alias (
  id INTEGER PRIMARY KEY,
  medication_id INTEGER REFERENCES medication(id) ON DELETE CASCADE,
  alias TEXT
);

CREATE TABLE IF NOT EXISTS batch (
  id INTEGER PRIMARY KEY,
  medication_id INTEGER REFERENCES medication(id) ON DELETE CASCADE,
  lot_number TEXT,
  quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer'),
  expiry_date TEXT,
  received_at TEXT
);

CREATE TABLE IF NOT EXISTS stock_movement (
  id INTEGER PRIMARY KEY,
  medication_id INTEGER REFERENCES medication(id),
  batch_id INTEGER REFERENCES batch(id),
  delta INTEGER CHECK (typeof(delta) = 'integer'),
  reason TEXT,
  user_id TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY,
  medication_id INTEGER REFERENCES medication(id),
  unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR typeof(unit_price_cents) = 'integer'),
  source TEXT CHECK (source IS NULL OR source IN ('manual', 'official_tariff', 'imported')),
  changed_by TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_medication_barcode ON medication(barcode);
CREATE INDEX IF NOT EXISTS idx_medication_brand_name ON medication(brand_name);
CREATE INDEX IF NOT EXISTS idx_medication_brand_name_nocase ON medication(brand_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_medication_search_text ON medication(search_text);
CREATE INDEX IF NOT EXISTS idx_medication_alias_alias ON medication_alias(alias);
CREATE INDEX IF NOT EXISTS idx_medication_alias_medication_id ON medication_alias(medication_id);
CREATE INDEX IF NOT EXISTS idx_batch_medication_id ON batch(medication_id);
CREATE INDEX IF NOT EXISTS idx_price_history_medication_id ON price_history(medication_id);

CREATE TRIGGER IF NOT EXISTS trg_medication_sync_search_text_insert
AFTER INSERT ON medication
BEGIN
  UPDATE medication
  SET search_text = LOWER(
    TRIM(
      COALESCE(NEW.brand_name, '') || '|||' ||
      COALESCE(NEW.generic_name, '') || '|||' ||
      COALESCE((SELECT GROUP_CONCAT(alias, '|||') FROM medication_alias WHERE medication_id = NEW.id), '')
    )
  )
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_medication_sync_search_text_update
AFTER UPDATE OF brand_name, generic_name ON medication
BEGIN
  UPDATE medication
  SET search_text = LOWER(
    TRIM(
      COALESCE(NEW.brand_name, '') || '|||' ||
      COALESCE(NEW.generic_name, '') || '|||' ||
      COALESCE((SELECT GROUP_CONCAT(alias, '|||') FROM medication_alias WHERE medication_id = NEW.id), '')
    )
  )
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_medication_alias_sync_search_text_insert
AFTER INSERT ON medication_alias
BEGIN
  UPDATE medication
  SET search_text = LOWER(
    TRIM(
      COALESCE(brand_name, '') || '|||' ||
      COALESCE(generic_name, '') || '|||' ||
      COALESCE((SELECT GROUP_CONCAT(alias, '|||') FROM medication_alias WHERE medication_id = NEW.medication_id), '')
    )
  )
  WHERE id = NEW.medication_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_medication_alias_sync_search_text_delete
AFTER DELETE ON medication_alias
BEGIN
  UPDATE medication
  SET search_text = LOWER(
    TRIM(
      COALESCE(brand_name, '') || '|||' ||
      COALESCE(generic_name, '') || '|||' ||
      COALESCE((SELECT GROUP_CONCAT(alias, '|||') FROM medication_alias WHERE medication_id = OLD.medication_id), '')
    )
  )
  WHERE id = OLD.medication_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_movement_append_only_update
BEFORE UPDATE ON stock_movement
BEGIN
  SELECT RAISE(ABORT, 'stock_movement is append-only: UPDATE is prohibited');
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_movement_append_only_delete
BEFORE DELETE ON stock_movement
BEGIN
  SELECT RAISE(ABORT, 'stock_movement is append-only: DELETE is prohibited');
END;

CREATE TRIGGER IF NOT EXISTS trg_price_history_append_only_update
BEFORE UPDATE ON price_history
BEGIN
  SELECT RAISE(ABORT, 'price_history is append-only: UPDATE is prohibited');
END;

CREATE TRIGGER IF NOT EXISTS trg_price_history_append_only_delete
BEFORE DELETE ON price_history
BEGIN
  SELECT RAISE(ABORT, 'price_history is append-only: DELETE is prohibited');
END;
`;

export const BUNDLED_MIGRATIONS: readonly MigrationDefinition[] = [
  {
    version: '001',
    name: '001_initial_schema.sql',
    sql: INITIAL_SCHEMA_SQL,
  },
];

/**
 * Loads numbered .sql files from disk when running in Node.js, or falls back to
 * the bundled migration definitions when running in the browser.
 */
export async function loadMigrations(customDir?: string): Promise<MigrationDefinition[]> {
  if (typeof window !== 'undefined') {
    return [...BUNDLED_MIGRATIONS];
  }

  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const migrationsDir = customDir ?? path.resolve(process.cwd(), 'src/db/migrations');
    if (!fs.existsSync(migrationsDir)) {
      return [...BUNDLED_MIGRATIONS];
    }

    const entries = fs
      .readdirSync(migrationsDir)
      .filter((file) => /^\d+_.*\.sql$/i.test(file))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

    return entries.map((filename) => {
      const match = /^(\d+)_/.exec(filename);
      const version = match ? match[1] : filename;
      const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
      return {
        version,
        name: filename,
        sql,
      };
    });
  } catch {
    return [...BUNDLED_MIGRATIONS];
  }
}

const MEDICAL_INFO_COLUMNS = [
  'posology',
  'interactions',
  'composition',
  'therapeutic_class',
  'indications',
  'precautions',
  'route',
  'side_effects',
] as const;

async function ensureSearchTextColumnAndIndexes(db: DatabasePort): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS currencies (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      rate_to_da REAL NOT NULL DEFAULT 1
    );

    INSERT OR IGNORE INTO currencies (code, name, symbol, rate_to_da) VALUES
      ('DZD', 'Algerian Dinar', 'DA', 1),
      ('EUR', 'Euro', '€', 146.5),
      ('USD', 'US Dollar', '$', 134.5),
      ('GBP', 'British Pound', '£', 171.0),
      ('CAD', 'Canadian Dollar', 'CA$', 98.5),
      ('CHF', 'Swiss Franc', 'CHF', 152.0),
      ('CNY', 'Chinese Yuan', '¥', 18.8),
      ('TRY', 'Turkish Lira', '₺', 4.1),
      ('AED', 'UAE Dirham', 'AED', 36.6),
      ('SAR', 'Saudi Riyal', 'SAR', 35.8);
  `);

  const tableInfo = await db.query<{ name: string }>('PRAGMA table_info(medication)');
  if (tableInfo.length === 0) return;

  const existingColumns = new Set(tableInfo.map((col) => col.name));

  if (!existingColumns.has('search_text')) {
    await db.exec('ALTER TABLE medication ADD COLUMN search_text TEXT;');
  }

  if (!existingColumns.has('currency_code')) {
    await db.exec("ALTER TABLE medication ADD COLUMN currency_code TEXT DEFAULT 'DZD';");
    await db.exec("UPDATE medication SET currency = 'DZD', currency_code = 'DZD' WHERE currency_code IS NULL OR currency = 'USD';");
  } else {
    await db.exec("UPDATE medication SET currency_code = 'DZD' WHERE currency_code IS NULL OR TRIM(currency_code) = '';");
  }

  for (const colName of MEDICAL_INFO_COLUMNS) {
    if (!existingColumns.has(colName)) {
      await db.exec(`ALTER TABLE medication ADD COLUMN ${colName} TEXT;`);
    }
  }

  if (!existingColumns.has('is_archived')) {
    await db.exec('ALTER TABLE medication ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;');
  }

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_medication_brand_name_nocase ON medication(brand_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_medication_search_text ON medication(search_text);
    CREATE INDEX IF NOT EXISTS idx_medication_alias_medication_id ON medication_alias(medication_id);
    CREATE INDEX IF NOT EXISTS idx_batch_medication_id ON batch(medication_id);
    CREATE INDEX IF NOT EXISTS idx_medication_is_archived ON medication(is_archived);

    UPDATE medication
    SET search_text = LOWER(
      TRIM(
        COALESCE(brand_name, '') || '|||' ||
        COALESCE(generic_name, '') || '|||' ||
        COALESCE((SELECT GROUP_CONCAT(alias, '|||') FROM medication_alias WHERE medication_id = medication.id), '')
      )
    )
    WHERE search_text IS NULL;

    CREATE VIEW IF NOT EXISTS v_stockout_prediction_30d AS
    WITH batch_totals AS (
      SELECT
        b.medication_id,
        COALESCE(SUM(b.quantity), 0) AS current_stock
      FROM batch b
      GROUP BY b.medication_id
    ),
    usage_30d AS (
      SELECT
        sm.medication_id,
        COALESCE(SUM(CASE WHEN sm.delta < 0 THEN -sm.delta ELSE 0 END), 0) AS total_outflow_30d,
        COALESCE(SUM(CASE WHEN sm.delta < 0 THEN 1 ELSE 0 END), 0) AS outflow_movement_count_30d
      FROM stock_movement sm
      WHERE datetime(sm.created_at) >= datetime('now', '-30 days')
      GROUP BY sm.medication_id
    )
    SELECT
      m.id AS medication_id,
      m.brand_name,
      m.generic_name,
      m.strength,
      m.dosage_form,
      m.zone,
      m.shelf,
      m.bin,
      m.location_note,
      m.reorder_level,
      COALESCE(bt.current_stock, 0) AS current_stock,
      COALESCE(u.total_outflow_30d, 0) AS total_outflow_30d,
      COALESCE(u.outflow_movement_count_30d, 0) AS outflow_movement_count_30d,
      CAST(COALESCE(u.total_outflow_30d, 0) AS REAL) / 30.0 AS avg_daily_usage,
      CASE
        WHEN COALESCE(u.outflow_movement_count_30d, 0) > 0 AND COALESCE(u.total_outflow_30d, 0) > 0
          THEN CAST(COALESCE(bt.current_stock, 0) AS REAL) / (CAST(COALESCE(u.total_outflow_30d, 0) AS REAL) / 30.0)
        ELSE NULL
      END AS days_remaining,
      CASE
        WHEN COALESCE(u.outflow_movement_count_30d, 0) > 0 AND COALESCE(u.total_outflow_30d, 0) > 0
          THEN 1
        ELSE 0
      END AS has_sufficient_history,
      CASE
        WHEN COALESCE(u.outflow_movement_count_30d, 0) > 0
          AND COALESCE(u.total_outflow_30d, 0) > 0
          AND (CAST(COALESCE(bt.current_stock, 0) AS REAL) / (CAST(COALESCE(u.total_outflow_30d, 0) AS REAL) / 30.0)) < 7.0
          THEN 1
        ELSE 0
      END AS is_critical_prediction
    FROM medication m
    LEFT JOIN batch_totals bt ON bt.medication_id = m.id
    LEFT JOIN usage_30d u ON u.medication_id = m.id;
  `);
}

/**
 * Idempotent migration runner tracking applied numbered .sql files in schema_migrations.
 */
export async function runMigrations(
  db: DatabasePort,
  options?: { migrations?: readonly MigrationDefinition[]; migrationsDir?: string },
): Promise<MigrationRunResult> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const migrations =
    options?.migrations !== undefined
      ? [...options.migrations]
      : await loadMigrations(options?.migrationsDir);

  const sorted = [...migrations].sort((a, b) =>
    a.version.localeCompare(b.version, 'en', { numeric: true }),
  );

  const existingRows = await db.query<SchemaMigrationRecord>(
    'SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC',
  );
  const appliedVersions = new Set(existingRows.map((row) => row.version));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of sorted) {
    if (appliedVersions.has(migration.version)) {
      skipped.push(migration.name);
      continue;
    }

    await db.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.exec('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
        migration.version,
        migration.name,
        new Date().toISOString(),
      ]);
    });

    applied.push(migration.name);
  }

  await ensureSearchTextColumnAndIndexes(db);

  return { applied, skipped };
}
