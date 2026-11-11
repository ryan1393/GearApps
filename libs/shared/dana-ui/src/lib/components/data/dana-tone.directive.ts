import { Directive, HostBinding, Input } from '@angular/core';

export type DanaTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_WORDS: Record<Exclude<DanaTone, 'neutral'>, readonly string[]> = {
  success: ['active', 'enabled', 'running', 'ok', 'pass', 'passed', 'on', 'true', 'available', 'set', 'complete', 'completed', 'finished', 'online'],
  danger: ['inactive', 'disabled', 'stopped', 'fail', 'failed', 'error', 'off', 'false', 'scrapped', 'hold', 'offline'],
  warning: ['idle', 'warning', 'pending', 'low', 'stale', 'unmapped', 'review', 'restart needed', 'pulled'],
  info: ['new', 'grinding', 'resharpening', 'building', 'default', 'you'],
};

/**
 * The one place a status word becomes a pill colour. `true`/`false` read as Active/Inactive.
 * Unknown words are neutral, so a new status is never shown in a misleading colour.
 */
export function danaToneFor(status: unknown): DanaTone {
  if (status === true) return 'success';
  if (status === false) return 'danger';
  const word = String(status ?? '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!word) return 'neutral';
  for (const tone of ['success', 'danger', 'warning', 'info'] as const) {
    if (TONE_WORDS[tone].includes(word)) return tone;
  }
  if (word.startsWith('not ') || word.startsWith('no ')) return 'neutral';
  if (word.startsWith('ready') || word.startsWith('returned')) return 'success';
  if (word.startsWith('waiting') || word.endsWith(' review') || word.endsWith(' stale')) return 'warning';
  if (word.startsWith('in ') || word.startsWith('at ') || word.startsWith('packed')) return 'info';
  return 'neutral';
}

/** `<span class="gear-badge" [danaTone]="row.status">`: colours a pill from its status. */
@Directive({
  selector: '[danaTone]',
  standalone: true,
})
export class DanaToneDirective {
  @Input() danaTone: unknown;

  @HostBinding('attr.data-tone') get tone(): DanaTone {
    return danaToneFor(this.danaTone);
  }
}
