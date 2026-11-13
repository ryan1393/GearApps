-- Administrators can rename a station (Admin > Stations > Edit). The rename is audited like the
-- other station changes, so the event log accepts a RENAMED action.
ALTER TABLE public.truck_log_station_events DROP CONSTRAINT truck_log_station_events_action_check;
ALTER TABLE public.truck_log_station_events
    ADD CONSTRAINT truck_log_station_events_action_check
    CHECK (action IN ('CREATED', 'PAIRING_CODE_ISSUED', 'PAIRED', 'REVOKED', 'SIGNED_OUT', 'RENAMED'));
