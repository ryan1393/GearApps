import { Machine } from '@meshforge/shared/domain';

export interface Cell {
  id: string;
  machines: Machine[];
  active: number;
}

const UNASSIGNED = 'Unassigned';

/** Groups machines by cell, numerically sorted, unassigned last. */
export function groupByCell(machines: Machine[]): Cell[] {
  const map = new Map<string, Machine[]>();
  for (const m of machines) {
    const key = m.cell?.trim() || UNASSIGNED;
    map.set(key, [...(map.get(key) ?? []), m]);
  }
  return [...map.entries()]
    .map(([id, ms]) => ({
      id,
      machines: ms.sort((a, b) => (a.number ?? '').localeCompare(b.number ?? '')),
      active: ms.filter((m) => m.status?.toLowerCase() === 'active').length,
    }))
    .sort((a, b) => {
      if (a.id === UNASSIGNED) return 1;
      if (b.id === UNASSIGNED) return -1;
      return Number(a.id) - Number(b.id) || a.id.localeCompare(b.id);
    });
}
