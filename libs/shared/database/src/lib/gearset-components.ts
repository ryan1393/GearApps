/** Enforce component roles and the assembly's own summary, without guessing ratios or unifying revisions. */
export const GEARSET_COMPONENT_INTEGRITY_SQL = `
DO $validate_components$
BEGIN
  IF EXISTS(
    SELECT 1 FROM public.gearsets g JOIN public.parts gp ON gp.id=g.gearset_part_id JOIN public.part_types gt ON gt.id=gp.part_type_id
    JOIN public.parts r ON r.id=g.ring_part_id JOIN public.part_types rt ON rt.id=r.part_type_id
    JOIN public.parts p ON p.id=g.pinion_part_id JOIN public.part_types pt ON pt.id=p.part_type_id
    WHERE gt.code<>'GEARSET' OR rt.code<>'RING' OR pt.code<>'PINION' OR gp.summary_id<>g.summary_id
      OR r.teeth IS NULL OR p.teeth IS NULL OR r.teeth<=0 OR p.teeth<=0
  ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid gearset component roles, tooth counts or assembly summary require review'; END IF;
END $validate_components$;

ALTER TABLE public.gearsets ADD CONSTRAINT ck_gearsets_positive_finite_ratio CHECK(ratio_value>0 AND ratio_value<>'NaN'::numeric);
CREATE FUNCTION meshforge_meta.check_gearset_components() RETURNS trigger LANGUAGE plpgsql AS $gearset_components$
BEGIN
  IF EXISTS(
    SELECT 1 FROM public.gearsets g JOIN public.parts gp ON gp.id=g.gearset_part_id JOIN public.part_types gt ON gt.id=gp.part_type_id
    JOIN public.parts r ON r.id=g.ring_part_id JOIN public.part_types rt ON rt.id=r.part_type_id
    JOIN public.parts p ON p.id=g.pinion_part_id JOIN public.part_types pt ON pt.id=p.part_type_id
    WHERE (
      TG_TABLE_NAME='gearsets' AND g.id=NEW.id OR
      TG_TABLE_NAME='parts' AND NEW.id IN(g.gearset_part_id,g.ring_part_id,g.pinion_part_id) OR
      TG_TABLE_NAME='part_types' AND NEW.id IN(gp.part_type_id,r.part_type_id,p.part_type_id)
    ) AND (gt.code<>'GEARSET' OR rt.code<>'RING' OR pt.code<>'PINION' OR gp.summary_id<>g.summary_id
      OR r.teeth IS NULL OR p.teeth IS NULL OR r.teeth<=0 OR p.teeth<=0)
  ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Gearset component roles, tooth counts and assembly summary must remain consistent'; END IF;
  RETURN NEW;
END $gearset_components$;
-- Deferred checks permit valid multi-row maintenance transactions and validate their final state.
CREATE CONSTRAINT TRIGGER guard_gearset_components AFTER INSERT OR UPDATE ON public.gearsets
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION meshforge_meta.check_gearset_components();
CREATE CONSTRAINT TRIGGER guard_gearset_part_changes AFTER UPDATE ON public.parts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION meshforge_meta.check_gearset_components();
CREATE CONSTRAINT TRIGGER guard_gearset_type_changes AFTER UPDATE ON public.part_types
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION meshforge_meta.check_gearset_components();
`;
