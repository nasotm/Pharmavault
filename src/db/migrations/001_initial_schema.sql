-- =============================================================================
-- 001_initial_schema.sql
-- Pharmacy Inventory Local SQLite Schema
-- Timestamps: TEXT ISO-8601
-- Prices: INTEGER minor units (cents). unit_price_cents NULL = UNKNOWN, NEVER 0.
-- =============================================================================

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
  currency TEXT DEFAULT 'USD',
  units_per_pack INTEGER DEFAULT 1,
  price_source TEXT CHECK (price_source IS NULL OR price_source IN ('manual', 'official_tariff', 'imported')),
  price_confirmed INTEGER DEFAULT 0 CHECK (price_confirmed IN (0, 1)), -- 1 = pharmacist confirmed
  price_updated_at TEXT,
  updated_at TEXT,
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

