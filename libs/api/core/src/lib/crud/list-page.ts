/** Rows a capped list returns when no page is asked for, and the largest page that may be asked for. */
export const LIST_PAGE_MAX = 1000;

export interface ListPage {
  page: number;
  pageSize: number;
}

/**
 * `?page=&pageSize=` for lists that grow without bound (cycles, macro values), read like the
 * Lapper history pages: page counts from 1, pageSize is capped at LIST_PAGE_MAX, and a missing
 * or invalid value falls back to the default. Without them the newest LIST_PAGE_MAX rows are returned.
 */
export function listPage(page?: string, pageSize?: string): ListPage {
  const whole = (value: string | undefined, fallback: number, max: number): number => {
    const parsed = Number(value);
    return value !== undefined && value !== '' && Number.isInteger(parsed) && parsed >= 1
      ? Math.min(parsed, max)
      : fallback;
  };
  return { page: whole(page, 1, 1_000_000), pageSize: whole(pageSize, LIST_PAGE_MAX, LIST_PAGE_MAX) };
}
