-- Cutter reference data. These are database rows, not application enums.
-- Safe to rerun after the tables exist.

INSERT INTO cutter_event_types (id, code, name, description, sort_order, enabled, "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), 'CB', 'Cutter Build', 'Cutter Builder build or rebuild', 10, true, now(), now()),
  (gen_random_uuid(), 'CS', 'Cutter Setup', 'Cutter setup on a production machine', 20, true, now(), now()),
  (gen_random_uuid(), 'FC', 'Frequency Check', 'Periodic production quality check', 30, true, now(), now()),
  (gen_random_uuid(), 'CMM', 'CMM Check', 'CMM / Zeiss quality check', 40, true, now(), now()),
  (gen_random_uuid(), 'CP', 'Cutter Pull', 'Cutter removed for dull, damage, or other pull reason', 50, true, now(), now()),
  (gen_random_uuid(), 'CC', 'Changeover', 'Usable cutter removed for changeover and returned to shelf', 60, true, now(), now()),
  (gen_random_uuid(), 'TD', 'Cutter Teardown', 'Cutter Builder teardown and blade disposition', 70, true, now(), now())
ON CONFLICT (code) DO NOTHING;

INSERT INTO cutter_build_statuses (id, code, name, description, sort_order, enabled, "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), 'BUILDING', 'Building', 'Currently being assembled in Cutter Builder', 10, true, now(), now()),
  (gen_random_uuid(), 'READY', 'Ready', 'Built and available for setup', 20, true, now(), now()),
  (gen_random_uuid(), 'RUNNING', 'Running', 'Currently installed on a machine', 30, true, now(), now()),
  (gen_random_uuid(), 'SHELF', 'Shelf', 'Usable build returned to shelf after changeover', 40, true, now(), now()),
  (gen_random_uuid(), 'PULLED', 'Pulled', 'Removed and awaiting Cutter Builder disposition', 50, true, now(), now()),
  (gen_random_uuid(), 'CLOSED', 'Closed', 'Build cycle complete; body is ready for rebuild', 60, true, now(), now())
ON CONFLICT (code) DO NOTHING;

INSERT INTO part_types (id, code, name, description, sort_order, enabled, "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), 'RING', 'Ring', 'Ring cutter / blade set', 10, true, now(), now()),
  (gen_random_uuid(), 'PINION', 'Pinion', 'Pinion cutter / blade set', 20, true, now(), now())
ON CONFLICT (code) DO NOTHING;
