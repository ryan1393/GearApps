-- Explicit browser printing opt-out and recovery of automatic jobs never delivered to Windows.
ALTER TABLE public.truck_visits ADD COLUMN manual_printing boolean NOT NULL DEFAULT false;

CREATE TABLE public.automatic_print_job_recoveries (
    job_id uuid PRIMARY KEY REFERENCES public.automatic_driver_print_jobs(id),
    replacement_package_id uuid REFERENCES public.automatic_driver_print_packages(id),
    request_key varchar(128) NOT NULL,
    reason varchar(1000) NOT NULL CHECK (length(btrim(reason)) > 0),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (job_id, request_key)
);
CREATE FUNCTION public.protect_automatic_print_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Print recovery history is immutable'; END IF;
  PERFORM 1 FROM public.automatic_driver_print_jobs WHERE id=NEW.job_id AND status='FAILED' AND leased_at IS NULL FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.automatic_driver_print_attempts WHERE job_id=NEW.job_id AND leased_at IS NOT NULL)
    THEN RAISE EXCEPTION 'Only a never-leased failed job can be cancelled or replaced'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_automatic_print_recovery BEFORE INSERT OR UPDATE OR DELETE ON public.automatic_print_job_recoveries
FOR EACH ROW EXECUTE FUNCTION public.protect_automatic_print_recovery();

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
  IF OLD.status='QUEUED' AND NEW.status='FAILED' AND OLD.leased_at IS NULL
     AND NEW.lease_token_sha256 IS NULL AND NEW.attempt_count=OLD.attempt_count THEN RETURN NEW; END IF;
  IF (OLD.status='QUEUED' AND NEW.status='LEASED' AND NEW.attempt_count=OLD.attempt_count)
     OR (OLD.status='LEASED' AND NEW.status IN ('PRINTED','FAILED') AND NEW.attempt_count=OLD.attempt_count
         AND NEW.lease_token_sha256=OLD.lease_token_sha256 AND NEW.leased_at=OLD.leased_at AND NEW.lease_expires_at=OLD.lease_expires_at)
     OR (OLD.status='FAILED' AND NEW.status='QUEUED' AND NEW.attempt_count=OLD.attempt_count+1
         AND NOT EXISTS(SELECT 1 FROM public.automatic_print_job_recoveries recovery WHERE recovery.job_id=OLD.id)) THEN RETURN NEW; END IF;
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
  IF OLD.status='REQUESTED' AND NEW.status='FAILED' AND NEW.leased_at IS NULL AND NEW.claim_key IS NULL THEN RETURN NEW; END IF;
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

