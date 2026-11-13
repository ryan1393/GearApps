import { Pipe, PipeTransform } from '@angular/core';
import { formatPlantDate, plantTimeZone } from '@truck-log/web/domain';

/**
 * `{{ value | plantDate:'short' }}`: like Angular's `date` pipe, but always in plant time
 * (see web/domain plant-time.ts), never the device's own time zone. Also accepts 'smartTime'.
 *
 * Not pure, so text already on screen follows the zone once the server reports it; the result is
 * memoised per instance, so a check is one comparison unless the value, format, zone or (for
 * 'smartTime') the minute changes.
 */
@Pipe({ name: 'plantDate', standalone: true, pure: false })
export class PlantDatePipe implements PipeTransform {
  private lastKey = '';
  private lastText = '';

  transform(value: unknown, format = 'mediumDate'): string {
    const raw = value instanceof Date ? value.getTime() : value;
    const minute = format === 'smartTime' ? Math.floor(Date.now() / 60_000) : 0;
    const key = `${String(raw)}|${format}|${plantTimeZone()}|${minute}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.lastText = formatPlantDate(value, format);
    }
    return this.lastText;
  }
}
