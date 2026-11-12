export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 32;
export const PASSWORD_MIN_UPPERCASE = 1;
export const PASSWORD_MIN_SYMBOL = 1;
export const PASSWORD_MIN_NUMBER = 1;

/**
 * The account password policy the API enforces: length, at most 72 UTF-8 bytes (bcrypt),
 * and at least one lowercase letter, uppercase letter, number and symbol.
 */
export function isStrongPassword(password: string | null | undefined): boolean {
  const value = String(password ?? '');
  const bytes = Array.from(value).reduce((count, char) => {
    const point = char.codePointAt(0) ?? 0;
    return count + (point > 0xffff ? 4 : point > 0x7ff ? 3 : point > 0x7f ? 2 : 1);
  }, 0);
  const count = (pattern: RegExp) => value.match(pattern)?.length ?? 0;
  return (
    value.length >= PASSWORD_MIN_LENGTH &&
    value.length <= PASSWORD_MAX_LENGTH &&
    bytes <= 72 &&
    count(/[a-z]/g) >= 1 &&
    count(/[A-Z]/g) >= PASSWORD_MIN_UPPERCASE &&
    count(/[0-9]/g) >= PASSWORD_MIN_NUMBER &&
    count(/[-#!$@£%^&*()_+|~=\x60{}[\]:";'<>?,./\\ ]/g) >= PASSWORD_MIN_SYMBOL
  );
}
