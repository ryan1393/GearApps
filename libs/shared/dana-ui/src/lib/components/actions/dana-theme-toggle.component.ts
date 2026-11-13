import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injectable,
  inject,
  signal,
} from '@angular/core';

export type DanaTheme = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'dana-theme';

@Injectable({ providedIn: 'root' })
export class DanaThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;
  private readonly media = this.window?.matchMedia?.('(prefers-color-scheme: dark)');
  readonly preference = signal<DanaTheme>('system');

  constructor() {
    try {
      const saved = this.window?.localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') this.preference.set(saved);
    } catch {
      /* Storage may be disabled on a shared workstation. */
    }
    const update = () => this.apply();
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY)
        this.setTheme(
          event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : 'system',
        );
    };
    this.media?.addEventListener('change', update);
    this.window?.addEventListener('storage', sync);
    inject(DestroyRef).onDestroy(() => {
      this.media?.removeEventListener('change', update);
      this.window?.removeEventListener('storage', sync);
    });
    this.apply();
  }

  setTheme(theme: DanaTheme): void {
    this.preference.set(theme);
    try {
      this.window?.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* Keep the current session usable. */
    }
    this.apply();
  }

  private apply(): void {
    const dark =
      this.preference() === 'dark' || (this.preference() === 'system' && this.media?.matches);
    this.document.documentElement.dataset['danaTheme'] = dark ? 'dark' : 'light';
    this.document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }
}

@Component({
  selector: 'dana-theme-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<label class="dana-theme-picker"
    ><span class="dana-theme-picker-text">Theme</span>
    <select aria-label="Color theme" [value]="theme.preference()" (change)="change($event)">
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>`,
})
export class DanaThemeToggleComponent {
  readonly theme = inject(DanaThemeService);
  change(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'light' || value === 'dark' || value === 'system') this.theme.setTheme(value);
  }
}
