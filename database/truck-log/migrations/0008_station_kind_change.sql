-- Administrators can change a station's kind (Admin > Stations > Edit), for example a CK65
-- registered as a guard station by mistake. The change is audited as KIND_CHANGED.
ALTER TABLE public.truck_log_station_events DROP CONSTRAINT truck_log_station_events_action_check;
ALTER TABLE public.truck_log_station_events
    ADD CONSTRAINT truck_log_station_events_action_check
    CHECK (action IN ('CREATED', 'PAIRING_CODE_ISSUED', 'PAIRED', 'REVOKED', 'SIGNED_OUT', 'RENAMED', 'KIND_CHANGED'));
