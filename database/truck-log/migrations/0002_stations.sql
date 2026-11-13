-- Station sign-in: every guard PC and TV is a registered station.
-- An administrator creates the station and gets a one-time pairing code; the
-- station exchanges the code for a long-lived token kept in an HttpOnly cookie.
-- Only SHA-256 digests of codes and tokens are stored.

CREATE TABLE public.truck_log_stations (
    id uuid PRIMARY KEY,
    name varchar(80) NOT NULL CHECK (length(btrim(name)) > 0 AND name !~ '[[:cntrl:]]'),
    kind varchar(16) NOT NULL CHECK (kind IN ('GUARD', 'DISPLAY')),
    token_sha256 char(64) UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
    pairing_code_sha256 char(64) UNIQUE CHECK (pairing_code_sha256 ~ '^[0-9a-f]{64}$'),
    pairing_expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(120),
    paired_at timestamptz,
    last_seen_at timestamptz,
    revoked_at timestamptz,
    revoked_by varchar(120),
    CONSTRAINT truck_log_stations_pairing_pair CHECK ((pairing_code_sha256 IS NULL) = (pairing_expires_at IS NULL)),
    CONSTRAINT truck_log_stations_revoked_inactive CHECK (revoked_at IS NULL OR (token_sha256 IS NULL AND pairing_code_sha256 IS NULL))
);

-- Station names are unique regardless of case so the admin list stays unambiguous.
CREATE UNIQUE INDEX ux_truck_log_stations_name ON public.truck_log_stations (lower(name)) WHERE revoked_at IS NULL;

CREATE TABLE public.truck_log_station_events (
    id bigserial PRIMARY KEY,
    station_id uuid NOT NULL REFERENCES public.truck_log_stations(id),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    action varchar(40) NOT NULL CHECK (action IN ('CREATED', 'PAIRING_CODE_ISSUED', 'PAIRED', 'REVOKED', 'SIGNED_OUT')),
    actor varchar(120),
    client_address varchar(64)
);
CREATE INDEX ix_truck_log_station_events_station ON public.truck_log_station_events (station_id, occurred_at DESC);
