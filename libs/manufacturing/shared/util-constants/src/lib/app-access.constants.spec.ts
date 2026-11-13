import { canEditMeshForgeApp, canUseMeshForgeAction } from './app-access.constants';

describe('custom role display permissions', () => {
  it('recognizes quality and printing actions without bypassing department ownership', () => {
    expect(canEditMeshForgeApp('GREENSHED', 'user', '48', ['greenshed:qualityCheck'])).toBe(true);
    expect(canEditMeshForgeApp('GREENSHED', 'user', '45', ['greenshed:qualityCheck'])).toBe(false);
    expect(canEditMeshForgeApp('CUTTER_BUILDER', 'user', '45', ['cutter-builder:printCutterCard'])).toBe(true);
  });
  it('keeps read-only roles out of operational navigation and honors exact action grants', () => {
    expect(canEditMeshForgeApp('BLADE_TRACKING', 'user', '45', ['trays:getDashboard'])).toBe(false);
    expect(canUseMeshForgeAction({ role: 'user', permissions: ['trays:completeGrinding'] }, 'trays:startGrinding')).toBe(false);
    expect(canUseMeshForgeAction({ role: 'user', permissions: ['trays:completeGrinding'] }, 'trays:completeGrinding')).toBe(true);
  });
  it('preserves legacy department access for accounts without an assigned role', () => {
    expect(canEditMeshForgeApp('BLADE_TRACKING', 'user', '45')).toBe(true);
    expect(canEditMeshForgeApp('BLADE_TRACKING', 'user', '48')).toBe(false);
    expect(canEditMeshForgeApp('BLADE_TRACKING', 'admin', null, [])).toBe(true);
  });
});
