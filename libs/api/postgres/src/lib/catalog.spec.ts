import { canonicalTimeZone } from './catalog';

describe('canonicalTimeZone', () => {
  it('replaces alias zone names PostgreSQL may not have installed', () => {
    expect(canonicalTimeZone('America/Indianapolis')).toBe('America/Indiana/Indianapolis');
    expect(canonicalTimeZone('US/East-Indiana')).toBe('America/Indiana/Indianapolis');
  });

  it('leaves canonical zones alone', () => {
    expect(canonicalTimeZone('America/Indiana/Indianapolis')).toBe('America/Indiana/Indianapolis');
    expect(canonicalTimeZone('America/Chicago')).toBe('America/Chicago');
  });
});
