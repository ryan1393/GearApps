import { danaToneFor } from '@dana/ui';

describe('danaToneFor', () => {
  it('colours Active/Inactive style statuses the same way everywhere', () => {
    expect(danaToneFor('Active')).toBe('success');
    expect(danaToneFor(' ENABLED ')).toBe('success');
    expect(danaToneFor(true)).toBe('success');
    expect(danaToneFor('Inactive')).toBe('danger');
    expect(danaToneFor('Disabled')).toBe('danger');
    expect(danaToneFor(false)).toBe('danger');
  });

  it('reads workflow statuses written with underscores', () => {
    expect(danaToneFor('ready_for_coating')).toBe('success');
    expect(danaToneFor('waiting_for_grinding')).toBe('warning');
    expect(danaToneFor('at_coater')).toBe('info');
    expect(danaToneFor('in_cutter')).toBe('info');
    expect(danaToneFor('scrapped')).toBe('danger');
    expect(danaToneFor('LOW')).toBe('warning');
  });

  it('keeps unknown and negative statuses neutral', () => {
    expect(danaToneFor('Not set')).toBe('neutral');
    expect(danaToneFor('No Stage')).toBe('neutral');
    expect(danaToneFor('SHELF')).toBe('neutral');
    expect(danaToneFor(null)).toBe('neutral');
    expect(danaToneFor('')).toBe('neutral');
  });
});
