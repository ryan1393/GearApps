import { EMPTY, Subject } from 'rxjs';
import { loadable } from './resource';
describe('loadable selection changes', () => {
  it('cancels a pending load when its owning page is destroyed', () => {
    const request=new Subject<string[]>();
    const state=loadable<string[]>([]);
    state.load(request); state.dispose(); request.next(['late']);
    expect(state.value()).toEqual([]);
    expect(state.loading()).toBe(false);
  });
  it('stops loading when a request completes without a value', () => {
    const state = loadable(['saved']);
    state.load(EMPTY);
    expect(state.loading()).toBe(false);
    expect(state.value()).toEqual(['saved']);
  });
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
