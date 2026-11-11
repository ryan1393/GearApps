import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  CycleTestInput,
  CycleTestRun,
  Macro,
  macroLimitState,
  macroLimitText,
} from '@meshforge/shared/domain';

export function validateCycleTest(macros: Macro[], values: Record<string, number>): CycleTestRun['result'] {
  const active = macros.filter(m => m.status === 1);
  const issues: string[] = [];
  if (!active.length) issues.push('No active macros are configured.');
  for (const key of Object.keys(values)) {
    if (!active.some(m => String(m.number) === key)) issues.push(`Macro #${key} is not active or configured.`);
  }
  const snapshot = active.map(m => {
    const value = values[String(m.number)];
    if (typeof value !== 'number' || !Number.isFinite(value)) issues.push(`Macro #${m.number} requires a finite numeric value.`);
    else if (Math.abs(value) >= 100000000) issues.push(`Macro #${m.number} exceeds the stored numeric range.`);
    else if (/^(int|integer)$/i.test(m.type) && !Number.isInteger(value)) issues.push(`Macro #${m.number} requires a whole number.`);
    else if (/^(bool|boolean|bit)$/i.test(m.type) && ![-1, 0, 1].includes(value)) issues.push(`Macro #${m.number} requires -1, 0 or 1.`);
    else {
      // The limits an administrator set for this macro in Admin > Macros.
      const state = macroLimitState(value, m);
      if (state !== 'ok') issues.push(`Macro #${m.number} (${m.name}) is ${value}, ${state === 'low' ? 'below' : 'above'} its limit of ${macroLimitText(m)}.`);
    }
    return {
      number: m.number, name: m.name, type: m.type,
      value: typeof value === 'number' && Number.isFinite(value) ? value : null,
      min_value: m.min_value ?? null, max_value: m.max_value ?? null, unit: m.unit ?? null,
    };
  });
  return { passed: issues.length === 0, issues, macros: snapshot };
}

@Injectable()
export class CycleTestsService {
  constructor(private readonly db: DataSource) {}
  async list(): Promise<CycleTestRun[]> {
    return this.db.query('SELECT * FROM lapper.cycle_tests ORDER BY created_at DESC, id DESC LIMIT 100');
  }
  async create(input: CycleTestInput, userId: string): Promise<CycleTestRun> {
    if (Object.keys(input.values).length > 2000) throw new BadRequestException('At most 2000 macro values are allowed.');
    return this.db.transaction(async manager => {
      const machines = await manager.query('SELECT id FROM lapper.machines WHERE id=$1 OR public_machine_id=$1', [input.machine_id]);
      const gearsets = await manager.query('SELECT id FROM lapper.gearsets WHERE id=$1 OR public_gearset_id=$1 UNION ALL SELECT id FROM public.gearsets WHERE id=$1', [input.gearset_id]);
      if (!machines.length || !gearsets.length) throw new BadRequestException('Choose a configured lapping machine and gearset.');
      const rows: Macro[] = await manager.query('SELECT * FROM lapper.macros ORDER BY tab_index NULLS LAST, number');
      // PostgreSQL returns numeric limits as text.
      const limit = (value: unknown) => (value == null ? null : Number(value));
      const macros = rows.map(m => ({ ...m, min_value: limit(m.min_value), max_value: limit(m.max_value) }));
      const result = validateCycleTest(macros, input.values);
      const [run] = await manager.query(`INSERT INTO lapper.cycle_tests
        (id,machine_id,gearset_id,serial_number,values,result,created_by)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) RETURNING *`,
        [randomUUID(), input.machine_id, input.gearset_id, input.serial_number.trim(), JSON.stringify(input.values), JSON.stringify(result), userId]);
      return run;
    });
  }
}
