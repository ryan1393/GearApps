/**
 * Per-row edit copies for an editable list. Inputs bind to draft(row); the
 * loaded row stays the saved value until the server confirms a save, so a
 * save or refresh of one row never discards another row's unsaved edits, and
 * a failed save leaves the row dirty with its error shown.
 */
export class RowDrafts<T extends { id: number }, D extends object> {
  private readonly drafts = new Map<number, D>();
  private readonly errors = new Map<number, string>();

  constructor(
    private readonly toDraft: (row: T) => D,
    private readonly same: (row: T, draft: D) => boolean,
  ) {}

  draft(row: T): D {
    let draft = this.drafts.get(row.id);
    if (!draft) {
      draft = this.toDraft(row);
      this.drafts.set(row.id, draft);
    }
    return draft;
  }

  dirty(row: T): boolean {
    const draft = this.drafts.get(row.id);
    return !!draft && !this.same(row, draft);
  }

  error(row: T): string {
    return this.errors.get(row.id) ?? '';
  }

  /** The server saved this row: drop the edit copy and any error. */
  saved(row: T) {
    this.drafts.delete(row.id);
    this.errors.delete(row.id);
  }

  failed(row: T, message: string) {
    this.errors.set(row.id, message);
  }
}

export const trimmed = (value: string | null | undefined) => String(value ?? '').trim();
