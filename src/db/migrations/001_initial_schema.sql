-- =============================================================================
-- 001_initial_schema.sql
-- Pharmacy Inventory Local SQLite Schema
-- Timestamps: TEXT ISO-8601
-- Prices: INTEGER DZD for base currency ('DZD'), INTEGER cents for foreign currencies.
-- unit_price_cents NULL = UNKNOWN, NEVER 0.
-- =============================================================================

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
  -- Precomputed normalized search text across brand_name + generic_name + aliases
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

-- Required indexes + search performance indexes
CREATE INDEX IF NOT EXISTS idx_medication_barcode ON medication(barcode);
CREATE INDEX IF NOT EXISTS idx_medication_brand_name ON medication(brand_name);
CREATE INDEX IF NOT EXISTS idx_medication_brand_name_nocase ON medication(brand_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_medication_search_text ON medication(search_text);
CREATE INDEX IF NOT EXISTS idx_medication_alias_alias ON medication_alias(alias);
CREATE INDEX IF NOT EXISTS idx_medication_alias_medication_id ON medication_alias(medication_id);
CREATE INDEX IF NOT EXISTS idx_batch_medication_id ON batch(medication_id);
CREATE INDEX IF NOT EXISTS idx_price_history_medication_id ON price_history(medication_id);
CREATE INDEX IF NOT EXISTS idx_medication_is_archived ON medication(is_archived);

-- Automatic maintenance of precomputed medication.search_text
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

-- Enforce append-only semantics on stock_movement and price_history at the DB level
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

-- Deterministic 30-day stockout prediction view (no LLM math)
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
