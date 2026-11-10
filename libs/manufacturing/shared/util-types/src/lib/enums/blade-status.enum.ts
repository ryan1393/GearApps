export enum BladeStatus {
  NEW = 'new',
  GRINDING = 'grinding',
  READY_FOR_COATING = 'ready_for_coating',
  AT_COATER = 'at_coater',
  RETURNED_FROM_COATING = 'returned_from_coating',
  AVAILABLE = 'available',
  IN_CUTTER = 'in_cutter',
  WAITING_FOR_GRINDING = 'waiting_for_grinding',
  RESHARPENING = 'resharpening',
  HOLD = 'hold',
  SCRAPPED = 'scrapped',
}
