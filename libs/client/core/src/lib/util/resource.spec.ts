import { Subject } from 'rxjs';
import { loadable } from './resource';
describe('loadable selection changes', () => {
  it('does not let a previous request overwrite a cleared selection', () => {
    const request = new Subject<string[]>();
    const state = loadable<string[]>([]);
    state.load(request);
    state.set([]);
    request.next(['stale cycle']);
    expect(state.value()).toEqual([]);
    expect(state.loading()).toBe(false);
  });
  it('cancels the previous request when another cycle is selected', () => {
    const first = new Subject<string[]>(); const second = new Subject<string[]>();
    const state = loadable<string[]>([]);
    state.load(first); state.load(second);
    second.next(['selected']); first.next(['old']);
    expect(state.value()).toEqual(['selected']);
  });
});
