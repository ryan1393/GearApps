export const FREQUENCY_MEASUREMENT_FIELDS = [
  { key: 'size_check', label: 'Size Check' },
  { key: 's_e_square', label: 'Sum Error Squared' },
  { key: 's_e_after', label: 'Sum Error After' },
  { key: 'flank1_pa', label: 'Flank 1 Pa' },
  { key: 'flank2_pa', label: 'Flank 2 Pa' },
  { key: 'flank1_sa', label: 'Flank 1 Sa' },
  { key: 'flank2_sa', label: 'Flank 2 Sa' },
  { key: 'total_fr', label: 'Total Fr' },
  { key: 'tooth_thickness', label: 'Tooth Thickness' },
] as const;

export const CMM_MEASUREMENT_FIELDS = [
  { key: 'sum_error_squared', label: 'Sum Error Squared' },
  { key: 'sum_error_after', label: 'Sum Error After' },
  { key: 'tooth_thickness', label: 'Tooth Thickness' },
  { key: 'total_fr', label: 'Total Fr' },
  { key: 'flank_1_pa', label: 'Flank 1 Pa' },
  { key: 'flank_2_pa', label: 'Flank 2 Pa' },
  { key: 'flank_1_sa', label: 'Flank 1 Sa' },
  { key: 'flank_2_sa', label: 'Flank 2 Sa' },
  { key: 'flank_1_warp', label: 'Flank 1 Warp' },
  { key: 'flank_2_warp', label: 'Flank 2 Warp' },
  { key: 'flank_1_toe_root', label: 'Flank 1 Toe Root' },
  { key: 'flank_2_toe_root', label: 'Flank 2 Toe Root' },
  { key: 'flank_1_toe_top', label: 'Flank 1 Toe Top' },
  { key: 'flank_2_toe_top', label: 'Flank 2 Toe Top' },
  { key: 'flank_1_heel_root', label: 'Flank 1 Heel Root' },
  { key: 'flank_2_heel_root', label: 'Flank 2 Heel Root' },
  { key: 'flank_1_heel_top', label: 'Flank 1 Heel Top' },
  { key: 'flank_2_heel_top', label: 'Flank 2 Heel Top' },
  { key: 'flank_1_fp', label: 'Flank 1 Fp' },
  { key: 'flank_2_fp', label: 'Flank 2 Fp' },
  { key: 'flank_1_fp_small', label: 'Flank 1 fp' },
  { key: 'flank_2_fp_small', label: 'Flank 2 fp' },
  { key: 'flank_1_fu', label: 'Flank 1 fu' },
  { key: 'flank_2_fu', label: 'Flank 2 fu' },
  { key: 'flank_1_frs', label: 'Flank 1 Frs' },
  { key: 'flank_2_frs', label: 'Flank 2 Frs' },
] as const;

export type FrequencyMeasurements = Partial<Record<
  (typeof FREQUENCY_MEASUREMENT_FIELDS)[number]['key'] | 's_e_result', number | null
>>;
export type CmmMeasurements = Partial<Record<
  (typeof CMM_MEASUREMENT_FIELDS)[number]['key'] | 'result', number | null
>>;
