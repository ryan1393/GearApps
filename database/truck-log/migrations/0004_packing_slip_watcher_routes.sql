-- Packing-slip watcher routes.
--
-- The SAP capture queue watcher on the print PC reads its eight route settings
-- from Truck Log (GET /api/v1/print-agents/packing-slip-routes) instead of its
-- watcher.ini. Administrators edit them in Administration > Printing. Switching a
-- route to LIVE (paper printing) needs an explicit confirmation in the webpage;
-- every saved change is recorded in packing_slip_watcher_route_audit.
--
-- The rules match libs/truck-log/shared/contracts/src/packing-slip-routes.ts
-- (the server checks them first; these constraints are the last line of defence).
-- "SAP capture queue unique across routes that are not OFF" is checked by the
-- server under the config row lock: a partial unique index would refuse a save
-- that swaps two queues between routes in one statement.

CREATE TABLE public.packing_slip_watcher_config (
    id smallint PRIMARY KEY CHECK (id = 1),
    version integer NOT NULL CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(120) NOT NULL CHECK (length(btrim(updated_by)) > 0)
);

CREATE TABLE public.packing_slip_watcher_routes (
    route smallint PRIMARY KEY CHECK (route BETWEEN 1 AND 8),
    name varchar(60) NOT NULL CHECK (length(name) BETWEEN 1 AND 60 AND name = btrim(name) AND name !~ '[[:cntrl:]]'),
    source_queue varchar(120) NOT NULL CHECK (length(source_queue) BETWEEN 1 AND 120 AND source_queue = btrim(source_queue) AND source_queue !~ '[[:cntrl:]]'),
    output_printer varchar(260) NOT NULL DEFAULT '' CHECK (output_printer = '' OR output_printer ~ '^\\\\[A-Za-z0-9._-]+\\[^\\/:*?"<>|[:cntrl:]]{1,200}$'),
    mode varchar(4) NOT NULL CHECK (mode IN ('OFF', 'TEST', 'LIVE')),
    upload_enabled boolean NOT NULL DEFAULT false,
    CONSTRAINT packing_slip_watcher_routes_live_printer CHECK (mode <> 'LIVE' OR output_printer <> '')
);

-- Append-only: one row per saved change, with every field's before and after value.
CREATE TABLE public.packing_slip_watcher_route_audit (
    id bigserial PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor varchar(120) NOT NULL CHECK (length(btrim(actor)) > 0),
    version_before integer NOT NULL CHECK (version_before > 0),
    version_after integer NOT NULL CHECK (version_after = version_before + 1),
    live_confirmed smallint[] NOT NULL DEFAULT '{}',
    changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array' AND jsonb_array_length(changes) > 0)
);
CREATE INDEX ix_packing_slip_watcher_route_audit_occurred ON public.packing_slip_watcher_route_audit (occurred_at DESC);

CREATE FUNCTION public.protect_packing_slip_watcher_route_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Packing-slip watcher route audit history cannot be changed or deleted';
END; $$;

CREATE TRIGGER trg_protect_packing_slip_watcher_route_audit
    BEFORE UPDATE OR DELETE ON public.packing_slip_watcher_route_audit
    FOR EACH ROW EXECUTE FUNCTION public.protect_packing_slip_watcher_route_audit();

-- Seed: today's watcher.ini routes 1-8. Every route starts in TEST with upload off;
-- an administrator switches DGL (route 8) to LIVE in the webpage when ready.
INSERT INTO public.packing_slip_watcher_config (id, version, updated_at, updated_by)
VALUES (1, 1, now(), 'migration');

INSERT INTO public.packing_slip_watcher_routes (route, name, source_queue, output_printer, mode, upload_enabled) VALUES
    (1, 'West Dock', 'SAP-Capture-route1', '\\USFTWPLVPS03\USFTWP_West_Dock_Ricoh', 'TEST', false),
    (2, 'East Dock', 'SAP-Capture-route2', '\\USFTWPLVPS03\USFTWP_EastDock_Ricoh', 'TEST', false),
    (3, 'Receiving Dock', 'SAP-Capture-route3', '\\USFTWPLVPS03\USFTWP_Receiving_Dock', 'TEST', false),
    (4, 'Tube Mill Dock', 'SAP-Capture-route4', '\\USFTWPLVPS03\USFTWP_Tube_Mill_Dock_Ricoh', 'TEST', false),
    (5, 'Forge Dock', 'SAP-Capture-route5', '\\USFTWPLVPS03\USFTWP_Forge_Dock_Ricoh', 'TEST', false),
    (6, 'North Shipping Dock', 'SAP-Capture-route6', '\\USFTWPLVPS03\USFTWP_Shipping_Ricoh_2', 'TEST', false),
    (7, 'Scheduling Office', 'SAP-Capture-route7', '\\USFTWPLVPS03\USFTWP_Scheduling_Ricoh', 'TEST', false),
    (8, 'DGL', 'SAP-Capture-route8', '\\USFTWPLVPS03\USFTWP_DGL_Ricoh', 'TEST', false);
