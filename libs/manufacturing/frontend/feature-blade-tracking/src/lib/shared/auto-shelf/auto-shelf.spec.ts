import { AutoShelfLocation, autoShelfFor, locationPartTypeCode, trayMayMoveTo } from './auto-shelf';

const shelf = (serial: string, summary: string | null, overrides: Partial<AutoShelfLocation> = {}): AutoShelfLocation => ({
  id: serial,
  serial_number: serial,
  enabled: true,
  department: 'CUTTERGRIND',
  location_type: 'SHELF',
  summary: summary ? { number: summary } : null,
  part_type: null,
  ...overrides,
});

describe('autoShelfFor', () => {
  it('selects the only shelf holding the Summary and part type', () => {
    const shelves = [shelf('CGDR-A1A', '1.955FC'), shelf('CGDR-A1B', '2.100FC'), shelf('CGDP-A1A', '1.955FC')];
    const result = autoShelfFor(shelves, '1.955fc', 'RING');
    expect(result.shelf?.serial_number).toBe('CGDR-A1A');
    expect(result.matches).toHaveLength(1);
  });

  it('selects nothing when two shelves hold the same Summary and part type', () => {
    const shelves = [shelf('CGDR-A1A', '1.955FC'), shelf('CGDR-B2C', '1.955FC')];
    const result = autoShelfFor(shelves, '1.955FC', 'RING');
    expect(result.shelf).toBeNull();
    expect(result.matches.map((m) => m.serial_number)).toEqual(['CGDR-A1A', 'CGDR-B2C']);
  });

  it('selects nothing when no shelf holds them, or the tray has no Summary or part type', () => {
    const shelves = [shelf('CGDR-A1A', '1.955FC')];
    expect(autoShelfFor(shelves, '2.100FC', 'RING').shelf).toBeNull();
    expect(autoShelfFor(shelves, '1.955FC', 'PINION').shelf).toBeNull();
    expect(autoShelfFor(shelves, null, 'RING').shelf).toBeNull();
    expect(autoShelfFor(shelves, '1.955FC', undefined).shelf).toBeNull();
  });

  it('ignores disabled locations and locations that are not shelves', () => {
    const shelves = [
      shelf('CGDR-A1A', '1.955FC', { enabled: false }),
      shelf('BENCH-1', '1.955FC', { location_type: 'WORKCENTER', part_type: { code: 'RING' } }),
      shelf('CGDR-A1B', '1.955FC'),
    ];
    expect(autoShelfFor(shelves, '1.955FC', 'RING').shelf?.serial_number).toBe('CGDR-A1B');
  });

  it('reads the part type from the barcode first, then from the location', () => {
    expect(locationPartTypeCode(shelf('CGFP-A1A', null, { part_type: { code: 'RING' } }))).toBe('PINION');
    expect(locationPartTypeCode(shelf('RACK-1', null, { part_type: { code: 'ring' } }))).toBe('RING');
    expect(autoShelfFor([shelf('RACK-1', '1.955FC', { part_type: { code: 'RING' } })], '1.955FC', 'RING').shelf?.id).toBe('RACK-1');
  });
});

describe('trayMayMoveTo', () => {
  const tray = (stage: string, partType = 'RING') => ({ current_stage: { code: stage }, part_type: { code: partType } });

  it('matches each Cuttergrind shelf to the tray stage it takes', () => {
    expect(trayMayMoveTo(shelf('CGDR-A1A', null), tray('WAITING_FOR_GRINDING'))).toBe(true);
    expect(trayMayMoveTo(shelf('CGDR-A1A', null), tray('READY_FOR_CUTTER'))).toBe(false);
    expect(trayMayMoveTo(shelf('CGFR-A1A', null), tray('READY_FOR_CUTTER'))).toBe(true);
    expect(trayMayMoveTo(shelf('CGRR-A1A', null), tray('READY_FOR_COATING'))).toBe(true);
    expect(trayMayMoveTo(shelf('CGRR-A1A', null), tray('WAITING_FOR_GRINDING'))).toBe(false);
  });

  it('refuses a shelf for the other part type, legacy rough tags and Green Shed shelves', () => {
    expect(trayMayMoveTo(shelf('CGDP-A1A', null), tray('WAITING_FOR_GRINDING', 'RING'))).toBe(false);
    expect(trayMayMoveTo(shelf('CGRR', null), tray('READY_FOR_COATING'))).toBe(false);
    expect(trayMayMoveTo(shelf('GSR-1.955FC', null, { department: 'GREENSHED' }), tray('READY_FOR_CUTTER'))).toBe(false);
    expect(trayMayMoveTo(shelf('CGDR-A1A', null, { enabled: false }), tray('WAITING_FOR_GRINDING'))).toBe(false);
  });

  it('allows other locations whatever the stage', () => {
    expect(trayMayMoveTo(shelf('RACK-1', null, { department: null }), tray('GRINDING'))).toBe(true);
  });
});
