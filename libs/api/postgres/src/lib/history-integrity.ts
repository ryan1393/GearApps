export const LAPPER_HISTORY_INTEGRITY_SQL = `
-- Run once in the shared schema-migration transaction, before serving requests.
-- Only exact event duplicates whose measurements agree can be consolidated.
LOCK TABLE lapper.machine_cycles,lapper.macro_logs IN ACCESS EXCLUSIVE MODE;

CREATE TABLE lapper.machine_cycle_archive (
  id uuid PRIMARY KEY, canonical_id uuid NOT NULL REFERENCES lapper.machine_cycles(id),
  original_data jsonb NOT NULL, row_hash char(32) NOT NULL,
  cleanup_version text NOT NULL, archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_cycle_archive_identity CHECK ((original_data->>'id')::uuid=id),
  CONSTRAINT ck_cycle_archive_hash CHECK (row_hash=md5(original_data::text))
);
CREATE INDEX ix_cycle_archive_canonical ON lapper.machine_cycle_archive(canonical_id);
CREATE TABLE lapper.macro_log_archive (
  id uuid PRIMARY KEY, canonical_id uuid NOT NULL REFERENCES lapper.macro_logs(id),
  original_data jsonb NOT NULL, row_hash char(32) NOT NULL,
  cleanup_version text NOT NULL, archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_macro_archive_identity CHECK ((original_data->>'id')::uuid=id),
  CONSTRAINT ck_macro_archive_hash CHECK (row_hash=md5(original_data::text))
);
CREATE INDEX ix_macro_archive_canonical ON lapper.macro_log_archive(canonical_id);

CREATE TEMP TABLE cleanup_cycle_map ON COMMIT DROP AS
SELECT id AS original_id,first_value(id) OVER (
  PARTITION BY machine_id,gearset_id,timestamp,recorded_at,consec,serial_number ORDER BY id
) AS canonical_id FROM lapper.machine_cycles;
ALTER TABLE cleanup_cycle_map ADD PRIMARY KEY(original_id);

DO $check_history$
BEGIN
  IF EXISTS(
    SELECT 1 FROM lapper.macro_logs l JOIN cleanup_cycle_map c ON c.original_id=l.machine_cycle_id
    GROUP BY c.canonical_id,l.macro_id HAVING count(DISTINCT l.value)>1
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Duplicate cycle snapshots contain conflicting macro values. Review them before cleanup.';
  END IF;
END $check_history$;

CREATE TEMP TABLE cleanup_macro_map ON COMMIT DROP AS
SELECT l.id AS original_id,c.canonical_id AS canonical_cycle_id,
  first_value(l.id) OVER(PARTITION BY c.canonical_id,l.macro_id ORDER BY l.id) AS canonical_id
FROM lapper.macro_logs l JOIN cleanup_cycle_map c ON c.original_id=l.machine_cycle_id;
ALTER TABLE cleanup_macro_map ADD PRIMARY KEY(original_id);

INSERT INTO lapper.machine_cycle_archive(id,canonical_id,original_data,row_hash,cleanup_version)
SELECT c.id,m.canonical_id,to_jsonb(c),md5(to_jsonb(c)::text),'20261109-lapper-history-integrity-v2'
FROM lapper.machine_cycles c JOIN cleanup_cycle_map m ON m.original_id=c.id WHERE c.id<>m.canonical_id;

-- Retain both removed duplicates and original versions of rows whose cycle FK changes.
INSERT INTO lapper.macro_log_archive(id,canonical_id,original_data,row_hash,cleanup_version)
SELECT l.id,m.canonical_id,to_jsonb(l),md5(to_jsonb(l)::text),'20261109-lapper-history-integrity-v2'
FROM lapper.macro_logs l JOIN cleanup_macro_map m ON m.original_id=l.id
WHERE l.id<>m.canonical_id OR l.machine_cycle_id<>m.canonical_cycle_id;

DELETE FROM lapper.macro_logs l USING cleanup_macro_map m WHERE l.id=m.original_id AND l.id<>m.canonical_id;
UPDATE lapper.macro_logs l SET machine_cycle_id=m.canonical_cycle_id FROM cleanup_macro_map m
WHERE l.id=m.original_id AND l.machine_cycle_id<>m.canonical_cycle_id;
DELETE FROM lapper.machine_cycles c USING cleanup_cycle_map m WHERE c.id=m.original_id AND c.id<>m.canonical_id;

ALTER TABLE lapper.machine_cycles ADD CONSTRAINT uq_lapper_cycle_event UNIQUE NULLS NOT DISTINCT
  (machine_id,gearset_id,timestamp,recorded_at,consec,serial_number);
ALTER TABLE lapper.macro_logs ADD CONSTRAINT uq_lapper_cycle_macro UNIQUE(machine_cycle_id,macro_id);
ALTER TABLE lapper.macro_logs ADD CONSTRAINT ck_lapper_macro_value_finite CHECK(value<>'NaN'::numeric);
CREATE UNIQUE INDEX uq_lapper_scanner_machine ON lapper.scanners(machine_id);
CREATE UNIQUE INDEX uq_lapper_active_macro_number ON lapper.macros(number) WHERE status=1;
CREATE INDEX ix_lapper_cycles_gear_machine_time ON lapper.machine_cycles(gearset_id,machine_id,timestamp DESC,id DESC);
CREATE INDEX ix_lapper_macro_logs_macro ON lapper.macro_logs(macro_id);

ALTER TABLE lapper.gearsets ADD CONSTRAINT fk_lapper_gear_summary FOREIGN KEY(summary_id) REFERENCES public.part_summaries(id);
ALTER TABLE lapper.gearsets ADD CONSTRAINT fk_lapper_gear_ring FOREIGN KEY(ring_id) REFERENCES public.parts(id);
ALTER TABLE lapper.gearsets ADD CONSTRAINT fk_lapper_gear_pinion FOREIGN KEY(pinion_id) REFERENCES public.parts(id);
ALTER TABLE lapper.gearsets ADD CONSTRAINT fk_lapper_gear_user FOREIGN KEY(user_id) REFERENCES public.users(id);

CREATE VIEW lapper.machine_cycle_aliases AS
SELECT id AS original_id,canonical_id FROM lapper.machine_cycle_archive;
CREATE VIEW lapper.macro_log_aliases AS
SELECT id AS original_id,canonical_id FROM lapper.macro_log_archive WHERE id<>canonical_id;

-- Full source history remains queryable, including original IDs and FK values.
CREATE VIEW lapper.machine_cycles_with_legacy AS
SELECT c.* FROM lapper.machine_cycles c
UNION ALL SELECT (jsonb_populate_record(NULL::lapper.machine_cycles,a.original_data)).* FROM lapper.machine_cycle_archive a;
CREATE VIEW lapper.macro_logs_with_legacy AS
SELECT l.* FROM lapper.macro_logs l WHERE NOT EXISTS(SELECT 1 FROM lapper.macro_log_archive a WHERE a.id=l.id)
UNION ALL SELECT (jsonb_populate_record(NULL::lapper.macro_logs,a.original_data)).* FROM lapper.macro_log_archive a;

COMMENT ON TABLE lapper.machine_cycle_archive IS 'Original duplicate cycle records retained by the integrity migration; canonical_id resolves operational identity.';
COMMENT ON TABLE lapper.macro_log_archive IS 'Original duplicate or re-linked macro records retained verbatim by the integrity migration.';
COMMENT ON TABLE lapper.gearsets IS 'Legacy/pending gearset references. public.gearsets owns canonical assemblies; repeated legacy numbers are lineage, not additional assemblies.';
COMMENT ON TABLE lapper.machines IS 'Lapper connection profiles and imported lineage; public.machines owns machine identity, department and cell.';
`;
