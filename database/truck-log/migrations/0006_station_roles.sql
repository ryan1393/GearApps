-- Role-based stations: dock handhelds (CK65) and view-only management PCs join
-- guard PCs and TV displays. The server enforces what each kind may do
-- (libs/truck-log/server/auth/station/src/lib/station-roles.ts).
ALTER TABLE public.truck_log_stations DROP CONSTRAINT truck_log_stations_kind_check;
ALTER TABLE public.truck_log_stations
    ADD CONSTRAINT truck_log_stations_kind_check CHECK (kind IN ('GUARD', 'DOCK', 'MANAGEMENT', 'DISPLAY'));
