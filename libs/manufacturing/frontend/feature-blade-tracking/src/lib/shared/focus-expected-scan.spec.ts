import { focusExpectedScan } from './focus-expected-scan';

describe('focusExpectedScan', () => {
  let area: HTMLElement;
  const input = (step: number, disabled = false) => {
    const el = document.createElement('input');
    el.dataset['gearScanStep'] = String(step);
    el.disabled = disabled;
    // jsdom has no layout; count every input as visible.
    el.getClientRects = () => [{}] as unknown as DOMRectList;
    area.appendChild(el);
    return el;
  };

  beforeEach(() => {
    area = document.createElement('div');
    document.body.appendChild(area);
  });
  afterEach(() => area.remove());

  it('focuses the furthest enabled scan step', () => {
    input(1);
    const second = input(2);
    input(3, true);
    expect(focusExpectedScan(area)).toBe(true);
    expect(document.activeElement).toBe(second);
  });

  it('takes the cursor from a station tab', () => {
    const tab = document.createElement('button');
    tab.setAttribute('data-gear-yield-focus', '');
    document.body.appendChild(tab);
    tab.focus();
    const first = input(1);
    expect(focusExpectedScan(area)).toBe(true);
    expect(document.activeElement).toBe(first);
    tab.remove();
  });

  it('leaves a field the operator is using alone', () => {
    const field = document.createElement('input');
    area.appendChild(field);
    field.focus();
    input(1);
    expect(focusExpectedScan(area)).toBe(false);
    expect(document.activeElement).toBe(field);
  });
});
