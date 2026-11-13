-- Late Print Agent results.
--
-- Guard Shack Print Agent 4.0.7 keeps finished results in a durable outbox and
-- re-sends each one (same X-Idempotency-Key, identical body) until the server
-- confirms. A print that finished inside its lease can therefore arrive after
-- the lease monitor marked it FAILED with an "uncertain" outcome. The server
-- may now replace that monitor failure, exactly once, with the agent's own
-- result (PRINTED, or FAILED with the agent's error) when the agent's claim
-- still matches and the result was submitted within the lease (+5 min skew).
--
-- The history triggers below keep every other rule. They additionally allow
-- only this one transition, and only from the lease monitor's marker:
--   automatic jobs:     FAILED with the UNCERTAIN text, attempt result_key NULL
--   legacy attempts:    FAILED with EXPIRED_LEASE_ERROR, details.outcomeAmbiguous
--                       = true and no resultIdempotencyKey yet
-- The marker texts must match UNCERTAIN (automatic-driver-print.helpers.ts) and
-- EXPIRED_LEASE_ERROR (driver-print.types.ts); a contract test checks this.

CREATE OR REPLACE FUNCTION public.protect_automatic_print_job() RETURNS trigger
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
  -- Late agent result replaces the lease monitor's uncertain failure (same attempt and lease).
  IF OLD.status='FAILED'
     AND OLD.last_error='Print lease expired. Physical outcome is uncertain; inspect the printer before an explicit retry. No automatic reprint.'
     AND NEW.status IN ('PRINTED','FAILED') AND NEW.last_error IS DISTINCT FROM OLD.last_error
     AND NEW.attempt_count=OLD.attempt_count AND NEW.lease_token_sha256=OLD.lease_token_sha256
     AND NEW.leased_at=OLD.leased_at AND NEW.lease_expires_at=OLD.lease_expires_at
     AND EXISTS (SELECT 1 FROM public.automatic_driver_print_attempts a
                  WHERE a.job_id=OLD.id AND a.attempt_number=OLD.attempt_count
                    AND a.status='FAILED' AND a.result_key IS NULL) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Invalid automatic print transition: % -> %',OLD.status,NEW.status;
END; $$;

CREATE OR REPLACE FUNCTION public.protect_automatic_print_attempt() RETURNS trigger
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
  -- Late agent result replaces the lease monitor's uncertain failure, once (result_key is then set).
  IF OLD.status='FAILED' AND OLD.result_key IS NULL AND NEW.result_key IS NOT NULL
     AND OLD.error_message='Print lease expired. Physical outcome is uncertain; inspect the printer before an explicit retry. No automatic reprint.'
     AND NEW.status IN ('PRINTED','FAILED') AND NEW.lease_token_sha256=OLD.lease_token_sha256
     AND NEW.claim_key=OLD.claim_key AND NEW.leased_at=OLD.leased_at THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Invalid automatic print attempt transition';
END; $$;

CREATE OR REPLACE FUNCTION public.enforce_driver_print_attempt_transition() RETURNS trigger
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

  -- Late agent result replaces the lease monitor's ambiguous failure, once
  -- (resultIdempotencyKey is then present, so this cannot match again).
  IF OLD.status = 'FAILED'
     AND OLD.error_message = 'Print Agent lease expired after job delivery; the physical print outcome is unknown. Guard retry is required.'
     AND OLD.details->>'outcomeAmbiguous' = 'true'
     AND NOT (OLD.details ? 'resultIdempotencyKey')
     AND NEW.status IN ('PRINTED', 'FAILED')
     AND NEW.details->>'lateResult' = 'true'
     AND NEW.details ? 'resultIdempotencyKey'
     AND NEW.agent_id IS NOT DISTINCT FROM OLD.agent_id
     AND NEW.route IS NOT DISTINCT FROM OLD.route
     AND NEW.printer IS NOT DISTINCT FROM OLD.printer
     AND NEW.lease_token_sha256 IS NOT DISTINCT FROM OLD.lease_token_sha256
     AND NEW.leased_at IS NOT DISTINCT FROM OLD.leased_at THEN
    RETURN NEW;
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
