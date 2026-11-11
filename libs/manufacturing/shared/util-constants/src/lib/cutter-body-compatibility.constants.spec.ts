import {
  CUTTER_BODY_RULES,
  cutterBodyBladeSets,
  cutterBodyTotalBlades,
  decodeDanaCutterSerial,
  evaluateCutterBodyCompatibility,
  formatBladeSetQuantity,
  isApprovedBladeSetCount,
  resolveCutterBodyRule,
  summaryBodyRuleState,
} from './cutter-body-compatibility.constants';

const body = (dana: string | null, mf: string | null = 'A12345', definition: Record<string, string> | null = null) =>
  ({ dana_serial_number: dana, mf_serial_number: mf, definition });

describe('approved cutter-body rules', () => {
  it('states every approved requirement in total blades, stored as matched sets', () => {
    expect(CUTTER_BODY_RULES.map((r) => [r.code, r.total_blades, r.blade_sets])).toEqual([
      ['064', 22, 11], ['076', 26, 13], ['088', 34, 17], ['105', 38, 19], ['105-SPECIAL', 26, 13],
    ]);
  });

  it.each([
    ['CGRT064AAA', '064', 22], ['CGLT076AAA', '076', 26], ['CGRT088AAA', '088', 34],
    ['CGRT105AAB', '105', 38], ['CGRT1058AA', '105-SPECIAL', 26],
  ])('%s resolves to %s with %i total blades', (serial, code, total) => {
    expect(resolveCutterBodyRule(body(serial)).rule?.code).toBe(code);
    expect(cutterBodyTotalBlades(body(serial))).toBe(total);
    expect(cutterBodyBladeSets(body(serial))).toBe(total / 2);
  });

  it('decodes each Dana S/N position and keeps leading zeros', () => {
    expect(decodeDanaCutterSerial(' cglt064aaa ')).toMatchObject({
      valid: true, serial: 'CGLT064AAA', cutter_head_code: 'C', supplier_code: 'G', hand_code: 'L',
      blade_family_code: 'T', size_code: '064', special_character: 'A',
    });
  });
});

describe('special 105 uses the eighth Dana S/N character only', () => {
  it('ignores an 8 anywhere other than the eighth character', () => {
    expect(resolveCutterBodyRule(body('CGRT105A8A')).rule?.code).toBe('105');
    expect(resolveCutterBodyRule(body('CGRT105AA8')).rule?.code).toBe('105');
  });
  it('ignores an 8 that is only in the manufacturer serial', () => {
    expect(resolveCutterBodyRule(body('CGRT105AAA', '1058888')).rule?.code).toBe('105');
  });
  it('never decodes the MF serial when the Dana S/N is missing', () => {
    expect(resolveCutterBodyRule(body(null, 'CGRT1058AA')).rule).toBeNull();
    expect(cutterBodyBladeSets(body(null, 'X105'))).toBeNull();
  });
  it('does not make a non-105 body special', () => {
    expect(resolveCutterBodyRule(body('CGRT0768AA')).rule?.code).toBe('076');
    expect(resolveCutterBodyRule(body('CGRT0888AA')).rule?.code).toBe('088');
    expect(resolveCutterBodyRule(body('CGRT0648AA')).rule?.code).toBe('064');
  });
});

describe('missing, short and malformed serials stay unresolved', () => {
  it.each([
    [null], [''], ['   '], ['CGRT105'], ['CGRT10'], ['CGR-T1058AA'], ['CGRT-105-8AA'], ['CG RT1058AA'],
    ['CGRT099AAA'], ['CGRT76AAAA'], ['1GRT105AAA'], ['A105CGRT8A'],
  ])('%p has no capacity', (serial) => {
    expect(resolveCutterBodyRule(body(serial)).rule).toBeNull();
    expect(resolveCutterBodyRule(body(serial)).problem).toEqual(expect.any(String));
  });
  it('does not shift positions by removing punctuation', () => {
    // Stripping "-" would turn this into CGRT1058AA (special 105). It must stay unresolved.
    expect(decodeDanaCutterSerial('CGRT105-8A').valid).toBe(false);
  });
  it('rejects a Dana S/N that conflicts with its linked definition', () => {
    const conflict = resolveCutterBodyRule(body('CGRT105AAA', null, { size_code: '088', hand_code: 'R' }));
    expect(conflict.rule).toBeNull();
    expect(conflict.problem).toContain('conflicts');
    expect(resolveCutterBodyRule(body('CGRT076AAA', null, { size_code: '76', hand_code: 'R', blade_family_code: 'T' })).rule?.code).toBe('076');
    expect(resolveCutterBodyRule(body('CGLT076AAA', null, { size_code: '076', hand_code: 'R' })).rule).toBeNull();
  });
});

describe('body compatibility', () => {
  const std076 = body('CGRT076AAA');
  const special105 = body('CGRT1058AA');
  const std105 = body('CGRT105AAA');

  it('matches unique quantities to their own body only', () => {
    expect(evaluateCutterBodyCompatibility(std105, 19, 'RING').compatible).toBe(true);
    expect(evaluateCutterBodyCompatibility(special105, 19, 'RING').compatible).toBe(false);
    expect(evaluateCutterBodyCompatibility(std105, 13, 'PINION').compatible).toBe(false);
  });

  it('blocks both 26-blade bodies until the Summary Body Size Rule is set', () => {
    const a = evaluateCutterBodyCompatibility(std076, 13, 'RING');
    const b = evaluateCutterBodyCompatibility(special105, 13, 'RING');
    expect([a.compatible, b.compatible]).toEqual([false, false]);
    expect(a.reason).toContain('Body Size Rule is not set');
    expect(b.reason).toContain('076 Standard or 105 Special');
  });

  it('keeps existing 076 and special-105 mappings usable once configured', () => {
    expect(evaluateCutterBodyCompatibility(std076, 13, 'RING', '076').compatible).toBe(true);
    expect(evaluateCutterBodyCompatibility(special105, 13, 'RING', '105-SPECIAL').compatible).toBe(true);
  });

  it('does not let equal quantities bypass a configured Summary rule', () => {
    expect(evaluateCutterBodyCompatibility(special105, 13, 'RING', '105-SPECIAL')).toMatchObject({ compatible: true, warning: null });
    expect(evaluateCutterBodyCompatibility(std076, 13, 'RING', '105-SPECIAL').compatible).toBe(false);
    expect(evaluateCutterBodyCompatibility(special105, 13, 'PINION', '076').compatible).toBe(false);
    expect(evaluateCutterBodyCompatibility(std076, 13, 'PINION', '076').compatible).toBe(true);
  });

  it('rejects a requirement that disagrees with the configured rule', () => {
    expect(evaluateCutterBodyCompatibility(std105, 19, 'RING', '105-SPECIAL').compatible).toBe(false);
  });

  it('rejects unapproved or total-blade quantities rather than guessing their unit', () => {
    for (const quantity of [0, 38, 26, 22, 34, 12, Number.NaN]) {
      expect(evaluateCutterBodyCompatibility(std105, quantity, 'RING').compatible).toBe(false);
    }
  });

  it('does not impose handedness by Part Type', () => {
    const leftHand = body('CGLT105AAA');
    expect(evaluateCutterBodyCompatibility(leftHand, 19, 'RING').compatible).toBe(true);
    expect(evaluateCutterBodyCompatibility(std105, 19, 'PINION').compatible).toBe(true);
  });
});

describe('Summary-based requirement state', () => {
  it('derives unique rules, leaves 26 blades unresolved and reports conflicts', () => {
    expect(summaryBodyRuleState(null, [17, 17])).toMatchObject({ status: 'DERIVED', blade_sets: 17, effective_rule: { code: '088', total_blades: 34 } });
    expect(summaryBodyRuleState(null, [13, 13])).toMatchObject({ status: 'UNRESOLVED', effective_rule: null });
    expect(summaryBodyRuleState('105-SPECIAL', [13, 13])).toMatchObject({ status: 'CONFIGURED', effective_rule: { code: '105-SPECIAL' } });
    expect(summaryBodyRuleState('076', [13, 13])).toMatchObject({ status: 'CONFIGURED', effective_rule: { code: '076' } });
    expect(summaryBodyRuleState(null, [19, 13]).status).toBe('CONFLICT');
    expect(summaryBodyRuleState('105', [13, 13]).status).toBe('CONFLICT');
    expect(summaryBodyRuleState(null, []).status).toBe('NO_REQUIREMENT');
  });

  it('formats both units', () => {
    expect(formatBladeSetQuantity(19)).toBe('19 sets · 38 blades');
    expect(formatBladeSetQuantity(null)).toBe('Unknown');
    expect(isApprovedBladeSetCount(13)).toBe(true);
    expect(isApprovedBladeSetCount(26)).toBe(false);
  });
});
