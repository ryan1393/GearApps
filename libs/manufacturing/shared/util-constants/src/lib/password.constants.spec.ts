import { isStrongPassword } from './password.constants';

describe('isStrongPassword', () => {
  it('accepts a password with every required character class', () => {
    expect(isStrongPassword('Valid-Password1!')).toBe(true);
  });

  it.each([
    ['too short', 'Va1!'],
    ['no uppercase', 'valid-password1!'],
    ['no lowercase', 'VALID-PASSWORD1!'],
    ['no number', 'Valid-Password!'],
    ['no symbol', 'ValidPassword1'],
    ['too long', 'Valid-Password1!'.repeat(3)],
    ['empty', ''],
  ])('rejects a password with %s', (_reason, password) => {
    expect(isStrongPassword(password)).toBe(false);
  });

  it('treats a missing value as weak', () => {
    expect(isStrongPassword(null)).toBe(false);
    expect(isStrongPassword(undefined)).toBe(false);
  });
});
