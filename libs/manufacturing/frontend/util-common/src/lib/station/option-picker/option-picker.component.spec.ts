import { TestBed } from '@angular/core/testing';
import { OptionPickerComponent } from './option-picker.component';

describe('OptionPickerComponent keyboard and loading states', () => {
  it('keeps options as named buttons and returns focus when Escape closes the list', () => {
    const fixture = TestBed.createComponent(OptionPickerComponent);
    fixture.componentInstance.options = [{ value: 'T123', cells: ['T123', 'Grinding'] }];
    fixture.componentInstance.headers = ['Tray', 'Stage'];
    fixture.detectChanges();
    const toggle = fixture.nativeElement.querySelector('.picker-toggle') as HTMLButtonElement;
    toggle.click(); fixture.detectChanges();
    const option = fixture.nativeElement.querySelector('.picker-row[type="button"]') as HTMLButtonElement;
    expect(option.getAttribute('role')).toBeNull();
    expect(option.parentElement?.getAttribute('role')).toBe('listitem');
    option.focus();
    option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="list"]')).toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click(); fixture.detectChanges();
    toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="list"]')).toBeNull();
    fixture.destroy();
  });

  it('cannot choose stale options during a refresh or failed lookup', () => {
    const fixture = TestBed.createComponent(OptionPickerComponent);
    const picker = fixture.componentInstance;
    const picked = jest.fn(); picker.picked.subscribe(picked);
    picker.options = [{ value: 'OLD', cells: ['OLD'] }]; picker.open = true; picker.loading = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.picker-row[type="button"]').disabled).toBe(true);
    picker.choose('OLD'); expect(picked).not.toHaveBeenCalled();
    picker.loading = false; picker.error = 'Refresh failed'; fixture.detectChanges();
    picker.choose('OLD'); expect(picked).not.toHaveBeenCalled();
    picker.error = ''; picker.choose('OLD'); expect(picked).toHaveBeenCalledWith('OLD');
    fixture.destroy();
  });
});
