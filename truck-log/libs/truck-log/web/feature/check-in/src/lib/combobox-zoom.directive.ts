import { Directive, ElementRef, OnInit, inject } from '@angular/core';
import { DanaComboboxComponent } from '@dana/ui';

type Placement = DanaComboboxComponent['placement'];
type PlaceableCombobox = { place?: () => void; placement: Placement; maxRows: number };

/**
 * Keeps a Dana combobox list under its field when the shell is zoomed (large monitors, see fit.css).
 *
 * The combobox positions its fixed list from getBoundingClientRect() and window size, which are
 * screen pixels; inside a zoomed shell those numbers are applied as CSS pixels and zoomed again, so
 * at 1.5x the list opened far to the right and below the screen. After the library computes the
 * placement, this converts it to the element's own CSS pixels. At zoom 1 nothing changes.
 */
@Directive({ selector: 'dana-combobox', standalone: true })
export class ComboboxZoomPlacementDirective implements OnInit {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly combobox = inject(DanaComboboxComponent);

  ngOnInit() {
    const box = this.combobox as unknown as PlaceableCombobox;
    const place = box.place;
    if (typeof place !== 'function') return;
    box.place = () => {
      place.call(box);
      const element = this.host.nativeElement;
      const zoom = Number((element as unknown as { currentCSSZoom?: number }).currentCSSZoom) || 1;
      if (Math.abs(zoom - 1) < 0.01 || !box.placement) return;
      const p = box.placement;
      const rect = element.getBoundingClientRect();
      // Same room calculation as the library (gap 6, edge 16, header 36 + footer 8), in screen pixels.
      const room = (p.above ? rect.top : window.innerHeight - rect.bottom) - 6 - 16 - 44;
      box.placement = {
        ...p,
        top: p.top === null ? null : p.top / zoom,
        bottom: p.bottom === null ? null : p.bottom / zoom,
        left: p.left / zoom,
        width: p.width / zoom,
        listMax: Math.min(p.listMax, Math.max(120, room) / zoom),
      };
    };
  }
}
