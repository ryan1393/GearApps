import { createStatusLine } from './status-line';

describe('createStatusLine', () => {
  it('prefers the error, then success, then info, and keeps the same object while the text is unchanged', () => {
    const line = createStatusLine();
    expect(line('', '')).toBeNull();
    const saved = line('', 'Saved.');
    expect(saved).toEqual({ tone: 'success', text: 'Saved.' });
    expect(line('', 'Saved.')).toBe(saved);
    expect(line('Failed.', 'Saved.')).toEqual({ tone: 'error', text: 'Failed.' });
    expect(line('', '', 'Scan the shelf.')).toEqual({ tone: 'info', text: 'Scan the shelf.' });
  });
});
