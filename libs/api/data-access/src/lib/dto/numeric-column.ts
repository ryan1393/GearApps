import { ValidationOptions, ValidateBy, buildMessage } from 'class-validator';

/**
 * Largest magnitude a PostgreSQL numeric(precision, scale) column stores. PostgreSQL rounds
 * extra decimal places (half away from zero), so a value that would round up to 10^(p-s)
 * overflows too and is excluded.
 */
export const numericColumnLimit = (precision: number, scale: number): number =>
  10 ** (precision - scale) - 5 * 10 ** -(scale + 1);

/** Whether `value` is a finite number a numeric(precision, scale) column can store. */
export const fitsNumericColumn = (value: unknown, precision: number, scale: number): boolean =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  Math.abs(value) < numericColumnLimit(precision, scale);

const largest = (precision: number, scale: number): string =>
  '9'.repeat(precision - scale) + (scale ? '.' + '9'.repeat(scale) : '');

/**
 * A finite number that fits a numeric(precision, scale) column. Extra decimal places are
 * rounded by the database, as before; a value too large is refused here (HTTP 422) instead
 * of failing in PostgreSQL (numeric field overflow, HTTP 500).
 */
export function IsNumericColumn(
  precision: number,
  scale: number,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isNumericColumn',
      constraints: [precision, scale],
      validator: {
        validate: (value) => fitsNumericColumn(value, precision, scale),
        defaultMessage: buildMessage(
          (each) =>
            `${each}$property must be a number between -${largest(precision, scale)} and ${largest(precision, scale)}` +
            (scale ? ` (stored with ${scale} decimal places; further places are rounded)` : ''),
          options,
        ),
      },
    },
    options,
  );
}
