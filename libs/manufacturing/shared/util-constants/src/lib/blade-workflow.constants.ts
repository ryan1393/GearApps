import { isCoaterStagingLocation, isCoaterStagingPlacement, parseCuttergrindRoughShelfTag } from './shelf-location.constants';

/** R37: inventory eligibility and grinding-pass rules. No persistence or UI effects. */
export const PENDING_GRINDING_STATUSES: readonly string[] = ['new', 'grinding', 'resharpening'];
export function isPendingGrindingStatus(status: string): boolean {
  return PENDING_GRINDING_STATUSES.includes(status);
}
export interface TrayWorkflowEligibility {
  intake: boolean;
  grinding: boolean;
  internal_movement: boolean;
  coater_load: boolean;
}
export interface TrayWorkflowInput {
  enabled: boolean;
  blade_count: number;
  summary_id?: string | null;
  part_type_id?: string | null;
  part_type?: { code?: string | null } | null;
  grinding_completed_at?: unknown;
  required_blade_count?: number | null;
  current_stage?: { code: string } | null;
  current_container?: unknown;
  current_location?: { serial_number?: string | null } | null;
  current_cutter_build?: unknown;
  blades: ReadonlyArray<{ status: string }>;
}
/** Missing or inconsistent inventory is not available to an operator workflow. */
export function trayWorkflowEligibility(tray: TrayWorkflowInput): TrayWorkflowEligibility {
  const stage = tray.current_stage?.code;
  const inHouse = tray.enabled && !tray.current_container && !tray.current_cutter_build;
  const consistent = Number.isInteger(tray.blade_count) && tray.blade_count >= 0 &&
    tray.blades.length === tray.blade_count;
  const configured = Boolean(tray.summary_id && tray.part_type_id);
  const preCoatingStatuses = tray.blades.every(b =>
    isPendingGrindingStatus(b.status) || b.status === 'ready_for_coating');
  const canStart = stage === 'WAITING_FOR_GRINDING' && tray.blades.length > 0 &&
    tray.blades.every(b => b.status === 'waiting_for_grinding');
  const completed = Boolean(tray.grinding_completed_at) && stage === 'READY_FOR_COATING' &&
    Number.isInteger(tray.required_blade_count) && Number(tray.required_blade_count) > 0;
  const short = completed && tray.blade_count < Number(tray.required_blade_count) &&
    tray.blades.every(b => b.status === 'ready_for_coating');
  const roughShelf = tray.part_type_id && tray.current_location?.serial_number
    ? String(tray.current_location.serial_number).trim().toUpperCase()
    : '';
  const partTypeCode = tray.part_type?.code?.trim().toUpperCase();
  const shelfTag = parseCuttergrindRoughShelfTag(roughShelf);
  // A ground, full tray waits for the coater at the staging area or on a matching rough shelf bin.
  const waitingForCoater = completed && (isCoaterStagingLocation(roughShelf) ||
    (Boolean(shelfTag) && shelfTag?.partTypeCode === partTypeCode));
  return {
    // Intake owns creation/top-up only. A dull tray waiting to begin grinding belongs on Grinding.
    intake: Boolean(inHouse && consistent && (
      (tray.blade_count === 0 && (stage === 'EMPTY' || stage === 'GRINDING' || short)) ||
      (configured && ((stage === 'GRINDING' && !tray.grinding_completed_at && preCoatingStatuses) || short))
    )),
    grinding: Boolean(inHouse && consistent && configured && (
      canStart || (stage === 'GRINDING' && !tray.grinding_completed_at && preCoatingStatuses)
    )),
    internal_movement: Boolean(inHouse && consistent && configured && tray.blade_count > 0 &&
      ['WAITING_FOR_GRINDING', 'GRINDING', 'READY_FOR_COATING', 'READY_FOR_CUTTER'].includes(stage ?? '')),
    coater_load: Boolean(inHouse && consistent && configured && completed && waitingForCoater &&
      tray.blade_count === tray.required_blade_count &&
      tray.blades.every(b => b.status === 'ready_for_coating')),
  };
}
export interface ContainerWorkflowEligibility { load: boolean; receive: boolean; }
/** The complete blade set a container holds, moved out of its tray (current way of packing). */
export interface ContainerBladeSetInput {
  required_blade_count: number;
  blades: ReadonlyArray<{ status: string }>;
}
/**
 * A container takes one complete set, so it can be loaded only while empty. It is received when
 * its set, or every tray packed in it the old way, has come back from the coater.
 */
export function containerWorkflowEligibility(
  enabled: boolean,
  assignmentCount: number,
  trays: ReadonlyArray<{ stage_code: string | null; blade_count: number; blades: ReadonlyArray<{ status: string }> }>,
  bladeSet: ContainerBladeSetInput | null = null,
): ContainerWorkflowEligibility {
  const setAtCoater = !!bladeSet && bladeSet.blades.length > 0 &&
    bladeSet.blades.length === bladeSet.required_blade_count && bladeSet.blades.every(b => b.status === 'at_coater');
  const traysAtCoater = assignmentCount > 0 && assignmentCount === trays.length &&
    trays.every(t => t.stage_code === 'AT_COATER' && t.blade_count > 0 &&
      t.blades.length === t.blade_count && t.blades.every(b => b.status === 'at_coater'));
  return {
    load: enabled && assignmentCount === 0 && !bladeSet,
    receive: enabled && (bladeSet ? assignmentCount === 0 && setAtCoater : traysAtCoater),
  };
}

/** Display classification for one current tray row, shared with the live verifier.
 * Stored READY_FOR_COATING also contains short or unstaged trays; do not claim
 * dispatch readiness from that status alone. No records are changed here.
 */
export interface TrayAvailabilityStageInput {
  stage_code: string; stage_name: string;
  blade_count: number; required_blade_count: number | null;
  grinding_completed_at?: unknown;
  part_type_code: string | null;
  location_serial: string | null;
  location_department?: string | null;
  location_type?: string | null;
  container_serial?: string | null;
}
export function classifyTrayAvailabilityStage(tray: TrayAvailabilityStageInput): { code: string; name: string } {
  if (tray.stage_code !== 'READY_FOR_COATING') return { code: tray.stage_code, name: tray.stage_name };
  const count = Number(tray.blade_count), required = Number(tray.required_blade_count);
  if (!tray.grinding_completed_at || !Number.isInteger(required) || required <= 0 ||
      !Number.isInteger(count) || count < 0 || count > required ||
      !['RING', 'PINION'].includes(tray.part_type_code ?? '') || tray.container_serial) {
    return { code: 'NEEDS_REVIEW', name: 'Inventory Needs Review' };
  }
  if (count < required) return { code: 'NEEDS_REPLACEMENT_BLADES', name: 'Needs Replacement Blades' };
  if (isCoaterStagingPlacement(tray.location_serial, tray.location_department)) {
    return { code: 'READY_FOR_COATING', name: 'Ready for Coating' };
  }
  const shelf = parseCuttergrindRoughShelfTag(tray.location_serial ?? '');
  if (!shelf || shelf.partTypeCode !== tray.part_type_code ||
      tray.location_department !== shelf.department || tray.location_type !== shelf.locationType) {
    return { code: 'NEEDS_SHELF_PLACEMENT', name: 'Needs Shelf Placement' };
  }
  return { code: 'READY_FOR_COATING', name: 'Ready for Coating' };
}
