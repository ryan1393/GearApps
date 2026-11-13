-- Truck Log 1.0.0 baseline schema.
--
-- This single file replaces migrations 001-010 and admin-auth/001 of the 0.1 test builds.
-- It was generated with pg_dump from a PostgreSQL 16 database built by that chain,
-- and tools/truck-log/verify-baseline.mjs proves it creates the same schema and seed
-- data. Two differences are deliberate:
--   * the old runner's checksum row (app_settings.automatic_driver_print_schema_v1)
--     is gone; truck_log_schema_migrations records applied migrations now;
--   * truck_log_admin.schema_version is 'truck-log-admin-v1' (the 0.1 builds used a 0.1 tag).
--
-- Never edit this file once a database has applied it. Add 0002_..., 0003_... instead.
-- Applied by tools/truck-log/migrate.mjs inside one transaction.

SET LOCAL check_function_bodies = false;
SELECT pg_catalog.set_config('search_path', '', true);

-- schema: truck_log_admin

CREATE SCHEMA truck_log_admin;

-- function: public.enforce_driver_print_attempt_transition()

CREATE FUNCTION public.enforce_driver_print_attempt_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  parent_item_type VARCHAR(30);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'driver_print_attempts cannot be deleted';
  END IF;

  IF OLD IS NOT DISTINCT FROM NEW THEN
    RETURN NEW;
  END IF;

  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.item_id IS DISTINCT FROM NEW.item_id
     OR OLD.attempt_number IS DISTINCT FROM NEW.attempt_number
     OR OLD.attempt_kind IS DISTINCT FROM NEW.attempt_kind
     OR OLD.requested_at IS DISTINCT FROM NEW.requested_at
     OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Driver print attempt identity and request snapshot are immutable';
  END IF;

  IF OLD.status IN ('PRINTED', 'FAILED') THEN
    RAISE EXCEPTION 'Completed driver print attempts are immutable';
  END IF;

  IF OLD.status = 'REQUESTED'
     AND NEW.status IN ('LEASED', 'FAILED') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'REQUESTED' AND NEW.status = 'PRINTED' THEN
    SELECT item_type
      INTO parent_item_type
      FROM driver_print_items
     WHERE id = OLD.item_id
     FOR SHARE;
    IF parent_item_type = 'DOCK_ASSIGNMENT' THEN
      RETURN NEW;
    END IF;
  END IF;

  IF OLD.status = 'LEASED'
     AND NEW.status IN ('PRINTED', 'FAILED') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid driver print attempt status transition: % -> %', OLD.status, NEW.status;
END;
$$;

-- function: public.enforce_new_truck_visit_required_fields()

CREATE FUNCTION public.enforce_new_truck_visit_required_fields() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  plant_location TEXT;
BEGIN
  IF NULLIF(BTRIM(NEW.load_number), '') IS NULL THEN
    RAISE EXCEPTION 'Load Number is required for every new truck visit';
  END IF;
  IF NULLIF(BTRIM(NEW.driver_phone), '') IS NULL THEN
    RAISE EXCEPTION 'Driver Phone is required for every new truck visit';
  END IF;
  IF NULLIF(BTRIM(NEW.tractor_id), '') IS NULL THEN
    RAISE EXCEPTION 'Tractor ID is required for every new truck visit';
  END IF;
IF NULLIF(BTRIM(NEW.origin_name), '') IS NULL THEN
    RAISE EXCEPTION 'Origin is required for every new truck visit';
  END IF;
  IF NULLIF(BTRIM(NEW.destination_name), '') IS NULL THEN
    RAISE EXCEPTION 'Destination is required for every new truck visit';
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(value), ''), 'Fort Wayne')
    INTO plant_location
    FROM app_settings
   WHERE key = 'plant_location_name';
  plant_location := COALESCE(plant_location, 'Fort Wayne');

  IF NEW.direction = 'OUTBOUND' AND BTRIM(NEW.origin_name) <> plant_location THEN
    RAISE EXCEPTION 'Outbound Origin must be the configured plant location (%)', plant_location;
  END IF;
  IF NEW.direction = 'INBOUND' AND BTRIM(NEW.destination_name) <> plant_location THEN
    RAISE EXCEPTION 'Inbound Destination must be the configured plant location (%)', plant_location;
  END IF;

  RETURN NEW;
END;
$$;

-- function: public.enforce_rxo_driver_document_version_chain()

CREATE FUNCTION public.enforce_rxo_driver_document_version_chain() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  predecessor visit_documents%ROWTYPE;
BEGIN
  IF NEW.document_type IS DISTINCT FROM 'RXO_DRIVER_DOCUMENT' THEN
    RETURN NEW;
  END IF;

  IF NEW.rxo_document_version = 1 THEN
    IF NEW.supersedes_document_id IS NOT NULL THEN
      RAISE EXCEPTION 'RXO driver-document version 1 cannot supersede another document';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.supersedes_document_id IS NULL THEN
    RAISE EXCEPTION 'RXO driver-document version % requires a predecessor', NEW.rxo_document_version;
  END IF;

  SELECT *
    INTO predecessor
    FROM visit_documents
   WHERE id = NEW.supersedes_document_id
   FOR SHARE;

  IF NOT FOUND
     OR predecessor.document_type IS DISTINCT FROM 'RXO_DRIVER_DOCUMENT'
     OR predecessor.source_kind IS DISTINCT FROM 'MATERIALS_UPLOAD'
     OR predecessor.rxo_site_key IS DISTINCT FROM NEW.rxo_site_key
     OR predecessor.rxo_shipment_id IS DISTINCT FROM NEW.rxo_shipment_id
     OR predecessor.rxo_direction IS DISTINCT FROM NEW.rxo_direction
     OR predecessor.rxo_document_version IS DISTINCT FROM NEW.rxo_document_version - 1
     OR predecessor.rxo_is_active = TRUE
     OR predecessor.superseded_at IS NULL THEN
    RAISE EXCEPTION 'RXO driver-document predecessor must be the immediately prior superseded version for the same shipment';
  END IF;

  RETURN NEW;
END;
$$;

-- function: public.enforce_truck_visit_scheduled_source()

CREATE FUNCTION public.enforce_truck_visit_scheduled_source() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.scheduled_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.load_number IS NULL OR NOT EXISTS (
    SELECT 1
      FROM scheduled_loads s
     WHERE s.active = TRUE
       AND UPPER(s.load_number) = UPPER(NEW.load_number)
       AND s.scheduled_at = NEW.scheduled_at
  ) THEN
    RAISE EXCEPTION 'truck_visits.scheduled_at must come from an active scheduled_loads row for the same load number';
  END IF;

  RETURN NEW;
END;
$$;

-- function: public.normalize_sap_document_association()

CREATE FUNCTION public.normalize_sap_document_association() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.truck_visit_id IS NOT NULL
     AND NEW.truck_visit_id IS NULL
     AND NEW.association_status = 'ASSOCIATED' THEN
    NEW.association_status := 'ORPHANED';
    NEW.association_method := 'VISIT_DETACHED';
    NEW.association_reason := COALESCE(
      NULLIF(BTRIM(NEW.association_reason), ''),
      'Previously associated Truck Log visit was removed or detached.'
    );
    NEW.review_status := 'NEEDS_REVIEW';
    NEW.review_reason := COALESCE(
      NULLIF(BTRIM(NEW.review_reason), ''),
      'The previously associated Truck Log visit is no longer available.'
    );
    NEW.updated_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

-- function: public.protect_automatic_print_attempt()

CREATE FUNCTION public.protect_automatic_print_attempt() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Automatic print attempt history cannot be deleted'; END IF;
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.job_id IS DISTINCT FROM NEW.job_id
    OR OLD.attempt_number IS DISTINCT FROM NEW.attempt_number OR OLD.request_key IS DISTINCT FROM NEW.request_key
    OR OLD.requested_at IS DISTINCT FROM NEW.requested_at THEN RAISE EXCEPTION 'Automatic attempt request is immutable'; END IF;
  IF OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
  IF OLD.status='REQUESTED' AND NEW.status='LEASED' THEN RETURN NEW; END IF;
  IF OLD.status='LEASED' AND NEW.status IN ('PRINTED','FAILED') AND NEW.lease_token_sha256=OLD.lease_token_sha256
     AND NEW.claim_key=OLD.claim_key AND NEW.leased_at=OLD.leased_at THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Invalid automatic print attempt transition';
END; $$;

-- function: public.protect_automatic_print_job()

CREATE FUNCTION public.protect_automatic_print_job() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Automatic print jobs cannot be deleted'; END IF;
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.package_id IS DISTINCT FROM NEW.package_id
     OR OLD.item_type IS DISTINCT FROM NEW.item_type OR OLD.visit_document_id IS DISTINCT FROM NEW.visit_document_id
     OR OLD.pdf_bytes IS DISTINCT FROM NEW.pdf_bytes OR OLD.file_name IS DISTINCT FROM NEW.file_name
     OR OLD.file_size_bytes IS DISTINCT FROM NEW.file_size_bytes OR OLD.sha256 IS DISTINCT FROM NEW.sha256
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN RAISE EXCEPTION 'Automatic print document snapshot is immutable'; END IF;
  IF OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
  IF (OLD.status='QUEUED' AND NEW.status='LEASED' AND NEW.attempt_count=OLD.attempt_count)
     OR (OLD.status='LEASED' AND NEW.status IN ('PRINTED','FAILED') AND NEW.attempt_count=OLD.attempt_count
         AND NEW.lease_token_sha256=OLD.lease_token_sha256 AND NEW.leased_at=OLD.leased_at AND NEW.lease_expires_at=OLD.lease_expires_at)
     OR (OLD.status='FAILED' AND NEW.status='QUEUED' AND NEW.attempt_count=OLD.attempt_count+1) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Invalid automatic print transition: % -> %',OLD.status,NEW.status;
END; $$;

-- function: public.protect_automatic_print_package()

CREATE FUNCTION public.protect_automatic_print_package() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD IS DISTINCT FROM NEW THEN RAISE EXCEPTION 'Automatic print package snapshot cannot be changed or deleted'; END IF;
  RETURN NEW;
END; $$;

-- function: public.protect_driver_print_event_history()

CREATE FUNCTION public.protect_driver_print_event_history() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Permit only PostgreSQL's internal ON DELETE SET NULL update of the visit FK.
  IF TG_OP = 'UPDATE'
     AND pg_trigger_depth() > 1
     AND OLD.id IS NOT DISTINCT FROM NEW.id
     AND OLD.event_type IS NOT DISTINCT FROM NEW.event_type
     AND OLD.occurred_at IS NOT DISTINCT FROM NEW.occurred_at
     AND OLD.actor_type IS NOT DISTINCT FROM NEW.actor_type
     AND OLD.actor_id IS NOT DISTINCT FROM NEW.actor_id
     AND OLD.actor_key_id IS NOT DISTINCT FROM NEW.actor_key_id
     AND OLD.visit_document_id IS NOT DISTINCT FROM NEW.visit_document_id
     AND OLD.package_id IS NOT DISTINCT FROM NEW.package_id
     AND OLD.item_id IS NOT DISTINCT FROM NEW.item_id
     AND OLD.rxo_site_key IS NOT DISTINCT FROM NEW.rxo_site_key
     AND OLD.rxo_shipment_id IS NOT DISTINCT FROM NEW.rxo_shipment_id
     AND OLD.rxo_direction IS NOT DISTINCT FROM NEW.rxo_direction
     AND OLD.document_version IS NOT DISTINCT FROM NEW.document_version
     AND OLD.route IS NOT DISTINCT FROM NEW.route
     AND OLD.printer IS NOT DISTINCT FROM NEW.printer
     AND OLD.error_message IS NOT DISTINCT FROM NEW.error_message
     AND OLD.details IS NOT DISTINCT FROM NEW.details
     AND OLD.created_at IS NOT DISTINCT FROM NEW.created_at
     AND OLD.truck_visit_id IS NOT NULL
     AND NEW.truck_visit_id IS NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'driver_print_events is append-only';
END;
$$;

-- function: public.protect_driver_print_item_snapshot()

CREATE FUNCTION public.protect_driver_print_item_snapshot() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.package_id IS DISTINCT FROM NEW.package_id
     OR OLD.item_type IS DISTINCT FROM NEW.item_type
     OR OLD.visit_document_id IS DISTINCT FROM NEW.visit_document_id
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Driver Print Package item identity and frozen document are immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- function: public.protect_driver_print_package_snapshot()

CREATE FUNCTION public.protect_driver_print_package_snapshot() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.truck_visit_id IS DISTINCT FROM NEW.truck_visit_id
     OR OLD.request_kind IS DISTINCT FROM NEW.request_kind
     OR OLD.frozen_document_id IS DISTINCT FROM NEW.frozen_document_id
     OR OLD.requested_by IS DISTINCT FROM NEW.requested_by
     OR OLD.requested_by_key_id IS DISTINCT FROM NEW.requested_by_key_id
     OR OLD.requested_at IS DISTINCT FROM NEW.requested_at
     OR OLD.request_id IS DISTINCT FROM NEW.request_id
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Driver Print Package request and frozen document snapshot are immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- function: public.protect_rxo_driver_document_immutable_fields()

CREATE FUNCTION public.protect_rxo_driver_document_immutable_fields() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.document_type = 'RXO_DRIVER_DOCUMENT' THEN
      RAISE EXCEPTION 'RXO driver-document history cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.document_type = 'RXO_DRIVER_DOCUMENT'
     OR NEW.document_type = 'RXO_DRIVER_DOCUMENT' THEN
    IF OLD.document_type IS DISTINCT FROM NEW.document_type
       OR OLD.source_kind IS DISTINCT FROM NEW.source_kind
       OR OLD.sap_document_type_code IS DISTINCT FROM NEW.sap_document_type_code
       OR OLD.file_name IS DISTINCT FROM NEW.file_name
       OR OLD.original_file_name IS DISTINCT FROM NEW.original_file_name
       OR OLD.stored_file_name IS DISTINCT FROM NEW.stored_file_name
       OR OLD.relative_path IS DISTINCT FROM NEW.relative_path
       OR OLD.mime_type IS DISTINCT FROM NEW.mime_type
       OR OLD.file_size_bytes IS DISTINCT FROM NEW.file_size_bytes
       OR OLD.sha256 IS DISTINCT FROM NEW.sha256
       OR OLD.rxo_site_key IS DISTINCT FROM NEW.rxo_site_key
       OR OLD.rxo_shipment_id IS DISTINCT FROM NEW.rxo_shipment_id
       OR OLD.rxo_direction IS DISTINCT FROM NEW.rxo_direction
       OR OLD.rxo_document_version IS DISTINCT FROM NEW.rxo_document_version
       OR OLD.uploaded_by_key_id IS DISTINCT FROM NEW.uploaded_by_key_id
       OR OLD.captured_at IS DISTINCT FROM NEW.captured_at
       OR OLD.scanned_at IS DISTINCT FROM NEW.scanned_at
       OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
      RAISE EXCEPTION 'RXO driver-document file, hash, version, owner, uploader, and upload timestamps are immutable';
    END IF;

    IF OLD.rxo_is_active = FALSE AND NEW.rxo_is_active = TRUE THEN
      RAISE EXCEPTION 'A superseded RXO driver-document version cannot become active again';
    END IF;

    IF OLD.truck_visit_id IS NOT NULL
       AND OLD.truck_visit_id IS DISTINCT FROM NEW.truck_visit_id THEN
      RAISE EXCEPTION 'An associated RXO driver-document version cannot be moved to another visit';
    END IF;

    IF OLD.associated_at IS NOT NULL
       AND (
         OLD.associated_at IS DISTINCT FROM NEW.associated_at
         OR OLD.associated_by IS DISTINCT FROM NEW.associated_by
         OR OLD.association_method IS DISTINCT FROM NEW.association_method
         OR OLD.association_reason IS DISTINCT FROM NEW.association_reason
       ) THEN
      RAISE EXCEPTION 'RXO driver-document association history is immutable once recorded';
    END IF;

    IF OLD.superseded_at IS NOT NULL
       AND OLD.superseded_at IS DISTINCT FROM NEW.superseded_at THEN
      RAISE EXCEPTION 'RXO driver-document supersession history is immutable once recorded';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- function: public.protect_sap_document_event_history()

CREATE FUNCTION public.protect_sap_document_event_history() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND pg_trigger_depth() > 1
     AND OLD.id IS NOT DISTINCT FROM NEW.id
     AND OLD.visit_document_id IS NOT DISTINCT FROM NEW.visit_document_id
     AND OLD.event_type IS NOT DISTINCT FROM NEW.event_type
     AND OLD.occurred_at IS NOT DISTINCT FROM NEW.occurred_at
     AND OLD.actor_type IS NOT DISTINCT FROM NEW.actor_type
     AND OLD.actor_id IS NOT DISTINCT FROM NEW.actor_id
     AND OLD.reason IS NOT DISTINCT FROM NEW.reason
     AND OLD.details IS NOT DISTINCT FROM NEW.details
     AND OLD.created_at IS NOT DISTINCT FROM NEW.created_at
     AND (
       OLD.from_visit_id IS NOT DISTINCT FROM NEW.from_visit_id
       OR (OLD.from_visit_id IS NOT NULL AND NEW.from_visit_id IS NULL)
     )
     AND (
       OLD.to_visit_id IS NOT DISTINCT FROM NEW.to_visit_id
       OR (OLD.to_visit_id IS NOT NULL AND NEW.to_visit_id IS NULL)
     ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'sap_document_events is append-only';
END;
$$;

-- function: public.protect_truck_visit_rxo_identity()

CREATE FUNCTION public.protect_truck_visit_rxo_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.client_request_id IS NOT NULL
     AND OLD.client_request_id IS DISTINCT FROM NEW.client_request_id THEN
    RAISE EXCEPTION 'Truck Log client request identity is immutable once recorded';
  END IF;

  IF OLD.rxo_site_key IS NOT NULL
     AND (
       OLD.rxo_site_key IS DISTINCT FROM NEW.rxo_site_key
       OR OLD.rxo_shipment_id IS DISTINCT FROM NEW.rxo_shipment_id
       OR OLD.rxo_direction IS DISTINCT FROM NEW.rxo_direction
     ) THEN
    RAISE EXCEPTION 'An RXO-linked visit cannot be reassigned to another shipment tuple';
  END IF;

  RETURN NEW;
END;
$$;

-- function: public.validate_automatic_print_document()

CREATE FUNCTION public.validate_automatic_print_document() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v INTEGER; d visit_documents%ROWTYPE;
BEGIN
  SELECT truck_visit_id INTO v FROM automatic_driver_print_packages WHERE id=NEW.package_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Automatic print package missing'; END IF;
  IF NEW.item_type='RXO_DOCUMENT' THEN
    SELECT * INTO d FROM visit_documents WHERE id=NEW.visit_document_id FOR SHARE;
    IF NOT FOUND OR d.truck_visit_id IS DISTINCT FROM v OR d.document_type IS DISTINCT FROM 'RXO_DRIVER_DOCUMENT'
       OR d.source_kind IS DISTINCT FROM 'MATERIALS_UPLOAD' OR d.mime_type IS DISTINCT FROM 'application/pdf'
       OR d.storage_status IS DISTINCT FROM 'STORED' OR d.sha256 IS DISTINCT FROM NEW.sha256
       OR d.file_size_bytes IS DISTINCT FROM NEW.file_size_bytes::bigint OR d.file_name IS DISTINCT FROM NEW.file_name
    THEN RAISE EXCEPTION 'Automatic RXO item must freeze the exact associated immutable document'; END IF;
  END IF;
  RETURN NEW;
END; $$;

-- function: public.validate_driver_print_item_document()

CREATE FUNCTION public.validate_driver_print_item_document() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  package driver_print_packages%ROWTYPE;
BEGIN
  SELECT *
    INTO package
    FROM driver_print_packages
   WHERE id = NEW.package_id
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Driver Print Package % does not exist', NEW.package_id;
  END IF;

  IF NEW.item_type = 'DOCK_ASSIGNMENT' AND NEW.visit_document_id IS NOT NULL THEN
    RAISE EXCEPTION 'Dock Assignment print items cannot reference an RXO document';
  END IF;

  IF NEW.item_type = 'RXO_DOCUMENT'
     AND NEW.visit_document_id IS DISTINCT FROM package.frozen_document_id THEN
    RAISE EXCEPTION 'RXO print item must reference the package frozen document version';
  END IF;

  RETURN NEW;
END;
$$;

-- function: public.validate_driver_print_package_document()

CREATE FUNCTION public.validate_driver_print_package_document() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  frozen visit_documents%ROWTYPE;
BEGIN
  IF NEW.frozen_document_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
    INTO frozen
    FROM visit_documents
   WHERE id = NEW.frozen_document_id
   FOR SHARE;

  IF NOT FOUND
     OR frozen.document_type IS DISTINCT FROM 'RXO_DRIVER_DOCUMENT'
     OR frozen.source_kind IS DISTINCT FROM 'MATERIALS_UPLOAD'
     OR frozen.storage_status IS DISTINCT FROM 'STORED'
     OR frozen.truck_visit_id IS DISTINCT FROM NEW.truck_visit_id
     OR frozen.association_status IS DISTINCT FROM 'ASSOCIATED'
     OR (NEW.request_kind = 'ORIGINAL' AND frozen.rxo_is_active IS DISTINCT FROM TRUE) THEN
    RAISE EXCEPTION 'Frozen RXO document must be a stored document associated with the package visit';
  END IF;

  RETURN NEW;
END;
$$;

-- function: public.validate_rxo_driver_document_visit_association()

CREATE FUNCTION public.validate_rxo_driver_document_visit_association() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  associated_visit truck_visits%ROWTYPE;
BEGIN
  IF NEW.document_type IS DISTINCT FROM 'RXO_DRIVER_DOCUMENT'
     OR NEW.truck_visit_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
    INTO associated_visit
    FROM truck_visits
   WHERE id = NEW.truck_visit_id
   FOR KEY SHARE;

  IF NOT FOUND
     OR associated_visit.rxo_site_key IS DISTINCT FROM NEW.rxo_site_key
     OR associated_visit.rxo_shipment_id IS DISTINCT FROM NEW.rxo_shipment_id
     OR associated_visit.rxo_direction IS DISTINCT FROM NEW.rxo_direction THEN
    RAISE EXCEPTION 'RXO driver document and Truck Log visit must share the exact shipment tuple';
  END IF;

  RETURN NEW;
END;
$$;

-- table: public.app_settings

CREATE TABLE public.app_settings (
    key character varying(120) NOT NULL,
    value text,
    description character varying(400),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- table: public.automatic_driver_print_attempts

CREATE TABLE public.automatic_driver_print_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    request_key character varying(128) NOT NULL,
    status character varying(30) DEFAULT 'REQUESTED'::character varying NOT NULL,
    lease_token_sha256 character varying(64),
    claim_key character varying(128),
    result_key character varying(128),
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    leased_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_message text,
    CONSTRAINT automatic_driver_print_attempts_attempt_number_check CHECK ((attempt_number > 0)),
    CONSTRAINT automatic_driver_print_attempts_request_key_check CHECK (((request_key)::text ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$'::text)),
    CONSTRAINT automatic_driver_print_attempts_status_check CHECK (((status)::text = ANY ((ARRAY['REQUESTED'::character varying, 'LEASED'::character varying, 'PRINTED'::character varying, 'FAILED'::character varying])::text[]))),
    CONSTRAINT ck_auto_attempt_state CHECK (((((status)::text = 'REQUESTED'::text) AND (completed_at IS NULL) AND (leased_at IS NULL)) OR (((status)::text = 'LEASED'::text) AND (completed_at IS NULL) AND (leased_at IS NOT NULL) AND (lease_token_sha256 IS NOT NULL)) OR (((status)::text = 'PRINTED'::text) AND (completed_at IS NOT NULL) AND (error_message IS NULL)) OR (((status)::text = 'FAILED'::text) AND (completed_at IS NOT NULL) AND (NULLIF(btrim(error_message), ''::text) IS NOT NULL))))
);

-- table: public.automatic_driver_print_jobs

CREATE TABLE public.automatic_driver_print_jobs (
    id uuid NOT NULL,
    package_id uuid NOT NULL,
    item_type character varying(30) NOT NULL,
    visit_document_id integer,
    pdf_bytes bytea,
    file_name character varying(255) NOT NULL,
    file_size_bytes integer NOT NULL,
    sha256 character varying(64) NOT NULL,
    status character varying(30) DEFAULT 'QUEUED'::character varying NOT NULL,
    attempt_count integer DEFAULT 1 NOT NULL,
    lease_token_sha256 character varying(64),
    leased_at timestamp with time zone,
    lease_expires_at timestamp with time zone,
    last_error text,
    printed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT automatic_driver_print_jobs_attempt_count_check CHECK ((attempt_count > 0)),
    CONSTRAINT automatic_driver_print_jobs_file_size_bytes_check CHECK (((file_size_bytes > 8) AND (file_size_bytes <= 26214400))),
    CONSTRAINT automatic_driver_print_jobs_item_type_check CHECK (((item_type)::text = ANY ((ARRAY['DOCK_ASSIGNMENT'::character varying, 'RXO_DOCUMENT'::character varying])::text[]))),
    CONSTRAINT automatic_driver_print_jobs_sha256_check CHECK (((sha256)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT automatic_driver_print_jobs_status_check CHECK (((status)::text = ANY ((ARRAY['QUEUED'::character varying, 'LEASED'::character varying, 'PRINTED'::character varying, 'FAILED'::character varying])::text[]))),
    CONSTRAINT ck_auto_job_document CHECK (((((item_type)::text = 'DOCK_ASSIGNMENT'::text) AND (visit_document_id IS NULL) AND (pdf_bytes IS NOT NULL) AND (octet_length(pdf_bytes) = file_size_bytes) AND (file_size_bytes <= 1048576)) OR (((item_type)::text = 'RXO_DOCUMENT'::text) AND (visit_document_id IS NOT NULL) AND (pdf_bytes IS NULL)))),
    CONSTRAINT ck_auto_job_lease CHECK ((((lease_token_sha256 IS NULL) AND (leased_at IS NULL) AND (lease_expires_at IS NULL)) OR ((lease_token_sha256 IS NOT NULL) AND ((lease_token_sha256)::text ~ '^[0-9a-f]{64}$'::text) AND (leased_at IS NOT NULL) AND (lease_expires_at IS NOT NULL) AND (lease_expires_at > leased_at)))),
    CONSTRAINT ck_auto_job_status CHECK (((((status)::text = 'QUEUED'::text) AND (lease_token_sha256 IS NULL) AND (last_error IS NULL) AND (printed_at IS NULL)) OR (((status)::text = 'LEASED'::text) AND (lease_token_sha256 IS NOT NULL) AND (printed_at IS NULL) AND (last_error IS NULL)) OR (((status)::text = 'PRINTED'::text) AND (lease_token_sha256 IS NOT NULL) AND (printed_at IS NOT NULL) AND (last_error IS NULL)) OR (((status)::text = 'FAILED'::text) AND (NULLIF(btrim(last_error), ''::text) IS NOT NULL))))
);

-- table: public.automatic_driver_print_packages

CREATE TABLE public.automatic_driver_print_packages (
    id uuid NOT NULL,
    truck_visit_id integer NOT NULL,
    gate character varying(4) NOT NULL,
    agent_id character varying(120) NOT NULL,
    route character varying(120) NOT NULL,
    printer character varying(255) NOT NULL,
    requested_by character varying(120) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    request_kind character varying(10) DEFAULT 'ORIGINAL'::character varying NOT NULL,
    original_package_id uuid,
    request_key character varying(128),
    request_sha256 character varying(64),
    CONSTRAINT automatic_driver_print_packages_check CHECK (((((request_kind)::text = 'ORIGINAL'::text) AND (original_package_id IS NULL) AND (request_key IS NULL) AND (request_sha256 IS NULL)) OR (((request_kind)::text = 'REPRINT'::text) AND (original_package_id IS NOT NULL) AND (request_key IS NOT NULL) AND (request_sha256 IS NOT NULL) AND ((request_sha256)::text ~ '^[0-9a-f]{64}$'::text)))),
    CONSTRAINT automatic_driver_print_packages_gate_check CHECK (((gate)::text = ANY ((ARRAY['EAST'::character varying, 'WEST'::character varying])::text[]))),
    CONSTRAINT automatic_driver_print_packages_printer_check CHECK ((length(btrim((printer)::text)) > 0)),
    CONSTRAINT automatic_driver_print_packages_request_kind_check CHECK (((request_kind)::text = ANY ((ARRAY['ORIGINAL'::character varying, 'REPRINT'::character varying])::text[]))),
    CONSTRAINT automatic_driver_print_packages_route_check CHECK ((length(btrim((route)::text)) > 0))
);

-- table: public.driver_print_items

CREATE TABLE public.driver_print_items (
    id uuid NOT NULL,
    package_id uuid NOT NULL,
    item_type character varying(30) NOT NULL,
    visit_document_id integer,
    status character varying(30) NOT NULL,
    route character varying(120),
    printer character varying(255),
    assigned_agent_id character varying(120),
    lease_token_sha256 character varying(64),
    leased_at timestamp with time zone,
    lease_expires_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_error text,
    printed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_driver_print_items_attempt_count CHECK ((attempt_count >= 0)),
    CONSTRAINT ck_driver_print_items_document CHECK (((((item_type)::text = 'DOCK_ASSIGNMENT'::text) AND (visit_document_id IS NULL)) OR (((item_type)::text = 'RXO_DOCUMENT'::text) AND (visit_document_id IS NOT NULL)))),
    CONSTRAINT ck_driver_print_items_failed CHECK ((((status)::text <> 'FAILED'::text) OR (NULLIF(btrim(last_error), ''::text) IS NOT NULL))),
    CONSTRAINT ck_driver_print_items_lease CHECK ((((lease_token_sha256 IS NULL) AND (leased_at IS NULL) AND (lease_expires_at IS NULL)) OR (((lease_token_sha256)::text ~ '^[0-9a-f]{64}$'::text) AND (leased_at IS NOT NULL) AND (lease_expires_at > leased_at)))),
    CONSTRAINT ck_driver_print_items_leased_status CHECK ((((status)::text <> 'LEASED'::text) OR ((assigned_agent_id IS NOT NULL) AND (lease_token_sha256 IS NOT NULL) AND (leased_at IS NOT NULL) AND (lease_expires_at IS NOT NULL)))),
    CONSTRAINT ck_driver_print_items_printed CHECK ((((status)::text <> 'PRINTED'::text) OR ((printed_at IS NOT NULL) AND (last_error IS NULL)))),
    CONSTRAINT ck_driver_print_items_server_routing CHECK ((((item_type)::text <> 'RXO_DOCUMENT'::text) OR ((status)::text = 'FAILED'::text) OR ((NULLIF(btrim((route)::text), ''::text) IS NOT NULL) AND (NULLIF(btrim((printer)::text), ''::text) IS NOT NULL) AND (assigned_agent_id IS NOT NULL)))),
    CONSTRAINT ck_driver_print_items_status CHECK (((status)::text = ANY ((ARRAY['PENDING_CONFIRMATION'::character varying, 'QUEUED'::character varying, 'LEASED'::character varying, 'PRINTED'::character varying, 'FAILED'::character varying])::text[]))),
    CONSTRAINT ck_driver_print_items_type CHECK (((item_type)::text = ANY ((ARRAY['DOCK_ASSIGNMENT'::character varying, 'RXO_DOCUMENT'::character varying])::text[]))),
    CONSTRAINT ck_driver_print_items_type_status CHECK (((((item_type)::text = 'DOCK_ASSIGNMENT'::text) AND ((status)::text = ANY ((ARRAY['PENDING_CONFIRMATION'::character varying, 'PRINTED'::character varying, 'FAILED'::character varying])::text[]))) OR (((item_type)::text = 'RXO_DOCUMENT'::text) AND ((status)::text = ANY ((ARRAY['QUEUED'::character varying, 'LEASED'::character varying, 'PRINTED'::character varying, 'FAILED'::character varying])::text[])))))
);

-- table: public.driver_print_packages

CREATE TABLE public.driver_print_packages (
    id uuid NOT NULL,
    truck_visit_id integer NOT NULL,
    request_kind character varying(20) NOT NULL,
    frozen_document_id integer,
    requested_by character varying(120),
    requested_by_key_id character varying(16),
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(30) DEFAULT 'REQUESTED'::character varying NOT NULL,
    request_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_driver_print_packages_reprint_actor CHECK ((((request_kind)::text <> 'REPRINT'::text) OR ((NULLIF(btrim((requested_by)::text), ''::text) IS NOT NULL) AND (requested_by_key_id IS NOT NULL)))),
    CONSTRAINT ck_driver_print_packages_reprint_document CHECK ((((request_kind)::text <> 'REPRINT'::text) OR (frozen_document_id IS NOT NULL))),
    CONSTRAINT ck_driver_print_packages_request_kind CHECK (((request_kind)::text = ANY ((ARRAY['ORIGINAL'::character varying, 'REPRINT'::character varying])::text[]))),
    CONSTRAINT ck_driver_print_packages_requested_by CHECK (((requested_by IS NULL) OR (NULLIF(btrim((requested_by)::text), ''::text) IS NOT NULL))),
    CONSTRAINT ck_driver_print_packages_status CHECK (((status)::text = ANY ((ARRAY['REQUESTED'::character varying, 'IN_PROGRESS'::character varying, 'COMPLETED'::character varying, 'PARTIAL_FAILURE'::character varying, 'FAILED'::character varying])::text[])))
);

-- view: public.automatic_driver_print_history_v1

CREATE VIEW public.automatic_driver_print_history_v1 AS
 SELECT item.id,
    item.item_type,
    item.visit_document_id,
    item.status,
    item.last_error,
    item.route,
    item.printer,
    item.assigned_agent_id,
    item.created_at,
    item.updated_at,
    item.printed_at
   FROM (public.driver_print_items item
     JOIN public.driver_print_packages package ON ((package.id = item.package_id)))
  WHERE ((package.request_kind)::text = 'ORIGINAL'::text)
UNION ALL
 SELECT job.id,
    job.item_type,
    job.visit_document_id,
    job.status,
    job.last_error,
    packet.route,
    packet.printer,
    packet.agent_id AS assigned_agent_id,
    job.created_at,
    job.updated_at,
    ( SELECT max(attempt.completed_at) AS max
           FROM public.automatic_driver_print_attempts attempt
          WHERE ((attempt.job_id = job.id) AND ((attempt.status)::text = 'PRINTED'::text))) AS printed_at
   FROM (public.automatic_driver_print_jobs job
     JOIN public.automatic_driver_print_packages packet ON ((packet.id = job.package_id)))
  WHERE ((packet.request_kind)::text = 'ORIGINAL'::text);

-- table: public.carriers

CREATE TABLE public.carriers (
    id integer NOT NULL,
    name character varying(200) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- sequence: public.carriers_id_seq

CREATE SEQUENCE public.carriers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.carriers_id_seq OWNED BY public.carriers.id;

-- table: public.docks

CREATE TABLE public.docks (
    id integer NOT NULL,
    code character varying(50) NOT NULL,
    description character varying(200),
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- sequence: public.docks_id_seq

CREATE SEQUENCE public.docks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.docks_id_seq OWNED BY public.docks.id;

-- table: public.driver_print_attempts

CREATE TABLE public.driver_print_attempts (
    id uuid NOT NULL,
    item_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    attempt_kind character varying(20) NOT NULL,
    status character varying(20) NOT NULL,
    agent_id character varying(120),
    route character varying(120),
    printer character varying(255),
    lease_token_sha256 character varying(64),
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    leased_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_message text,
    idempotency_key character varying(128) NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_driver_print_attempts_details CHECK ((jsonb_typeof(details) = 'object'::text)),
    CONSTRAINT ck_driver_print_attempts_idempotency CHECK (((idempotency_key)::text ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$'::text)),
    CONSTRAINT ck_driver_print_attempts_kind CHECK (((attempt_kind)::text = ANY ((ARRAY['ORIGINAL'::character varying, 'RETRY'::character varying, 'REPRINT'::character varying, 'CONFIRMATION'::character varying])::text[]))),
    CONSTRAINT ck_driver_print_attempts_lease_hash CHECK (((lease_token_sha256 IS NULL) OR ((lease_token_sha256)::text ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT ck_driver_print_attempts_number CHECK ((attempt_number > 0)),
    CONSTRAINT ck_driver_print_attempts_state CHECK (((((status)::text = 'REQUESTED'::text) AND (completed_at IS NULL)) OR (((status)::text = 'LEASED'::text) AND (agent_id IS NOT NULL) AND (lease_token_sha256 IS NOT NULL) AND (leased_at IS NOT NULL) AND (completed_at IS NULL)) OR (((status)::text = 'PRINTED'::text) AND (completed_at IS NOT NULL) AND (error_message IS NULL)) OR (((status)::text = 'FAILED'::text) AND (completed_at IS NOT NULL) AND (NULLIF(btrim(error_message), ''::text) IS NOT NULL)))),
    CONSTRAINT ck_driver_print_attempts_status CHECK (((status)::text = ANY ((ARRAY['REQUESTED'::character varying, 'LEASED'::character varying, 'PRINTED'::character varying, 'FAILED'::character varying])::text[])))
);

-- table: public.driver_print_events

CREATE TABLE public.driver_print_events (
    id bigint NOT NULL,
    event_type character varying(60) NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_type character varying(40) NOT NULL,
    actor_id character varying(120) NOT NULL,
    actor_key_id character varying(16),
    truck_visit_id integer,
    visit_document_id integer,
    package_id uuid,
    item_id uuid,
    rxo_site_key character varying(80),
    rxo_shipment_id character varying(120),
    rxo_direction character varying(20),
    document_version integer,
    route character varying(120),
    printer character varying(255),
    error_message text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_driver_print_events_actor_id CHECK ((NULLIF(btrim((actor_id)::text), ''::text) IS NOT NULL)),
    CONSTRAINT ck_driver_print_events_actor_type CHECK (((actor_type)::text = ANY ((ARRAY['HUMAN'::character varying, 'PRINT_AGENT'::character varying, 'SYSTEM'::character varying])::text[]))),
    CONSTRAINT ck_driver_print_events_details CHECK ((jsonb_typeof(details) = 'object'::text)),
    CONSTRAINT ck_driver_print_events_document_metadata CHECK ((((event_type)::text <> ALL ((ARRAY['RXO_DOCUMENT_UPLOADED'::character varying, 'RXO_DOCUMENT_REPLACED'::character varying, 'RXO_DOCUMENT_SUPERSEDED'::character varying, 'RXO_DOCUMENT_ASSOCIATED_TO_VISIT'::character varying, 'RXO_DOCUMENT_PRINTED'::character varying, 'RXO_DOCUMENT_PRINT_FAILED'::character varying, 'RXO_DOCUMENT_PRINT_RETRIED'::character varying, 'RXO_DOCUMENT_REPRINTED'::character varying])::text[])) OR (visit_document_id IS NOT NULL))),
    CONSTRAINT ck_driver_print_events_failure_error CHECK ((((event_type)::text <> ALL ((ARRAY['DOCK_ASSIGNMENT_PRINT_FAILED'::character varying, 'RXO_DOCUMENT_PRINT_FAILED'::character varying])::text[])) OR (NULLIF(btrim(error_message), ''::text) IS NOT NULL))),
    CONSTRAINT ck_driver_print_events_item_metadata CHECK ((((event_type)::text <> ALL ((ARRAY['DOCK_ASSIGNMENT_PRINTED'::character varying, 'DOCK_ASSIGNMENT_PRINT_FAILED'::character varying, 'DOCK_ASSIGNMENT_PRINT_RETRIED'::character varying, 'RXO_DOCUMENT_PRINTED'::character varying, 'RXO_DOCUMENT_PRINT_FAILED'::character varying, 'RXO_DOCUMENT_PRINT_RETRIED'::character varying, 'RXO_DOCUMENT_REPRINTED'::character varying])::text[])) OR (item_id IS NOT NULL))),
    CONSTRAINT ck_driver_print_events_package_metadata CHECK ((((event_type)::text <> 'DRIVER_PRINT_PACKAGE_REQUESTED'::text) OR (package_id IS NOT NULL))),
    CONSTRAINT ck_driver_print_events_rxo_tuple CHECK ((((rxo_site_key IS NULL) AND (rxo_shipment_id IS NULL) AND (rxo_direction IS NULL) AND (document_version IS NULL)) OR ((NULLIF(btrim((rxo_site_key)::text), ''::text) IS NOT NULL) AND (NULLIF(btrim((rxo_shipment_id)::text), ''::text) IS NOT NULL) AND (rxo_direction IS NOT NULL) AND ((rxo_direction)::text = ANY ((ARRAY['INBOUND'::character varying, 'OUTBOUND'::character varying])::text[])) AND (document_version IS NOT NULL) AND (document_version > 0)))),
    CONSTRAINT ck_driver_print_events_type CHECK (((event_type)::text = ANY ((ARRAY['RXO_DOCUMENT_UPLOADED'::character varying, 'RXO_DOCUMENT_REPLACED'::character varying, 'RXO_DOCUMENT_SUPERSEDED'::character varying, 'RXO_DOCUMENT_ASSOCIATED_TO_VISIT'::character varying, 'DRIVER_PRINT_PACKAGE_REQUESTED'::character varying, 'DOCK_ASSIGNMENT_PRINTED'::character varying, 'DOCK_ASSIGNMENT_PRINT_FAILED'::character varying, 'DOCK_ASSIGNMENT_PRINT_RETRIED'::character varying, 'RXO_DOCUMENT_PRINTED'::character varying, 'RXO_DOCUMENT_PRINT_FAILED'::character varying, 'RXO_DOCUMENT_PRINT_RETRIED'::character varying, 'RXO_DOCUMENT_REPRINTED'::character varying])::text[])))
);

-- sequence: public.driver_print_events_id_seq

CREATE SEQUENCE public.driver_print_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.driver_print_events_id_seq OWNED BY public.driver_print_events.id;

-- table: public.drivers

CREATE TABLE public.drivers (
    id integer NOT NULL,
    name character varying(200) NOT NULL,
    phone_number character varying(50),
    active boolean DEFAULT true NOT NULL,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- sequence: public.drivers_id_seq

CREATE SEQUENCE public.drivers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.drivers_id_seq OWNED BY public.drivers.id;

-- table: public.locations

CREATE TABLE public.locations (
    id integer NOT NULL,
    name character varying(250) NOT NULL,
    address_line1 character varying(250),
    city character varying(120),
    state character varying(80),
    postal_code character varying(30),
    country character varying(120),
    active boolean DEFAULT true NOT NULL,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- sequence: public.locations_id_seq

CREATE SEQUENCE public.locations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.locations_id_seq OWNED BY public.locations.id;

-- table: public.print_agent_credentials

CREATE TABLE public.print_agent_credentials (
    key_id character varying(16) NOT NULL,
    agent_id character varying(120) NOT NULL,
    secret_sha256 character varying(64) NOT NULL,
    scopes jsonb DEFAULT '["heartbeat"]'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    CONSTRAINT ck_print_agent_credentials_hash CHECK (((secret_sha256)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_print_agent_credentials_key_id CHECK (((key_id)::text ~ '^[0-9a-f]{16}$'::text)),
    CONSTRAINT ck_print_agent_credentials_revocation CHECK ((((active = true) AND (revoked_at IS NULL)) OR (active = false))),
    CONSTRAINT ck_print_agent_credentials_scopes CHECK ((jsonb_typeof(scopes) = 'array'::text))
);

-- table: public.print_agent_idempotency

CREATE TABLE public.print_agent_idempotency (
    agent_id character varying(120) NOT NULL,
    idempotency_key character varying(128) NOT NULL,
    request_sha256 character varying(64) NOT NULL,
    response_status integer NOT NULL,
    response_body jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    CONSTRAINT ck_print_agent_idempotency_body CHECK ((jsonb_typeof(response_body) = 'object'::text)),
    CONSTRAINT ck_print_agent_idempotency_expiry CHECK ((expires_at > created_at)),
    CONSTRAINT ck_print_agent_idempotency_hash CHECK (((request_sha256)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_print_agent_idempotency_key CHECK (((idempotency_key)::text ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$'::text)),
    CONSTRAINT ck_print_agent_idempotency_no_claim_token CHECK ((NOT COALESCE(((response_body -> 'job'::text) ? 'claimToken'::text), false))),
    CONSTRAINT ck_print_agent_idempotency_status CHECK (((response_status >= 200) AND (response_status <= 599)))
);

-- table: public.print_agents

CREATE TABLE public.print_agents (
    agent_id character varying(120) NOT NULL,
    display_name character varying(160) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone,
    agent_version character varying(80),
    configured_routes jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_successful_capture_at timestamp with time zone,
    last_successful_print_at timestamp with time zone,
    last_error_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_print_agents_error_pair CHECK (((last_error IS NULL) OR (last_error_at IS NOT NULL))),
    CONSTRAINT ck_print_agents_id CHECK (((agent_id)::text ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$'::text)),
    CONSTRAINT ck_print_agents_name CHECK ((NULLIF(btrim((display_name)::text), ''::text) IS NOT NULL)),
    CONSTRAINT ck_print_agents_routes CHECK ((jsonb_typeof(configured_routes) = 'array'::text))
);

-- table: public.rxo_expedite_import_batches

CREATE TABLE public.rxo_expedite_import_batches (
    source_batch_id character varying(128) NOT NULL,
    source_completed_at timestamp with time zone NOT NULL,
    source_sha256 character varying(64) NOT NULL,
    status character varying(20) NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    linked_order_rows integer DEFAULT 0 NOT NULL,
    error_message text,
    imported_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rxo_expedite_import_batches_linked_order_rows_check CHECK ((linked_order_rows >= 0)),
    CONSTRAINT rxo_expedite_import_batches_row_count_check CHECK (((row_count >= 0) AND (row_count <= 50000))),
    CONSTRAINT rxo_expedite_import_batches_source_sha256_check CHECK (((source_sha256)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT rxo_expedite_import_batches_status_check CHECK (((status)::text = ANY ((ARRAY['IMPORTING'::character varying, 'COMPLETE'::character varying, 'FAILED'::character varying])::text[])))
);

-- table: public.rxo_expedite_shipment_snapshots

CREATE TABLE public.rxo_expedite_shipment_snapshots (
    id bigint NOT NULL,
    source_batch_id character varying(128) NOT NULL,
    shipment_id character varying(128) NOT NULL,
    direction character varying(20) DEFAULT 'UNKNOWN'::character varying NOT NULL,
    critical boolean,
    auth_code text,
    origin_name text,
    origin text,
    destination text,
    scac text,
    commodity text,
    mode text,
    current_location text,
    next_stop text,
    eta_next_stop jsonb,
    eta_status text,
    raw_row jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rxo_expedite_shipment_snapshots_direction_check CHECK (((direction)::text = ANY ((ARRAY['INBOUND'::character varying, 'OUTBOUND'::character varying, 'UNKNOWN'::character varying])::text[])))
);

-- sequence: public.rxo_expedite_shipment_snapshots_id_seq

CREATE SEQUENCE public.rxo_expedite_shipment_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.rxo_expedite_shipment_snapshots_id_seq OWNED BY public.rxo_expedite_shipment_snapshots.id;

-- table: public.rxo_freight_visibility

CREATE TABLE public.rxo_freight_visibility (
    id integer NOT NULL,
    site_key character varying(80) NOT NULL,
    shipment_id character varying(120) NOT NULL,
    direction character varying(20) NOT NULL,
    status character varying(120),
    eta_status character varying(120),
    mode character varying(80),
    carrier_name character varying(300),
    first_stop_address text,
    last_stop_address text,
    pickup_estimated_arrival_raw character varying(200),
    pickup_appointment_arrival_raw character varying(200),
    delivery_estimated_arrival_raw character varying(200),
    delivery_appointment_arrival_raw character varying(200),
    plant_scheduled_at timestamp with time zone,
    pro_number character varying(200),
    trailer_number character varying(200),
    source_batch_id character varying(80) NOT NULL,
    visible_in_latest boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    raw_row jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_rxo_freight_visibility_direction CHECK (((direction)::text = ANY ((ARRAY['INBOUND'::character varying, 'OUTBOUND'::character varying])::text[])))
);

-- sequence: public.rxo_freight_visibility_id_seq

CREATE SEQUENCE public.rxo_freight_visibility_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.rxo_freight_visibility_id_seq OWNED BY public.rxo_freight_visibility.id;

-- table: public.rxo_import_batches

CREATE TABLE public.rxo_import_batches (
    id integer NOT NULL,
    source_batch_id character varying(80) NOT NULL,
    source_manifest_version character varying(40),
    source_completed_at timestamp with time zone,
    site_key character varying(80) NOT NULL,
    site_name character varying(200) NOT NULL,
    status character varying(30) NOT NULL,
    dataset_count integer DEFAULT 0 NOT NULL,
    order_rows integer DEFAULT 0 NOT NULL,
    shipment_rows integer DEFAULT 0 NOT NULL,
    freight_rows integer DEFAULT 0 NOT NULL,
    linked_order_rows integer DEFAULT 0 NOT NULL,
    scheduled_load_rows integer DEFAULT 0 NOT NULL,
    deactivated_scheduled_load_rows integer DEFAULT 0 NOT NULL,
    dataset_summary jsonb DEFAULT '[]'::jsonb NOT NULL,
    boundary_sha256 character varying(64),
    error_message text,
    imported_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_rxo_import_batches_status CHECK (((status)::text = ANY ((ARRAY['IMPORTING'::character varying, 'COMPLETE'::character varying, 'FAILED'::character varying])::text[])))
);

-- sequence: public.rxo_import_batches_id_seq

CREATE SEQUENCE public.rxo_import_batches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.rxo_import_batches_id_seq OWNED BY public.rxo_import_batches.id;

-- table: public.rxo_order_shipment_links

CREATE TABLE public.rxo_order_shipment_links (
    id integer NOT NULL,
    site_key character varying(80) NOT NULL,
    order_number character varying(120) NOT NULL,
    shipment_id character varying(120) NOT NULL,
    direction character varying(20) NOT NULL,
    source_batch_id character varying(80) NOT NULL,
    visible_in_latest boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_rxo_order_shipment_links_direction CHECK (((direction)::text = ANY ((ARRAY['INBOUND'::character varying, 'OUTBOUND'::character varying])::text[])))
);

-- sequence: public.rxo_order_shipment_links_id_seq

CREATE SEQUENCE public.rxo_order_shipment_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.rxo_order_shipment_links_id_seq OWNED BY public.rxo_order_shipment_links.id;

-- table: public.rxo_orders

CREATE TABLE public.rxo_orders (
    id integer NOT NULL,
    site_key character varying(80) NOT NULL,
    order_number character varying(120) NOT NULL,
    direction character varying(20) NOT NULL,
    shipment_id character varying(120),
    status character varying(120),
    origin_name character varying(300),
    origin_address text,
    destination_name character varying(300),
    destination_address text,
    pickup_at timestamp with time zone,
    delivery_at timestamp with time zone,
    customer_order_number character varying(200),
    tracking_number character varying(200),
    source_batch_id character varying(80) NOT NULL,
    visible_in_latest boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    raw_row jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_rxo_orders_direction CHECK (((direction)::text = ANY ((ARRAY['INBOUND'::character varying, 'OUTBOUND'::character varying])::text[])))
);

-- sequence: public.rxo_orders_id_seq

CREATE SEQUENCE public.rxo_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.rxo_orders_id_seq OWNED BY public.rxo_orders.id;

-- table: public.rxo_shipments

CREATE TABLE public.rxo_shipments (
    id integer NOT NULL,
    site_key character varying(80) NOT NULL,
    shipment_id character varying(120) NOT NULL,
    direction character varying(20) NOT NULL,
    status character varying(120),
    mode character varying(80),
    carrier_name character varying(300),
    order_count integer,
    stop_count integer,
    first_stop_name character varying(300),
    first_stop_address text,
    last_stop_name character varying(300),
    last_stop_address text,
    plant_scheduled_at timestamp with time zone,
    pro_number character varying(200),
    trailer_number character varying(200),
    pieces character varying(120),
    total_weight character varying(120),
    volume character varying(120),
    hazardous boolean,
    source_batch_id character varying(80) NOT NULL,
    visible_in_latest boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    raw_row jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_rxo_shipments_direction CHECK (((direction)::text = ANY ((ARRAY['INBOUND'::character varying, 'OUTBOUND'::character varying])::text[])))
);

-- view: public.rxo_shipment_context

CREATE VIEW public.rxo_shipment_context AS
 WITH combined AS (
         SELECT COALESCE(shipment.site_key, visibility.site_key) AS site_key,
            COALESCE(shipment.shipment_id, visibility.shipment_id) AS shipment_id,
            COALESCE(shipment.direction, visibility.direction) AS direction,
            shipment.status AS shipment_status,
            COALESCE(visibility.mode, shipment.mode) AS mode,
            COALESCE(visibility.carrier_name, shipment.carrier_name) AS carrier_name,
            shipment.order_count,
            shipment.stop_count,
            shipment.first_stop_name,
            COALESCE(shipment.first_stop_address, visibility.first_stop_address) AS first_stop_address,
            shipment.last_stop_name,
            COALESCE(shipment.last_stop_address, visibility.last_stop_address) AS last_stop_address,
            COALESCE(visibility.plant_scheduled_at, shipment.plant_scheduled_at) AS plant_scheduled_at,
            COALESCE(visibility.status, shipment.status) AS current_status,
            visibility.eta_status,
            COALESCE(visibility.pro_number, shipment.pro_number) AS pro_number,
            COALESCE(visibility.trailer_number, shipment.trailer_number) AS trailer_number,
            shipment.pieces,
            shipment.total_weight,
            shipment.volume,
            shipment.hazardous,
            COALESCE(shipment.visible_in_latest, false) AS shipment_visible_in_latest,
            COALESCE(visibility.visible_in_latest, false) AS freight_visible_in_latest,
            shipment.source_batch_id AS shipment_source_batch_id,
            visibility.source_batch_id AS visibility_source_batch_id,
            shipment.last_seen_at AS shipment_last_seen_at,
            visibility.last_seen_at AS visibility_last_seen_at,
            visibility.pickup_estimated_arrival_raw,
            visibility.pickup_appointment_arrival_raw,
            visibility.delivery_estimated_arrival_raw,
            visibility.delivery_appointment_arrival_raw
           FROM (public.rxo_shipments shipment
             FULL JOIN public.rxo_freight_visibility visibility ON ((((visibility.site_key)::text = (shipment.site_key)::text) AND ((visibility.shipment_id)::text = (shipment.shipment_id)::text) AND ((visibility.direction)::text = (shipment.direction)::text))))
        )
 SELECT combined.site_key,
    combined.shipment_id,
    combined.direction,
    combined.shipment_status,
    combined.mode,
    combined.carrier_name,
    combined.order_count,
    combined.stop_count,
    combined.first_stop_name,
    combined.first_stop_address,
    combined.last_stop_name,
    combined.last_stop_address,
    combined.plant_scheduled_at,
    combined.current_status,
    combined.eta_status,
    combined.pro_number,
    combined.trailer_number,
    combined.pieces,
    combined.total_weight,
    combined.volume,
    combined.hazardous,
    combined.shipment_visible_in_latest,
    combined.freight_visible_in_latest,
    combined.shipment_source_batch_id,
    combined.visibility_source_batch_id,
    combined.shipment_last_seen_at,
    combined.visibility_last_seen_at,
    COALESCE(linked.order_numbers, (ARRAY[]::text[])::character varying[]) AS order_numbers,
    (COALESCE(linked.linked_order_count, (0)::bigint))::integer AS linked_order_count,
    combined.pickup_estimated_arrival_raw,
    combined.pickup_appointment_arrival_raw,
    combined.delivery_estimated_arrival_raw,
    combined.delivery_appointment_arrival_raw
   FROM (combined
     LEFT JOIN LATERAL ( SELECT array_agg(link.order_number ORDER BY link.order_number) FILTER (WHERE (link.visible_in_latest = true)) AS order_numbers,
            count(*) FILTER (WHERE (link.visible_in_latest = true)) AS linked_order_count
           FROM public.rxo_order_shipment_links link
          WHERE (((link.site_key)::text = (combined.site_key)::text) AND ((link.shipment_id)::text = (combined.shipment_id)::text) AND ((link.direction)::text = (combined.direction)::text))) linked ON (true));

-- sequence: public.rxo_shipments_id_seq

CREATE SEQUENCE public.rxo_shipments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.rxo_shipments_id_seq OWNED BY public.rxo_shipments.id;

-- table: public.sap_document_events

CREATE TABLE public.sap_document_events (
    id bigint NOT NULL,
    visit_document_id integer NOT NULL,
    event_type character varying(60) NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_type character varying(40),
    actor_id character varying(120),
    from_visit_id integer,
    to_visit_id integer,
    reason text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_sap_document_events_details CHECK ((jsonb_typeof(details) = 'object'::text)),
    CONSTRAINT ck_sap_document_events_event_type CHECK ((NULLIF(btrim((event_type)::text), ''::text) IS NOT NULL))
);

-- sequence: public.sap_document_events_id_seq

CREATE SEQUENCE public.sap_document_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.sap_document_events_id_seq OWNED BY public.sap_document_events.id;

-- table: public.sap_document_types

CREATE TABLE public.sap_document_types (
    code character varying(60) NOT NULL,
    display_name character varying(120) NOT NULL,
    positive_markers jsonb DEFAULT '[]'::jsonb NOT NULL,
    authoritative_id_label character varying(120) NOT NULL,
    identifier_pattern character varying(250),
    rule_version character varying(60) NOT NULL,
    auto_extract_enabled boolean DEFAULT false NOT NULL,
    review_only boolean DEFAULT true NOT NULL,
    auto_associate_enabled boolean DEFAULT false NOT NULL,
    routing_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    retention_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_sap_document_types_code CHECK (((code)::text ~ '^[A-Z][A-Z0-9_]*$'::text)),
    CONSTRAINT ck_sap_document_types_positive_markers CHECK ((jsonb_typeof(positive_markers) = 'array'::text)),
    CONSTRAINT ck_sap_document_types_retention_policy CHECK ((jsonb_typeof(retention_policy) = 'object'::text)),
    CONSTRAINT ck_sap_document_types_routing_policy CHECK ((jsonb_typeof(routing_policy) = 'object'::text))
);

-- table: public.scheduled_loads

CREATE TABLE public.scheduled_loads (
    id integer NOT NULL,
    load_number character varying(120) NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    active boolean DEFAULT true NOT NULL,
    source character varying(120),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- sequence: public.scheduled_loads_id_seq

CREATE SEQUENCE public.scheduled_loads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.scheduled_loads_id_seq OWNED BY public.scheduled_loads.id;

-- table: public.truck_log_access_credentials

CREATE TABLE public.truck_log_access_credentials (
    key_id character varying(16) NOT NULL,
    subject_id character varying(120) NOT NULL,
    display_name character varying(160) NOT NULL,
    secret_sha256 character varying(64) NOT NULL,
    scopes jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    CONSTRAINT ck_truck_log_access_credentials_display_name CHECK ((NULLIF(btrim((display_name)::text), ''::text) IS NOT NULL)),
    CONSTRAINT ck_truck_log_access_credentials_expiry CHECK (((expires_at IS NULL) OR (expires_at > created_at))),
    CONSTRAINT ck_truck_log_access_credentials_hash CHECK (((secret_sha256)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_truck_log_access_credentials_key_id CHECK (((key_id)::text ~ '^[0-9a-f]{16}$'::text)),
    CONSTRAINT ck_truck_log_access_credentials_revocation CHECK ((((active = true) AND (revoked_at IS NULL)) OR ((active = false) AND (revoked_at IS NOT NULL)))),
    CONSTRAINT ck_truck_log_access_credentials_scopes CHECK (((jsonb_typeof(scopes) = 'array'::text) AND ((jsonb_array_length(scopes) >= 1) AND (jsonb_array_length(scopes) <= 2)) AND (scopes <@ '["rxo-documents:write", "rxo-documents:reprint"]'::jsonb))),
    CONSTRAINT ck_truck_log_access_credentials_subject_id CHECK (((subject_id)::text ~ '^[A-Za-z0-9][A-Za-z0-9._@-]{0,119}$'::text))
);

-- table: public.truck_log_access_idempotency

CREATE TABLE public.truck_log_access_idempotency (
    key_id character varying(16) NOT NULL,
    idempotency_key character varying(128) NOT NULL,
    request_sha256 character varying(64) NOT NULL,
    response_status integer NOT NULL,
    response_body jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    CONSTRAINT ck_truck_log_access_idempotency_body CHECK ((jsonb_typeof(response_body) = 'object'::text)),
    CONSTRAINT ck_truck_log_access_idempotency_expiry CHECK ((expires_at > created_at)),
    CONSTRAINT ck_truck_log_access_idempotency_hash CHECK (((request_sha256)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_truck_log_access_idempotency_key CHECK (((idempotency_key)::text ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$'::text)),
    CONSTRAINT ck_truck_log_access_idempotency_status CHECK (((response_status >= 200) AND (response_status <= 599)))
);

-- table: public.truck_visits

CREATE TABLE public.truck_visits (
    id integer NOT NULL,
    visit_number character varying(80) NOT NULL,
    load_number character varying(120) NOT NULL,
    direction character varying(20) NOT NULL,
    carrier_id integer,
    carrier_name character varying(200) NOT NULL,
    driver_id integer,
    driver_name character varying(200) NOT NULL,
    driver_phone character varying(50),
    tractor_id character varying(100) NOT NULL,
    trailer_id character varying(100) NOT NULL,
    is_drop_trailer boolean DEFAULT false NOT NULL,
    origin_location_id integer,
    origin_name character varying(250) NOT NULL,
    destination_location_id integer,
    destination_name character varying(250) NOT NULL,
    dock_code character varying(50) NOT NULL,
    notes text,
    status character varying(40) NOT NULL,
    document_folder_key character varying(500) NOT NULL,
    scheduled_at timestamp with time zone,
    guard_check_in_at timestamp with time zone NOT NULL,
    dock_assigned_at timestamp with time zone,
    dock_completed_at timestamp with time zone,
    guard_check_out_at timestamp with time zone,
    created_by character varying(120),
    updated_by character varying(120),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    rxo_site_key character varying(80),
    rxo_shipment_id character varying(120),
    rxo_direction character varying(20),
    client_request_id uuid,
    CONSTRAINT ck_truck_visits_direction CHECK (((direction)::text = ANY ((ARRAY['INBOUND'::character varying, 'OUTBOUND'::character varying])::text[]))),
    CONSTRAINT ck_truck_visits_dock_assigned_time CHECK ((dock_assigned_at IS NOT NULL)),
    CONSTRAINT ck_truck_visits_dock_complete_time CHECK ((((status)::text = 'DOCK_ASSIGNED'::text) OR (dock_completed_at IS NOT NULL))),
    CONSTRAINT ck_truck_visits_guard_checkout_time CHECK ((((status)::text <> 'GUARD_CHECKED_OUT'::text) OR (guard_check_out_at IS NOT NULL))),
    CONSTRAINT ck_truck_visits_rxo_tuple CHECK ((((rxo_site_key IS NULL) AND (rxo_shipment_id IS NULL) AND (rxo_direction IS NULL)) OR ((NULLIF(btrim((rxo_site_key)::text), ''::text) IS NOT NULL) AND (NULLIF(btrim((rxo_shipment_id)::text), ''::text) IS NOT NULL) AND (rxo_direction IS NOT NULL) AND (client_request_id IS NOT NULL) AND ((rxo_direction)::text = ANY ((ARRAY['INBOUND'::character varying, 'OUTBOUND'::character varying])::text[])) AND ((rxo_site_key)::text = lower(btrim((rxo_site_key)::text))) AND ((rxo_shipment_id)::text = upper(btrim((rxo_shipment_id)::text))) AND ((rxo_direction)::text = (direction)::text)))),
    CONSTRAINT ck_truck_visits_status CHECK (((status)::text = ANY ((ARRAY['DOCK_ASSIGNED'::character varying, 'DOCK_COMPLETE'::character varying, 'GUARD_CHECKED_OUT'::character varying])::text[])))
);

-- sequence: public.truck_visits_id_seq

CREATE SEQUENCE public.truck_visits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.truck_visits_id_seq OWNED BY public.truck_visits.id;

-- table: public.visit_documents

CREATE TABLE public.visit_documents (
    id integer NOT NULL,
    truck_visit_id integer,
    file_name character varying(255) NOT NULL,
    stored_file_name character varying(255) NOT NULL,
    relative_path character varying(700) NOT NULL,
    document_type character varying(100),
    mime_type character varying(150),
    file_size_bytes integer,
    page_count integer,
    extracted_document_id character varying(100),
    extraction_status character varying(30) DEFAULT 'NOT_APPLICABLE'::character varying NOT NULL,
    extraction_method character varying(80),
    extraction_message text,
    scanned_at timestamp with time zone DEFAULT now() NOT NULL,
    scanned_by character varying(120),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sap_document_type_code character varying(60),
    source_kind character varying(40) DEFAULT 'VISIT_UPLOAD'::character varying NOT NULL,
    source_agent_id character varying(120),
    source_capture_id character varying(120),
    sha256 character varying(64),
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    route character varying(120),
    source_queue character varying(255),
    output_printer character varying(255),
    print_status character varying(40) DEFAULT 'NOT_APPLICABLE'::character varying NOT NULL,
    print_error text,
    reported_document_id character varying(100),
    validation_status character varying(40) DEFAULT 'NOT_APPLICABLE'::character varying NOT NULL,
    validation_rule_version character varying(60),
    confidence double precision,
    review_status character varying(40) DEFAULT 'NOT_APPLICABLE'::character varying NOT NULL,
    review_reason text,
    association_status character varying(40) DEFAULT 'ASSOCIATED'::character varying NOT NULL,
    association_method character varying(40),
    associated_at timestamp with time zone DEFAULT now(),
    associated_by character varying(120),
    association_reason text,
    is_authoritative boolean DEFAULT false NOT NULL,
    supersedes_document_id integer,
    superseded_at timestamp with time zone,
    storage_status character varying(40) DEFAULT 'STORED'::character varying NOT NULL,
    retention_status character varying(40) DEFAULT 'ACTIVE'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    original_file_name text,
    rxo_site_key character varying(80),
    rxo_shipment_id character varying(120),
    rxo_direction character varying(20),
    rxo_document_version integer,
    rxo_is_active boolean DEFAULT false NOT NULL,
    uploaded_by_key_id character varying(16),
    CONSTRAINT ck_visit_documents_agent_capture_pair CHECK ((((source_agent_id IS NULL) AND (source_capture_id IS NULL)) OR ((NULLIF(btrim((source_agent_id)::text), ''::text) IS NOT NULL) AND (NULLIF(btrim((source_capture_id)::text), ''::text) IS NOT NULL)))),
    CONSTRAINT ck_visit_documents_association_consistency CHECK (((((association_status)::text = 'ASSOCIATED'::text) AND (truck_visit_id IS NOT NULL) AND (associated_at IS NOT NULL)) OR (((association_status)::text = 'UNMATCHED'::text) AND (truck_visit_id IS NULL) AND (associated_at IS NULL)) OR (((association_status)::text = 'ORPHANED'::text) AND (truck_visit_id IS NULL) AND (associated_at IS NOT NULL)))),
    CONSTRAINT ck_visit_documents_association_status CHECK (((association_status)::text = ANY ((ARRAY['ASSOCIATED'::character varying, 'UNMATCHED'::character varying, 'ORPHANED'::character varying])::text[]))),
    CONSTRAINT ck_visit_documents_confidence CHECK (((confidence IS NULL) OR ((confidence >= (0)::double precision) AND (confidence <= (1)::double precision)))),
    CONSTRAINT ck_visit_documents_materials_upload CHECK ((((source_kind)::text IS DISTINCT FROM 'MATERIALS_UPLOAD'::text) OR ((NOT ((document_type)::text IS DISTINCT FROM 'RXO_DRIVER_DOCUMENT'::text)) AND (sap_document_type_code IS NULL) AND (NOT ((mime_type)::text IS DISTINCT FROM 'application/pdf'::text)) AND (NULLIF(btrim(original_file_name), ''::text) IS NOT NULL) AND (octet_length(original_file_name) <= 4096) AND (file_size_bytes IS NOT NULL) AND ((file_size_bytes >= 1) AND (file_size_bytes <= 26214400)) AND (sha256 IS NOT NULL) AND ((sha256)::text ~ '^[0-9a-f]{64}$'::text) AND (NULLIF(btrim((rxo_site_key)::text), ''::text) IS NOT NULL) AND (NULLIF(btrim((rxo_shipment_id)::text), ''::text) IS NOT NULL) AND (rxo_direction IS NOT NULL) AND ((rxo_direction)::text = ANY ((ARRAY['INBOUND'::character varying, 'OUTBOUND'::character varying])::text[])) AND (rxo_document_version IS NOT NULL) AND (rxo_document_version > 0) AND (uploaded_by_key_id IS NOT NULL) AND ((uploaded_by_key_id)::text ~ '^[0-9a-f]{16}$'::text) AND (source_agent_id IS NULL) AND (source_capture_id IS NULL) AND (NOT ((storage_status)::text IS DISTINCT FROM 'STORED'::text)) AND (NOT ((validation_status)::text IS DISTINCT FROM 'NOT_APPLICABLE'::text)) AND (NOT (rxo_is_active IS DISTINCT FROM (superseded_at IS NULL)))))),
    CONSTRAINT ck_visit_documents_print_agent_capture CHECK ((((source_kind)::text <> 'PRINT_AGENT'::text) OR ((NULLIF(btrim((source_agent_id)::text), ''::text) IS NOT NULL) AND (NULLIF(btrim((source_capture_id)::text), ''::text) IS NOT NULL) AND ((sha256)::text ~ '^[0-9a-f]{64}$'::text) AND ((mime_type)::text = 'application/pdf'::text) AND (sap_document_type_code IS NOT NULL) AND ((document_type)::text = (sap_document_type_code)::text) AND ((storage_status)::text = ANY ((ARRAY['STORED'::character varying, 'QUARANTINED'::character varying, 'DELETED'::character varying])::text[]))))),
    CONSTRAINT ck_visit_documents_print_failure_reason CHECK ((((print_status)::text <> 'FAILED'::text) OR (NULLIF(btrim(print_error), ''::text) IS NOT NULL))),
    CONSTRAINT ck_visit_documents_print_status CHECK (((print_status)::text = ANY ((ARRAY['NOT_APPLICABLE'::character varying, 'PENDING'::character varying, 'PRINTED'::character varying, 'FAILED'::character varying, 'SKIPPED'::character varying])::text[]))),
    CONSTRAINT ck_visit_documents_retention_status CHECK (((retention_status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'HOLD'::character varying, 'ELIGIBLE_FOR_CLEANUP'::character varying, 'PURGED'::character varying])::text[]))),
    CONSTRAINT ck_visit_documents_review_reason CHECK ((((review_status)::text <> ALL ((ARRAY['NEEDS_REVIEW'::character varying, 'IN_REVIEW'::character varying])::text[])) OR (NULLIF(btrim(review_reason), ''::text) IS NOT NULL))),
    CONSTRAINT ck_visit_documents_review_status CHECK (((review_status)::text = ANY ((ARRAY['NOT_APPLICABLE'::character varying, 'NEEDS_REVIEW'::character varying, 'IN_REVIEW'::character varying, 'RESOLVED'::character varying, 'DISMISSED'::character varying])::text[]))),
    CONSTRAINT ck_visit_documents_rxo_document_source CHECK ((((document_type)::text IS DISTINCT FROM 'RXO_DRIVER_DOCUMENT'::text) OR (NOT ((source_kind)::text IS DISTINCT FROM 'MATERIALS_UPLOAD'::text)))),
    CONSTRAINT ck_visit_documents_rxo_metadata_owner CHECK (((rxo_site_key IS NULL) OR ((NOT ((source_kind)::text IS DISTINCT FROM 'MATERIALS_UPLOAD'::text)) AND (NOT ((document_type)::text IS DISTINCT FROM 'RXO_DRIVER_DOCUMENT'::text))))),
    CONSTRAINT ck_visit_documents_rxo_tuple CHECK ((((rxo_site_key IS NULL) AND (rxo_shipment_id IS NULL) AND (rxo_direction IS NULL) AND (rxo_document_version IS NULL) AND (uploaded_by_key_id IS NULL) AND (rxo_is_active = false)) OR ((NULLIF(btrim((rxo_site_key)::text), ''::text) IS NOT NULL) AND (NULLIF(btrim((rxo_shipment_id)::text), ''::text) IS NOT NULL) AND (rxo_direction IS NOT NULL) AND ((rxo_direction)::text = ANY ((ARRAY['INBOUND'::character varying, 'OUTBOUND'::character varying])::text[])) AND (rxo_document_version IS NOT NULL) AND (rxo_document_version > 0) AND (uploaded_by_key_id IS NOT NULL) AND ((uploaded_by_key_id)::text ~ '^[0-9a-f]{16}$'::text) AND ((rxo_site_key)::text = lower(btrim((rxo_site_key)::text))) AND ((rxo_shipment_id)::text = upper(btrim((rxo_shipment_id)::text)))))),
    CONSTRAINT ck_visit_documents_rxo_version_chain CHECK ((((document_type)::text IS DISTINCT FROM 'RXO_DRIVER_DOCUMENT'::text) OR (((rxo_document_version IS NOT NULL) AND (rxo_document_version = 1) AND (supersedes_document_id IS NULL)) OR ((rxo_document_version IS NOT NULL) AND (rxo_document_version > 1) AND (supersedes_document_id IS NOT NULL))))),
    CONSTRAINT ck_visit_documents_sha256 CHECK (((sha256 IS NULL) OR ((sha256)::text ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT ck_visit_documents_storage_status CHECK (((storage_status)::text = ANY ((ARRAY['PENDING'::character varying, 'STORED'::character varying, 'FAILED'::character varying, 'QUARANTINED'::character varying, 'DELETED'::character varying])::text[]))),
    CONSTRAINT ck_visit_documents_supersession CHECK (((supersedes_document_id IS NULL) OR (supersedes_document_id <> id))),
    CONSTRAINT ck_visit_documents_validated_id CHECK ((((validation_status)::text <> 'VALIDATED'::text) OR ((sap_document_type_code IS NOT NULL) AND (NULLIF(btrim((extracted_document_id)::text), ''::text) IS NOT NULL)))),
    CONSTRAINT ck_visit_documents_validated_packing_slip CHECK ((((source_kind)::text <> 'PRINT_AGENT'::text) OR ((sap_document_type_code)::text <> 'PACKING_SLIP'::text) OR ((validation_status)::text <> 'VALIDATED'::text) OR (((extracted_document_id)::text ~ '^[0-9]{8}$'::text) AND ((reported_document_id)::text = (extracted_document_id)::text) AND ((validation_rule_version)::text = 'PACKING_SLIP_V1'::text)))),
    CONSTRAINT ck_visit_documents_validation_status CHECK (((validation_status)::text = ANY ((ARRAY['NOT_APPLICABLE'::character varying, 'VALIDATED'::character varying, 'REVIEW_REQUIRED'::character varying, 'REJECTED'::character varying])::text[])))
);

-- sequence: public.visit_documents_id_seq

CREATE SEQUENCE public.visit_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.visit_documents_id_seq OWNED BY public.visit_documents.id;

-- table: public.visit_events

CREATE TABLE public.visit_events (
    id integer NOT NULL,
    truck_visit_id integer NOT NULL,
    event_type character varying(60) NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    actor character varying(120),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- sequence: public.visit_events_id_seq

CREATE SEQUENCE public.visit_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.visit_events_id_seq OWNED BY public.visit_events.id;

-- table: truck_log_admin.audit

CREATE TABLE truck_log_admin.audit (
    id bigint NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    target_id uuid,
    action character varying(48) NOT NULL,
    detail character varying(200) DEFAULT ''::character varying NOT NULL
);

-- sequence: truck_log_admin.audit_id_seq

ALTER TABLE truck_log_admin.audit ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME truck_log_admin.audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- table: truck_log_admin.login_limits

CREATE TABLE truck_log_admin.login_limits (
    key_hash character(64) NOT NULL,
    attempts integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT login_limits_attempts_check CHECK ((attempts > 0)),
    CONSTRAINT login_limits_key_hash_check CHECK ((key_hash ~ '^[a-f0-9]{64}$'::text))
);

-- table: truck_log_admin.schema_version

CREATE TABLE truck_log_admin.schema_version (
    id integer NOT NULL,
    version text NOT NULL,
    installed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT schema_version_id_check CHECK ((id = 1))
);

-- table: truck_log_admin.sessions

CREATE TABLE truck_log_admin.sessions (
    token_hash character(64) NOT NULL,
    user_id uuid NOT NULL,
    user_epoch integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT sessions_token_hash_check CHECK ((token_hash ~ '^[a-f0-9]{64}$'::text))
);

-- table: truck_log_admin.users

CREATE TABLE truck_log_admin.users (
    id uuid NOT NULL,
    username character varying(40) NOT NULL,
    email character varying(254),
    display_name character varying(120) NOT NULL,
    password_hash character varying(256) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    must_change_password boolean DEFAULT true NOT NULL,
    session_epoch integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_display_name_check CHECK ((length(btrim((display_name)::text)) > 0)),
    CONSTRAINT users_email_check CHECK (((email IS NULL) OR ((email)::text = lower((email)::text)))),
    CONSTRAINT users_session_epoch_check CHECK ((session_epoch > 0)),
    CONSTRAINT users_username_check CHECK ((((username)::text = lower((username)::text)) AND ((username)::text ~ '^[a-z0-9][a-z0-9._-]{2,39}$'::text)))
);

ALTER TABLE ONLY public.carriers ALTER COLUMN id SET DEFAULT nextval('public.carriers_id_seq'::regclass);

ALTER TABLE ONLY public.docks ALTER COLUMN id SET DEFAULT nextval('public.docks_id_seq'::regclass);

ALTER TABLE ONLY public.driver_print_events ALTER COLUMN id SET DEFAULT nextval('public.driver_print_events_id_seq'::regclass);

ALTER TABLE ONLY public.drivers ALTER COLUMN id SET DEFAULT nextval('public.drivers_id_seq'::regclass);

ALTER TABLE ONLY public.locations ALTER COLUMN id SET DEFAULT nextval('public.locations_id_seq'::regclass);

ALTER TABLE ONLY public.rxo_expedite_shipment_snapshots ALTER COLUMN id SET DEFAULT nextval('public.rxo_expedite_shipment_snapshots_id_seq'::regclass);

ALTER TABLE ONLY public.rxo_freight_visibility ALTER COLUMN id SET DEFAULT nextval('public.rxo_freight_visibility_id_seq'::regclass);

ALTER TABLE ONLY public.rxo_import_batches ALTER COLUMN id SET DEFAULT nextval('public.rxo_import_batches_id_seq'::regclass);

ALTER TABLE ONLY public.rxo_order_shipment_links ALTER COLUMN id SET DEFAULT nextval('public.rxo_order_shipment_links_id_seq'::regclass);

ALTER TABLE ONLY public.rxo_orders ALTER COLUMN id SET DEFAULT nextval('public.rxo_orders_id_seq'::regclass);

ALTER TABLE ONLY public.rxo_shipments ALTER COLUMN id SET DEFAULT nextval('public.rxo_shipments_id_seq'::regclass);

ALTER TABLE ONLY public.sap_document_events ALTER COLUMN id SET DEFAULT nextval('public.sap_document_events_id_seq'::regclass);

ALTER TABLE ONLY public.scheduled_loads ALTER COLUMN id SET DEFAULT nextval('public.scheduled_loads_id_seq'::regclass);

ALTER TABLE ONLY public.truck_visits ALTER COLUMN id SET DEFAULT nextval('public.truck_visits_id_seq'::regclass);

ALTER TABLE ONLY public.visit_documents ALTER COLUMN id SET DEFAULT nextval('public.visit_documents_id_seq'::regclass);

ALTER TABLE ONLY public.visit_events ALTER COLUMN id SET DEFAULT nextval('public.visit_events_id_seq'::regclass);

--
--

INSERT INTO public.app_settings VALUES
	('site_name', 'Dana Fort Wayne Plant', 'Site/plant name printed on driver slips', now()),
	('slip_footer', 'After loading or unloading is complete, return to the guard shack for final checkout before leaving the site.', 'Driver slip footer text', now()),
	('plant_location_name', 'Fort Wayne', 'Plant-side Origin/Destination value used during guard check-in', now()),
	('dock_warning_minutes', '15', 'Minutes at an assigned dock before the truck is highlighted yellow', now()),
	('dock_critical_minutes', '30', 'Minutes at an assigned dock before the truck is highlighted red', now());

--
--

--
--

--
--

--
--

--
--

INSERT INTO public.docks VALUES
	(1, '7', 'West', true, 10, now(), now()),
	(2, '25', 'Carrier', true, 20, now(), now()),
	(3, '28', 'Receiving', true, 30, now(), now()),
	(4, '41', 'North Building', true, 40, now(), now()),
	(5, '49', 'Steel Coil', true, 50, now(), now()),
	(6, '52', 'Long Bar', true, 60, now(), now()),
	(7, '61', 'Tube', true, 70, now(), now()),
	(8, '62', 'Tube', true, 80, now(), now()),
	(9, '68', 'Forge', true, 90, now(), now());

--
--

--
--

--
--

--
--

--
--

--
--

--
--

--
--

--
--

--
--

--
--

--
--

--
--

--
--

--
--

--
--

--
--

--
--

INSERT INTO public.sap_document_types VALUES
	('PACKING_SLIP', 'Packing Slip', '["Packing List", "Packing Slip"]', 'Delivery Number', '^[0-9]{8}$', 'PACKING_SLIP_V1', true, false, false, '{}', '{}', true, now(), now()),
	('GOODS_RECEIPT', 'Goods Receipt', '["Goods Receipt"]', 'Goods Receipt Number', NULL, 'GOODS_RECEIPT_UNVALIDATED_V1', false, true, false, '{}', '{}', true, now(), now());

--
--

--
--

--
--

--
--

--
--

--
--

--
--

--
--

--
--

INSERT INTO truck_log_admin.schema_version VALUES
	(1, 'truck-log-admin-v1', now());

--
--

--
--

SELECT pg_catalog.setval('public.carriers_id_seq', 1, false);

SELECT pg_catalog.setval('public.docks_id_seq', 9, true);

SELECT pg_catalog.setval('public.driver_print_events_id_seq', 1, false);

SELECT pg_catalog.setval('public.drivers_id_seq', 1, false);

SELECT pg_catalog.setval('public.locations_id_seq', 1, false);

SELECT pg_catalog.setval('public.rxo_expedite_shipment_snapshots_id_seq', 1, false);

SELECT pg_catalog.setval('public.rxo_freight_visibility_id_seq', 1, false);

SELECT pg_catalog.setval('public.rxo_import_batches_id_seq', 1, false);

SELECT pg_catalog.setval('public.rxo_order_shipment_links_id_seq', 1, false);

SELECT pg_catalog.setval('public.rxo_orders_id_seq', 1, false);

SELECT pg_catalog.setval('public.rxo_shipments_id_seq', 1, false);

SELECT pg_catalog.setval('public.sap_document_events_id_seq', 1, false);

SELECT pg_catalog.setval('public.scheduled_loads_id_seq', 1, false);

SELECT pg_catalog.setval('public.truck_visits_id_seq', 1, false);

SELECT pg_catalog.setval('public.visit_documents_id_seq', 1, false);

SELECT pg_catalog.setval('public.visit_events_id_seq', 1, false);

SELECT pg_catalog.setval('truck_log_admin.audit_id_seq', 1, false);

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.automatic_driver_print_attempts
    ADD CONSTRAINT automatic_driver_print_attempts_job_id_attempt_number_key UNIQUE (job_id, attempt_number);

ALTER TABLE ONLY public.automatic_driver_print_attempts
    ADD CONSTRAINT automatic_driver_print_attempts_job_id_request_key_key UNIQUE (job_id, request_key);

ALTER TABLE ONLY public.automatic_driver_print_attempts
    ADD CONSTRAINT automatic_driver_print_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.automatic_driver_print_jobs
    ADD CONSTRAINT automatic_driver_print_jobs_package_id_item_type_key UNIQUE (package_id, item_type);

ALTER TABLE ONLY public.automatic_driver_print_jobs
    ADD CONSTRAINT automatic_driver_print_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.automatic_driver_print_packages
    ADD CONSTRAINT automatic_driver_print_packages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.automatic_driver_print_packages
    ADD CONSTRAINT automatic_driver_print_packages_request_key_key UNIQUE (request_key);

ALTER TABLE ONLY public.carriers
    ADD CONSTRAINT carriers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.docks
    ADD CONSTRAINT docks_code_key UNIQUE (code);

ALTER TABLE ONLY public.docks
    ADD CONSTRAINT docks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.driver_print_attempts
    ADD CONSTRAINT driver_print_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.driver_print_events
    ADD CONSTRAINT driver_print_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.driver_print_items
    ADD CONSTRAINT driver_print_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.driver_print_packages
    ADD CONSTRAINT driver_print_packages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.print_agent_credentials
    ADD CONSTRAINT print_agent_credentials_pkey PRIMARY KEY (key_id);

ALTER TABLE ONLY public.print_agent_idempotency
    ADD CONSTRAINT print_agent_idempotency_pkey PRIMARY KEY (agent_id, idempotency_key);

ALTER TABLE ONLY public.print_agents
    ADD CONSTRAINT print_agents_pkey PRIMARY KEY (agent_id);

ALTER TABLE ONLY public.rxo_expedite_import_batches
    ADD CONSTRAINT rxo_expedite_import_batches_pkey PRIMARY KEY (source_batch_id);

ALTER TABLE ONLY public.rxo_expedite_shipment_snapshots
    ADD CONSTRAINT rxo_expedite_shipment_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.rxo_freight_visibility
    ADD CONSTRAINT rxo_freight_visibility_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.rxo_import_batches
    ADD CONSTRAINT rxo_import_batches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.rxo_order_shipment_links
    ADD CONSTRAINT rxo_order_shipment_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.rxo_orders
    ADD CONSTRAINT rxo_orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.rxo_shipments
    ADD CONSTRAINT rxo_shipments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sap_document_events
    ADD CONSTRAINT sap_document_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sap_document_types
    ADD CONSTRAINT sap_document_types_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.scheduled_loads
    ADD CONSTRAINT scheduled_loads_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.truck_log_access_credentials
    ADD CONSTRAINT truck_log_access_credentials_pkey PRIMARY KEY (key_id);

ALTER TABLE ONLY public.truck_log_access_idempotency
    ADD CONSTRAINT truck_log_access_idempotency_pkey PRIMARY KEY (key_id, idempotency_key);

ALTER TABLE ONLY public.truck_visits
    ADD CONSTRAINT truck_visits_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.truck_visits
    ADD CONSTRAINT truck_visits_visit_number_key UNIQUE (visit_number);

ALTER TABLE ONLY public.driver_print_attempts
    ADD CONSTRAINT ux_driver_print_attempts_idempotency UNIQUE (item_id, idempotency_key);

ALTER TABLE ONLY public.driver_print_attempts
    ADD CONSTRAINT ux_driver_print_attempts_item_number UNIQUE (item_id, attempt_number);

ALTER TABLE ONLY public.driver_print_items
    ADD CONSTRAINT ux_driver_print_items_package_type UNIQUE (package_id, item_type);

ALTER TABLE ONLY public.rxo_expedite_shipment_snapshots
    ADD CONSTRAINT ux_rxo_expedite_snapshot_batch_shipment UNIQUE (source_batch_id, shipment_id);

ALTER TABLE ONLY public.rxo_freight_visibility
    ADD CONSTRAINT ux_rxo_freight_visibility_shipment_direction UNIQUE (site_key, shipment_id, direction);

ALTER TABLE ONLY public.rxo_import_batches
    ADD CONSTRAINT ux_rxo_import_batches_site_batch UNIQUE (site_key, source_batch_id);

ALTER TABLE ONLY public.rxo_order_shipment_links
    ADD CONSTRAINT ux_rxo_order_shipment_links UNIQUE (site_key, order_number, shipment_id, direction);

ALTER TABLE ONLY public.rxo_orders
    ADD CONSTRAINT ux_rxo_orders_order_direction UNIQUE (site_key, order_number, direction);

ALTER TABLE ONLY public.rxo_shipments
    ADD CONSTRAINT ux_rxo_shipments_shipment_direction UNIQUE (site_key, shipment_id, direction);

ALTER TABLE ONLY public.visit_documents
    ADD CONSTRAINT visit_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.visit_events
    ADD CONSTRAINT visit_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY truck_log_admin.audit
    ADD CONSTRAINT audit_pkey PRIMARY KEY (id);

ALTER TABLE ONLY truck_log_admin.login_limits
    ADD CONSTRAINT login_limits_pkey PRIMARY KEY (key_hash);

ALTER TABLE ONLY truck_log_admin.schema_version
    ADD CONSTRAINT schema_version_pkey PRIMARY KEY (id);

ALTER TABLE ONLY truck_log_admin.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (token_hash);

ALTER TABLE ONLY truck_log_admin.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY truck_log_admin.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY truck_log_admin.users
    ADD CONSTRAINT users_username_key UNIQUE (username);

CREATE INDEX ix_auto_jobs_queue ON public.automatic_driver_print_jobs USING btree (status, created_at, id) WHERE ((status)::text = ANY ((ARRAY['QUEUED'::character varying, 'LEASED'::character varying])::text[]));

CREATE INDEX ix_carriers_last_used_at ON public.carriers USING btree (last_used_at DESC);

CREATE INDEX ix_driver_print_attempts_agent_time ON public.driver_print_attempts USING btree (agent_id, requested_at DESC) WHERE (agent_id IS NOT NULL);

CREATE INDEX ix_driver_print_attempts_item_time ON public.driver_print_attempts USING btree (item_id, requested_at DESC);

CREATE INDEX ix_driver_print_events_document_time ON public.driver_print_events USING btree (visit_document_id, occurred_at DESC) WHERE (visit_document_id IS NOT NULL);

CREATE INDEX ix_driver_print_events_item_time ON public.driver_print_events USING btree (item_id, occurred_at DESC) WHERE (item_id IS NOT NULL);

CREATE INDEX ix_driver_print_events_package_time ON public.driver_print_events USING btree (package_id, occurred_at DESC) WHERE (package_id IS NOT NULL);

CREATE INDEX ix_driver_print_events_shipment_time ON public.driver_print_events USING btree (rxo_site_key, rxo_shipment_id, rxo_direction, occurred_at DESC) WHERE (rxo_site_key IS NOT NULL);

CREATE INDEX ix_driver_print_events_visit_time ON public.driver_print_events USING btree (truck_visit_id, occurred_at DESC) WHERE (truck_visit_id IS NOT NULL);

CREATE INDEX ix_driver_print_items_agent_queue ON public.driver_print_items USING btree (assigned_agent_id, status, created_at) WHERE ((status)::text = ANY ((ARRAY['QUEUED'::character varying, 'LEASED'::character varying])::text[]));

CREATE INDEX ix_driver_print_items_document_history ON public.driver_print_items USING btree (visit_document_id, created_at DESC) WHERE (visit_document_id IS NOT NULL);

CREATE INDEX ix_driver_print_packages_frozen_document ON public.driver_print_packages USING btree (frozen_document_id, requested_at DESC) WHERE (frozen_document_id IS NOT NULL);

CREATE INDEX ix_driver_print_packages_visit_history ON public.driver_print_packages USING btree (truck_visit_id, requested_at DESC);

CREATE INDEX ix_drivers_last_used_at ON public.drivers USING btree (last_used_at DESC);

CREATE INDEX ix_locations_last_used_at ON public.locations USING btree (last_used_at DESC);

CREATE INDEX ix_print_agent_credentials_agent ON public.print_agent_credentials USING btree (agent_id, active);

CREATE INDEX ix_print_agent_idempotency_expiry ON public.print_agent_idempotency USING btree (expires_at);

CREATE INDEX ix_rxo_expedite_import_batches_imported_at ON public.rxo_expedite_import_batches USING btree (imported_at DESC NULLS LAST);

CREATE INDEX ix_rxo_expedite_import_batches_status ON public.rxo_expedite_import_batches USING btree (status, updated_at DESC);

CREATE INDEX ix_rxo_expedite_snapshots_batch ON public.rxo_expedite_shipment_snapshots USING btree (source_batch_id, shipment_id);

CREATE INDEX ix_rxo_expedite_snapshots_shipment ON public.rxo_expedite_shipment_snapshots USING btree (shipment_id);

CREATE INDEX ix_rxo_freight_visibility_direction ON public.rxo_freight_visibility USING btree (direction);

CREATE INDEX ix_rxo_freight_visibility_last_seen_at ON public.rxo_freight_visibility USING btree (last_seen_at DESC);

CREATE INDEX ix_rxo_freight_visibility_latest ON public.rxo_freight_visibility USING btree (site_key, visible_in_latest, direction);

CREATE INDEX ix_rxo_import_batches_imported_at ON public.rxo_import_batches USING btree (imported_at DESC);

CREATE INDEX ix_rxo_order_shipment_links_latest ON public.rxo_order_shipment_links USING btree (site_key, visible_in_latest, direction);

CREATE INDEX ix_rxo_order_shipment_links_order ON public.rxo_order_shipment_links USING btree (order_number, direction);

CREATE INDEX ix_rxo_order_shipment_links_shipment ON public.rxo_order_shipment_links USING btree (shipment_id, direction);

CREATE INDEX ix_rxo_orders_direction ON public.rxo_orders USING btree (direction);

CREATE INDEX ix_rxo_orders_last_seen_at ON public.rxo_orders USING btree (last_seen_at DESC);

CREATE INDEX ix_rxo_orders_latest ON public.rxo_orders USING btree (site_key, visible_in_latest, direction);

CREATE INDEX ix_rxo_orders_shipment_id ON public.rxo_orders USING btree (shipment_id);

CREATE INDEX ix_rxo_shipments_direction ON public.rxo_shipments USING btree (direction);

CREATE INDEX ix_rxo_shipments_last_seen_at ON public.rxo_shipments USING btree (last_seen_at DESC);

CREATE INDEX ix_rxo_shipments_latest ON public.rxo_shipments USING btree (site_key, visible_in_latest, direction);

CREATE INDEX ix_rxo_shipments_scheduled_at ON public.rxo_shipments USING btree (plant_scheduled_at);

CREATE INDEX ix_rxo_shipments_shipment_id ON public.rxo_shipments USING btree (shipment_id);

CREATE INDEX ix_sap_document_events_document_time ON public.sap_document_events USING btree (visit_document_id, occurred_at DESC);

CREATE INDEX ix_sap_document_events_from_visit_time ON public.sap_document_events USING btree (from_visit_id, occurred_at DESC) WHERE (from_visit_id IS NOT NULL);

CREATE INDEX ix_sap_document_events_to_visit_time ON public.sap_document_events USING btree (to_visit_id, occurred_at DESC) WHERE (to_visit_id IS NOT NULL);

CREATE INDEX ix_scheduled_loads_scheduled_at ON public.scheduled_loads USING btree (scheduled_at);

CREATE INDEX ix_truck_log_access_credentials_expiry ON public.truck_log_access_credentials USING btree (expires_at) WHERE ((active = true) AND (expires_at IS NOT NULL));

CREATE INDEX ix_truck_log_access_credentials_subject ON public.truck_log_access_credentials USING btree (subject_id, active);

CREATE INDEX ix_truck_log_access_idempotency_expiry ON public.truck_log_access_idempotency USING btree (expires_at);

CREATE INDEX ix_truck_visits_carrier_id ON public.truck_visits USING btree (carrier_id);

CREATE INDEX ix_truck_visits_destination_location_id ON public.truck_visits USING btree (destination_location_id);

CREATE INDEX ix_truck_visits_driver_id ON public.truck_visits USING btree (driver_id);

CREATE INDEX ix_truck_visits_driver_name ON public.truck_visits USING btree (driver_name);

CREATE INDEX ix_truck_visits_driver_phone ON public.truck_visits USING btree (driver_phone);

CREATE INDEX ix_truck_visits_guard_check_in_at ON public.truck_visits USING btree (guard_check_in_at DESC);

CREATE INDEX ix_truck_visits_load_number ON public.truck_visits USING btree (load_number);

CREATE INDEX ix_truck_visits_origin_location_id ON public.truck_visits USING btree (origin_location_id);

CREATE INDEX ix_truck_visits_rxo_shipment ON public.truck_visits USING btree (rxo_site_key, rxo_shipment_id, rxo_direction) WHERE (rxo_site_key IS NOT NULL);

CREATE INDEX ix_truck_visits_status ON public.truck_visits USING btree (status);

CREATE INDEX ix_truck_visits_trailer_id ON public.truck_visits USING btree (trailer_id);

CREATE INDEX ix_visit_documents_association ON public.visit_documents USING btree (association_status, captured_at DESC);

CREATE INDEX ix_visit_documents_extracted_document_id ON public.visit_documents USING btree (extracted_document_id) WHERE (extracted_document_id IS NOT NULL);

CREATE INDEX ix_visit_documents_review_queue ON public.visit_documents USING btree (review_status, captured_at DESC) WHERE ((review_status)::text = ANY ((ARRAY['NEEDS_REVIEW'::character varying, 'IN_REVIEW'::character varying])::text[]));

CREATE INDEX ix_visit_documents_rxo_history ON public.visit_documents USING btree (rxo_site_key, rxo_shipment_id, rxo_direction, rxo_document_version DESC) WHERE ((document_type)::text = 'RXO_DRIVER_DOCUMENT'::text);

CREATE INDEX ix_visit_documents_sap_id ON public.visit_documents USING btree (sap_document_type_code, extracted_document_id) WHERE ((sap_document_type_code IS NOT NULL) AND (extracted_document_id IS NOT NULL));

CREATE INDEX ix_visit_documents_sha256 ON public.visit_documents USING btree (sha256) WHERE (sha256 IS NOT NULL);

CREATE INDEX ix_visit_documents_visit ON public.visit_documents USING btree (truck_visit_id);

CREATE INDEX ix_visit_events_visit ON public.visit_events USING btree (truck_visit_id, occurred_at);

CREATE UNIQUE INDEX ux_auto_original_visit ON public.automatic_driver_print_packages USING btree (truck_visit_id) WHERE ((request_kind)::text = 'ORIGINAL'::text);

CREATE UNIQUE INDEX ux_carriers_normalized_name ON public.carriers USING btree (lower(btrim((name)::text)));

CREATE UNIQUE INDEX ux_driver_print_packages_original_visit ON public.driver_print_packages USING btree (truck_visit_id) WHERE ((request_kind)::text = 'ORIGINAL'::text);

CREATE UNIQUE INDEX ux_driver_print_packages_request ON public.driver_print_packages USING btree (request_id);

CREATE UNIQUE INDEX ux_drivers_normalized_name ON public.drivers USING btree (lower(btrim((name)::text)));

CREATE UNIQUE INDEX ux_locations_normalized_name ON public.locations USING btree (lower(btrim((name)::text)));

CREATE UNIQUE INDEX ux_scheduled_loads_active_load_number ON public.scheduled_loads USING btree (upper((load_number)::text)) WHERE (active = true);

CREATE UNIQUE INDEX ux_truck_visits_client_request ON public.truck_visits USING btree (client_request_id) WHERE (client_request_id IS NOT NULL);

CREATE UNIQUE INDEX ux_visit_documents_agent_capture ON public.visit_documents USING btree (source_agent_id, source_capture_id) WHERE ((source_agent_id IS NOT NULL) AND (source_capture_id IS NOT NULL));

CREATE UNIQUE INDEX ux_visit_documents_authoritative_sap_type ON public.visit_documents USING btree (truck_visit_id, sap_document_type_code) WHERE ((truck_visit_id IS NOT NULL) AND (sap_document_type_code IS NOT NULL) AND (is_authoritative = true) AND (superseded_at IS NULL));

CREATE UNIQUE INDEX ux_visit_documents_one_packing_slip ON public.visit_documents USING btree (truck_visit_id) WHERE ((document_type)::text = 'PACKING_SLIP'::text);

CREATE UNIQUE INDEX ux_visit_documents_rxo_active ON public.visit_documents USING btree (rxo_site_key, rxo_shipment_id, rxo_direction) WHERE (((document_type)::text = 'RXO_DRIVER_DOCUMENT'::text) AND ((source_kind)::text = 'MATERIALS_UPLOAD'::text) AND (rxo_is_active = true));

CREATE UNIQUE INDEX ux_visit_documents_rxo_version ON public.visit_documents USING btree (rxo_site_key, rxo_shipment_id, rxo_direction, rxo_document_version) WHERE ((document_type)::text = 'RXO_DRIVER_DOCUMENT'::text);

CREATE UNIQUE INDEX ux_visit_documents_supersedes ON public.visit_documents USING btree (supersedes_document_id) WHERE (supersedes_document_id IS NOT NULL);

CREATE INDEX truck_log_admin_session_expiry ON truck_log_admin.sessions USING btree (expires_at);

CREATE INDEX truck_log_admin_session_user ON truck_log_admin.sessions USING btree (user_id);

CREATE TRIGGER trg_auto_attempt_immutable BEFORE DELETE OR UPDATE ON public.automatic_driver_print_attempts FOR EACH ROW EXECUTE FUNCTION public.protect_automatic_print_attempt();

CREATE TRIGGER trg_auto_job_document BEFORE INSERT ON public.automatic_driver_print_jobs FOR EACH ROW EXECUTE FUNCTION public.validate_automatic_print_document();

CREATE TRIGGER trg_auto_job_immutable BEFORE DELETE OR UPDATE ON public.automatic_driver_print_jobs FOR EACH ROW EXECUTE FUNCTION public.protect_automatic_print_job();

CREATE TRIGGER trg_auto_package_immutable BEFORE DELETE OR UPDATE ON public.automatic_driver_print_packages FOR EACH ROW EXECUTE FUNCTION public.protect_automatic_print_package();

CREATE TRIGGER trg_driver_print_attempts_transition BEFORE DELETE OR UPDATE ON public.driver_print_attempts FOR EACH ROW EXECUTE FUNCTION public.enforce_driver_print_attempt_transition();

CREATE TRIGGER trg_driver_print_events_append_only BEFORE DELETE OR UPDATE ON public.driver_print_events FOR EACH ROW EXECUTE FUNCTION public.protect_driver_print_event_history();

CREATE TRIGGER trg_driver_print_items_immutable BEFORE UPDATE ON public.driver_print_items FOR EACH ROW EXECUTE FUNCTION public.protect_driver_print_item_snapshot();

CREATE TRIGGER trg_driver_print_items_validate_document BEFORE INSERT OR UPDATE OF package_id, item_type, visit_document_id ON public.driver_print_items FOR EACH ROW EXECUTE FUNCTION public.validate_driver_print_item_document();

CREATE TRIGGER trg_driver_print_packages_immutable BEFORE UPDATE ON public.driver_print_packages FOR EACH ROW EXECUTE FUNCTION public.protect_driver_print_package_snapshot();

CREATE TRIGGER trg_driver_print_packages_validate_document BEFORE INSERT OR UPDATE OF frozen_document_id, truck_visit_id, request_kind ON public.driver_print_packages FOR EACH ROW EXECUTE FUNCTION public.validate_driver_print_package_document();

CREATE TRIGGER trg_sap_document_events_append_only BEFORE DELETE OR UPDATE ON public.sap_document_events FOR EACH ROW EXECUTE FUNCTION public.protect_sap_document_event_history();

CREATE TRIGGER trg_truck_visits_required_insert BEFORE INSERT ON public.truck_visits FOR EACH ROW EXECUTE FUNCTION public.enforce_new_truck_visit_required_fields();

CREATE TRIGGER trg_truck_visits_rxo_identity BEFORE UPDATE OF client_request_id, rxo_site_key, rxo_shipment_id, rxo_direction ON public.truck_visits FOR EACH ROW EXECUTE FUNCTION public.protect_truck_visit_rxo_identity();

CREATE TRIGGER trg_truck_visits_scheduled_source BEFORE INSERT OR UPDATE OF load_number, scheduled_at ON public.truck_visits FOR EACH ROW EXECUTE FUNCTION public.enforce_truck_visit_scheduled_source();

CREATE TRIGGER trg_visit_documents_normalize_association BEFORE UPDATE OF truck_visit_id, association_status ON public.visit_documents FOR EACH ROW EXECUTE FUNCTION public.normalize_sap_document_association();

CREATE TRIGGER trg_visit_documents_rxo_association BEFORE INSERT OR UPDATE OF truck_visit_id, document_type, rxo_site_key, rxo_shipment_id, rxo_direction ON public.visit_documents FOR EACH ROW EXECUTE FUNCTION public.validate_rxo_driver_document_visit_association();

CREATE TRIGGER trg_visit_documents_rxo_immutable BEFORE DELETE OR UPDATE ON public.visit_documents FOR EACH ROW EXECUTE FUNCTION public.protect_rxo_driver_document_immutable_fields();

CREATE TRIGGER trg_visit_documents_rxo_version_chain BEFORE INSERT OR UPDATE OF document_type, source_kind, rxo_site_key, rxo_shipment_id, rxo_direction, rxo_document_version, supersedes_document_id ON public.visit_documents FOR EACH ROW EXECUTE FUNCTION public.enforce_rxo_driver_document_version_chain();

ALTER TABLE ONLY public.automatic_driver_print_attempts
    ADD CONSTRAINT automatic_driver_print_attempts_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.automatic_driver_print_jobs(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.automatic_driver_print_jobs
    ADD CONSTRAINT automatic_driver_print_jobs_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.automatic_driver_print_packages(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.automatic_driver_print_jobs
    ADD CONSTRAINT automatic_driver_print_jobs_visit_document_id_fkey FOREIGN KEY (visit_document_id) REFERENCES public.visit_documents(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.automatic_driver_print_packages
    ADD CONSTRAINT automatic_driver_print_packages_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.print_agents(agent_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.automatic_driver_print_packages
    ADD CONSTRAINT automatic_driver_print_packages_original_package_id_fkey FOREIGN KEY (original_package_id) REFERENCES public.automatic_driver_print_packages(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.automatic_driver_print_packages
    ADD CONSTRAINT automatic_driver_print_packages_truck_visit_id_fkey FOREIGN KEY (truck_visit_id) REFERENCES public.truck_visits(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.driver_print_attempts
    ADD CONSTRAINT fk_driver_print_attempts_agent FOREIGN KEY (agent_id) REFERENCES public.print_agents(agent_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.driver_print_attempts
    ADD CONSTRAINT fk_driver_print_attempts_item FOREIGN KEY (item_id) REFERENCES public.driver_print_items(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.driver_print_events
    ADD CONSTRAINT fk_driver_print_events_actor_key FOREIGN KEY (actor_key_id) REFERENCES public.truck_log_access_credentials(key_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.driver_print_events
    ADD CONSTRAINT fk_driver_print_events_document FOREIGN KEY (visit_document_id) REFERENCES public.visit_documents(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.driver_print_events
    ADD CONSTRAINT fk_driver_print_events_item FOREIGN KEY (item_id) REFERENCES public.driver_print_items(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.driver_print_events
    ADD CONSTRAINT fk_driver_print_events_package FOREIGN KEY (package_id) REFERENCES public.driver_print_packages(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.driver_print_events
    ADD CONSTRAINT fk_driver_print_events_visit FOREIGN KEY (truck_visit_id) REFERENCES public.truck_visits(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.driver_print_items
    ADD CONSTRAINT fk_driver_print_items_agent FOREIGN KEY (assigned_agent_id) REFERENCES public.print_agents(agent_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.driver_print_items
    ADD CONSTRAINT fk_driver_print_items_document FOREIGN KEY (visit_document_id) REFERENCES public.visit_documents(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.driver_print_items
    ADD CONSTRAINT fk_driver_print_items_package FOREIGN KEY (package_id) REFERENCES public.driver_print_packages(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.driver_print_packages
    ADD CONSTRAINT fk_driver_print_packages_document FOREIGN KEY (frozen_document_id) REFERENCES public.visit_documents(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.driver_print_packages
    ADD CONSTRAINT fk_driver_print_packages_requested_key FOREIGN KEY (requested_by_key_id) REFERENCES public.truck_log_access_credentials(key_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.driver_print_packages
    ADD CONSTRAINT fk_driver_print_packages_visit FOREIGN KEY (truck_visit_id) REFERENCES public.truck_visits(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.print_agent_credentials
    ADD CONSTRAINT fk_print_agent_credentials_agent FOREIGN KEY (agent_id) REFERENCES public.print_agents(agent_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.print_agent_idempotency
    ADD CONSTRAINT fk_print_agent_idempotency_agent FOREIGN KEY (agent_id) REFERENCES public.print_agents(agent_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.rxo_freight_visibility
    ADD CONSTRAINT fk_rxo_freight_visibility_batch FOREIGN KEY (site_key, source_batch_id) REFERENCES public.rxo_import_batches(site_key, source_batch_id);

ALTER TABLE ONLY public.rxo_order_shipment_links
    ADD CONSTRAINT fk_rxo_order_shipment_links_batch FOREIGN KEY (site_key, source_batch_id) REFERENCES public.rxo_import_batches(site_key, source_batch_id);

ALTER TABLE ONLY public.rxo_orders
    ADD CONSTRAINT fk_rxo_orders_batch FOREIGN KEY (site_key, source_batch_id) REFERENCES public.rxo_import_batches(site_key, source_batch_id);

ALTER TABLE ONLY public.rxo_shipments
    ADD CONSTRAINT fk_rxo_shipments_batch FOREIGN KEY (site_key, source_batch_id) REFERENCES public.rxo_import_batches(site_key, source_batch_id);

ALTER TABLE ONLY public.sap_document_events
    ADD CONSTRAINT fk_sap_document_events_document FOREIGN KEY (visit_document_id) REFERENCES public.visit_documents(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.sap_document_events
    ADD CONSTRAINT fk_sap_document_events_from_visit FOREIGN KEY (from_visit_id) REFERENCES public.truck_visits(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sap_document_events
    ADD CONSTRAINT fk_sap_document_events_to_visit FOREIGN KEY (to_visit_id) REFERENCES public.truck_visits(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.truck_log_access_idempotency
    ADD CONSTRAINT fk_truck_log_access_idempotency_credential FOREIGN KEY (key_id) REFERENCES public.truck_log_access_credentials(key_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.truck_visits
    ADD CONSTRAINT fk_truck_visits_carrier_reference FOREIGN KEY (carrier_id) REFERENCES public.carriers(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.truck_visits
    ADD CONSTRAINT fk_truck_visits_destination_location_reference FOREIGN KEY (destination_location_id) REFERENCES public.locations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.truck_visits
    ADD CONSTRAINT fk_truck_visits_driver_reference FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.truck_visits
    ADD CONSTRAINT fk_truck_visits_origin_location_reference FOREIGN KEY (origin_location_id) REFERENCES public.locations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.visit_documents
    ADD CONSTRAINT fk_visit_documents_sap_document_type FOREIGN KEY (sap_document_type_code) REFERENCES public.sap_document_types(code) ON DELETE RESTRICT;

ALTER TABLE ONLY public.visit_documents
    ADD CONSTRAINT fk_visit_documents_supersedes FOREIGN KEY (supersedes_document_id) REFERENCES public.visit_documents(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.visit_documents
    ADD CONSTRAINT fk_visit_documents_truck_visit FOREIGN KEY (truck_visit_id) REFERENCES public.truck_visits(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.visit_documents
    ADD CONSTRAINT fk_visit_documents_uploaded_by_key FOREIGN KEY (uploaded_by_key_id) REFERENCES public.truck_log_access_credentials(key_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.rxo_expedite_shipment_snapshots
    ADD CONSTRAINT rxo_expedite_shipment_snapshots_source_batch_id_fkey FOREIGN KEY (source_batch_id) REFERENCES public.rxo_expedite_import_batches(source_batch_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.visit_events
    ADD CONSTRAINT visit_events_truck_visit_id_fkey FOREIGN KEY (truck_visit_id) REFERENCES public.truck_visits(id) ON DELETE CASCADE;

ALTER TABLE ONLY truck_log_admin.audit
    ADD CONSTRAINT audit_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES truck_log_admin.users(id);

ALTER TABLE ONLY truck_log_admin.audit
    ADD CONSTRAINT audit_target_id_fkey FOREIGN KEY (target_id) REFERENCES truck_log_admin.users(id);

ALTER TABLE ONLY truck_log_admin.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES truck_log_admin.users(id);
