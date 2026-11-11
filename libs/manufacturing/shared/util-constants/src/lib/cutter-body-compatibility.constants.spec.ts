import {
  CUTTER_BODY_RULES,
  buildCutterBodyCompatibilityMatrix,
  cutterBodyRuleByCode,
  danaSerialEntryProblem,
  permittedCutterBodyDefinitions,
  cutterBodyBladeSets,
  cutterBodyTotalBlades,
  decodeDanaCutterSerial,
  evaluateCutterBodyCompatibility,
  formatBladeSetQuantity,
  isApprovedBladeSetCount,
  resolveCutterBodyRule,
  summaryBodyRuleState,
} from './cutter-body-compatibility.constants';

const body = (dana: string | null, mf: string | null = 'A12345', definition: Record<string, string | boolean> | null = null) =>
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

// The six definitions in tools/manufacturing/base-data/data/cutter_body_definitions.json.
const DEFINITIONS = ['CGRT076', 'CGLT076', 'CGRT088', 'CGLT088', 'CGRT105', 'CGLT105'].map((code) => ({
  id: `def-${code}`, definition_code: code, cutter_head_code: 'C', supplier_code: 'G', hand_code: code.charAt(2),
  blade_family_code: 'T', blade_family_name: 'TRI-AC', size_code: code.slice(4), enabled: true,
}));
const def = (code: string) => DEFINITIONS.find((d) => d.definition_code === code) as unknown as Record<string, string | boolean>;

describe('unetched (MF-only) bodies', () => {
  it('use their explicitly linked non-105 definition', () => {
    const resolved = resolveCutterBodyRule(body(null, '8612', def('CGLT076')));
    expect(resolved).toMatchObject({ rule: { code: '076', total_blades: 26 }, source: 'DEFINITION', problem: null });
    expect(resolveCutterBodyRule(body(null, 'A1', def('CGRT088'))).rule?.code).toBe('088');
    expect(evaluateCutterBodyCompatibility(body(null, '8612', def('CGLT076')), 13, 'PINION', '076').compatible).toBe(true);
    expect(evaluateCutterBodyCompatibility(body(null, 'A1', def('CGRT088')), 17, 'RING').compatible).toBe(true);
  });
  it('never guess Standard or Special for a 105 definition', () => {
    const resolved = resolveCutterBodyRule(body(null, '78', def('CGRT105')));
    expect(resolved.rule).toBeNull();
    expect(resolved.problem).toContain('8th Dana S/N character');
    expect(evaluateCutterBodyCompatibility(body(null, '78', def('CGRT105')), 19, 'RING').compatible).toBe(false);
    expect(evaluateCutterBodyCompatibility(body(null, '78', def('CGRT105')), 13, 'RING', '105-SPECIAL').compatible).toBe(false);
  });
  it('ignore an 8 in the MF serial and never decode it', () => {
    expect(resolveCutterBodyRule(body(null, 'CGRT1058AA', def('CGRT076'))).rule?.code).toBe('076');
    expect(resolveCutterBodyRule(body(null, 'CGRT1058AA')).rule).toBeNull();
  });
  it('do not fall back to the definition when a Dana S/N is present but malformed', () => {
    for (const serial of ['CGRT-076AA', 'CGRT07', 'CGRT099AAA']) {
      expect(resolveCutterBodyRule(body(serial, 'A1', def('CGRT076'))).rule).toBeNull();
    }
  });
  it('keep the decoded Dana S/N once it is assigned to the same body', () => {
    expect(resolveCutterBodyRule(body('CGLT076AAA', '8612', def('CGLT076')))).toMatchObject({ source: 'DANA_SERIAL', rule: { code: '076' } });
  });
});

describe('Dana S/N entry check', () => {
  it('allows blank (unetched) and valid serials that fit the definition', () => {
    expect(danaSerialEntryProblem('', def('CGRT105'))).toBeNull();
    expect(danaSerialEntryProblem(null, null)).toBeNull();
    expect(danaSerialEntryProblem('cgrt1058ad', def('CGRT105'))).toBeNull();
    expect(danaSerialEntryProblem('CGRT076AAA', null)).toBeNull();
  });
  it('refuses malformed serials and serials that contradict the definition', () => {
    expect(danaSerialEntryProblem('CGRT-1058A', null)).toContain('letters and digits');
    expect(danaSerialEntryProblem('CGRT10', null)).toContain('shorter than 8');
    expect(danaSerialEntryProblem('CGLT076AAA', def('CGRT076'))).toContain('hand');
    expect(danaSerialEntryProblem('CGRT088AAA', def('CGRT076'))).toContain('body size');
  });
});

describe('body types', () => {
  it('reject a body whose definition is disabled even when capacity matches', () => {
    const disabled = { ...def('CGRT076'), enabled: false };
    const result = evaluateCutterBodyCompatibility(body('CGRT076AAA', 'A1', disabled), 13, 'RING', '076');
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain('disabled');
  });
  it('reject an incompatible body although its blade capacity is the same', () => {
    // 076 Standard and 105 Special are both 26 blades / 13 sets.
    expect(evaluateCutterBodyCompatibility(body('CGRT1058AA', 'A1', def('CGRT105')), 13, 'RING', '076').compatible).toBe(false);
    expect(evaluateCutterBodyCompatibility(body('CGRT076AAA', 'A1', def('CGRT076')), 13, 'RING', '105-SPECIAL').compatible).toBe(false);
  });
  it('keep the legacy RING/PINION blade-family restriction and add no hand restriction', () => {
    const ringOnly = { ...def('CGRT088'), blade_family_name: 'RING' };
    expect(evaluateCutterBodyCompatibility(body('CGRT088AAA', 'A1', ringOnly), 17, 'PINION').compatible).toBe(false);
    expect(evaluateCutterBodyCompatibility(body('CGRT088AAA', 'A1', ringOnly), 17, 'RING').compatible).toBe(true);
    expect(evaluateCutterBodyCompatibility(body('CGLT088AAA', 'A1', def('CGLT088')), 17, 'RING').compatible).toBe(true);
    expect(evaluateCutterBodyCompatibility(body('CGRT088AAA', 'A1', def('CGRT088')), 17, 'PINION').compatible).toBe(true);
  });
});

describe('Summary + Part Type permitted body definitions', () => {
  it('lists every enabled definition of the rule size, both hands', () => {
    expect(permittedCutterBodyDefinitions(cutterBodyRuleByCode('076'), 'RING', DEFINITIONS).map((d) => d.definition_code)).toEqual(['CGLT076', 'CGRT076']);
    const special = permittedCutterBodyDefinitions(cutterBodyRuleByCode('105-SPECIAL'), 'PINION', DEFINITIONS);
    expect(special.map((d) => [d.definition_code, d.body_rule])).toEqual([['CGLT105', '105-SPECIAL'], ['CGRT105', '105-SPECIAL']]);
    expect(special[0].condition).toContain('8th character is 8');
    expect(permittedCutterBodyDefinitions(cutterBodyRuleByCode('064'), 'RING', DEFINITIONS)).toEqual([]);
    expect(permittedCutterBodyDefinitions(null, 'RING', DEFINITIONS)).toEqual([]);
    expect(permittedCutterBodyDefinitions(cutterBodyRuleByCode('076'), 'RING', DEFINITIONS.map((d) => ({ ...d, enabled: d.hand_code === 'L' }))).map((d) => d.definition_code)).toEqual(['CGLT076']);
  });

  const summary = (number: string, sets: number, rule: string | null = null, extra: Partial<{ hos: string; model_number: string; ringEnabled: boolean }> = {}) => ({
    summary_id: `s-${number}`, summary_number: number, summary_revision: '', model_number: extra.model_number ?? null, hos: extra.hos ?? null,
    configured_body_rule: rule,
    requirements: [{ part_type_code: 'PINION', required_blade_count: sets, enabled: true }, { part_type_code: 'RING', required_blade_count: sets, enabled: extra.ringEnabled ?? true }],
  });

  it('builds the matrix with configured, supported, unresolved and conflicting rows', () => {
    const rows = buildCutterBodyCompatibilityMatrix([
      summary('30538', 19, null, { hos: 'RH' }), summary('32209', 17), summary('30131', 13, null, { model_number: '286' }),
      summary('30132', 13, '105-SPECIAL', { model_number: '286' }), summary('1052', 13, '076'), summary('X', 13, '105'),
      summary('Y', 17, null, { ringEnabled: false }),
    ], DEFINITIONS);
    const row = (n: string, pt: string) => rows.find((r) => r.summary_number === n && r.part_type_code === pt);
    expect(row('30538', 'PINION')).toMatchObject({ body_rule: '105', required_total_blades: 38, evidence: 'SUPPORTED', hos: 'RH' });
    expect(row('30538', 'PINION')?.permitted_definitions.map((d) => d.definition_code)).toEqual(['CGLT105', 'CGRT105']);
    expect(row('32209', 'RING')).toMatchObject({ body_rule: '088', required_total_blades: 34, evidence: 'SUPPORTED' });
    expect(row('30131', 'RING')).toMatchObject({ body_rule: null, evidence: 'UNRESOLVED', permitted_definitions: [] });
    expect(row('30132', 'RING')).toMatchObject({ body_rule: '105-SPECIAL', required_total_blades: 26, evidence: 'CONFIGURED' });
    expect(row('1052', 'PINION')?.permitted_definitions.map((d) => d.definition_code)).toEqual(['CGLT076', 'CGRT076']);
    expect(row('X', 'RING')).toMatchObject({ evidence: 'CONFLICTING', permitted_definitions: [] });
    expect(row('Y', 'RING')).toMatchObject({ evidence: 'DISABLED', permitted_definitions: [] });
    expect(row('Y', 'PINION')).toMatchObject({ evidence: 'SUPPORTED', body_rule: '088' });
  });

  it('agrees with the build check: a body is accepted exactly when its definition is permitted and its rule matches', () => {
    const bodies = [
      body('CGRT076AAA', 'A1', def('CGRT076')), body('CGLT076AAB', 'A2', def('CGLT076')), body('CGRT1058AA', '78', def('CGRT105')),
      body('CGLT105AAA', 'A3', def('CGLT105')), body('CGRT088AAA', 'A4', def('CGRT088')), body(null, '8612', def('CGLT076')),
    ];
    for (const s of [summary('A', 13, '076'), summary('B', 13, '105-SPECIAL'), summary('C', 19), summary('D', 17), summary('E', 13)]) {
      for (const row of buildCutterBodyCompatibilityMatrix([s], DEFINITIONS)) {
        for (const b of bodies) {
          const accepted = evaluateCutterBodyCompatibility(b, row.required_blade_sets, row.part_type_code, s.configured_body_rule).compatible;
          const listed = row.permitted_definitions.some((d) => d.definition_code === b.definition?.['definition_code']) &&
            resolveCutterBodyRule(b).rule?.code === row.body_rule;
          expect([s.summary_number, row.part_type_code, b.dana_serial_number ?? b.mf_serial_number, accepted])
            .toEqual([s.summary_number, row.part_type_code, b.dana_serial_number ?? b.mf_serial_number, listed]);
        }
      }
    }
  });
});
