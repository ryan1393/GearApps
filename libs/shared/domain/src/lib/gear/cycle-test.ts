export interface CycleTestInput {
  machine_id: string;
  gearset_id: string;
  serial_number: string;
  values: Record<string, number>;
}
/** Cycle Test Lab > Read values from machine: the controller's current macro values. */
export interface ControllerMacroValues {
  machine_id: string;
  read_at: string;
  /** Macro number to value; null when the controller did not answer for it. */
  values: Record<string, number | null>;
}

export interface CycleTestRun extends CycleTestInput {
  id: string;
  created_at: string;
  created_by: string;
  kind: 'SIMULATION';
  result: { passed: boolean; issues: string[]; macros: {
      number: number;
      name: string;
      type: string;
      value: number | null;
      min_value?: number | null;
      max_value?: number | null;
      unit?: string | null;
    }[];
  };
}
