export interface CycleTestInput {
  machine_id: string;
  gearset_id: string;
  serial_number: string;
  values: Record<string, number>;
}
export interface CycleTestRun extends CycleTestInput {
  id: string;
  created_at: string;
  created_by: string;
  kind: 'SIMULATION';
  result: { passed: boolean; issues: string[]; macros: { number: number; name: string; type: string; value: number | null }[] };
}
