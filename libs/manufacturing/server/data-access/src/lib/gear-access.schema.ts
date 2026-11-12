/** Additive, restart-safe schema. Existing users have no assignment and retain legacy access. */
export const GEAR_ACCESS_SCHEMA = `
CREATE TABLE IF NOT EXISTS public.meshforge_roles (
  id uuid PRIMARY KEY, name varchar(80) NOT NULL, permissions jsonb NOT NULL DEFAULT '[]',
  enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS meshforge_roles_name ON public.meshforge_roles(lower(name));
CREATE TABLE IF NOT EXISTS public.meshforge_user_roles (
  user_id uuid PRIMARY KEY REFERENCES public.users(id), role_id uuid NOT NULL REFERENCES public.meshforge_roles(id)
);
CREATE TABLE IF NOT EXISTS public.meshforge_badges (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id), uid_hash varchar(64) NOT NULL,
  revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS meshforge_badges_live_uid ON public.meshforge_badges(uid_hash) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS meshforge_badges_live_user ON public.meshforge_badges(user_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS public.meshforge_access_audit (
  id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES public.users(id), action text NOT NULL,
  target_id uuid NOT NULL, detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);`;
