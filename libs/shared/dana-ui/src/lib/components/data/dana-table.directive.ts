import {
  AfterViewInit,
  Directive,
  ElementRef,
  OnDestroy,
  Renderer2
} from '@angular/core';

let nextPopoverId = 0;

interface DanaTableRowGroup {
  parent: HTMLTableRowElement;
  rows: HTMLTableRowElement[];
}

interface DanaTableHeaderControls {
  tools: HTMLSpanElement;
  popover: HTMLDivElement;
  columnIndex: number;
  label: string;
  cleanups: (() => void)[];
  attributes: Map<string, { original: string | null; written: string | null }>;
}

@Directive({
  selector: 'table[danaTable]',
  standalone: true,
})
export class DanaTableDirective implements AfterViewInit, OnDestroy {
  private readonly filters = new Map<number, string>();
  private sortColumn = -1;
  private sortDirection: 'asc' | 'desc' = 'asc';
  private observer?: MutationObserver;
  private destroyed = false;
  private updateScheduled = false;
  private readonly popovers = new Set<HTMLElement>();
  private readonly headerControls = new Map<HTMLTableCellElement, DanaTableHeaderControls>();
  private readonly cleanups: (() => void)[] = [];
  private applying = false;
  private openPopover?: HTMLElement;
  private openTrigger?: HTMLButtonElement;


  constructor(
    private readonly host: ElementRef<HTMLTableElement>,
    private readonly renderer: Renderer2
  ) {}

  ngAfterViewInit(): void {
    queueMicrotask(() => {
      if (this.destroyed) return;
      this.danaTableInitialize();
      this.danaTableConnectObserver();
    });

    this.listen('document', 'click', (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.dana-table-filter-trigger') || target?.closest('.dana-table-filter-popover')) return;
      this.danaTableClosePopover();
    });

    this.listen('document', 'keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.openPopover) {
        event.preventDefault();
        this.danaTableClosePopover(true);
      }
    });

    this.listen('window', 'resize', () => this.danaTablePositionOpenPopover());
    const document = this.host.nativeElement.ownerDocument;
    const reposition = () => this.danaTablePositionOpenPopover();
    document.addEventListener('scroll', reposition, true);
    this.cleanups.push(() => document.removeEventListener('scroll', reposition, true));
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.cleanups.splice(0).forEach(cleanup => cleanup());
    this.danaTableClosePopover();
    for (const cell of this.headerControls.keys()) this.danaTableDisposeHeader(cell);
    for (const popover of this.popovers) {
      if (popover.parentNode) this.renderer.removeChild(popover.parentNode, popover);
    }
    this.popovers.clear();
  }

  private listen(target: 'document' | 'window' | HTMLElement, event: string, callback: (event: any) => void,
    cleanups = this.cleanups): void {
    cleanups.push(this.renderer.listen(target, event, callback));
  }

  private danaTableConnectObserver(): void {
    if (typeof MutationObserver === 'undefined') return;
    this.observer?.disconnect();
    this.observer = new MutationObserver(() => {
      if (this.destroyed || this.applying || this.updateScheduled) return;
      this.updateScheduled = true;
      queueMicrotask(() => {
        this.updateScheduled = false;
        if (this.destroyed) return;
        this.danaTableInitialize();
        this.danaTableApplyFilters();
      });
    });
    // Include body/header replacement, including tables that start without a tbody.
    this.observer.observe(this.host.nativeElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['data-dana-table-static'],
    });
  }

  private danaTableInitialize(): void {
    const table = this.host.nativeElement;
    const headerRow = table.tHead?.rows.item(table.tHead.rows.length - 1);
    const cells = headerRow ? Array.from(headerRow.cells) : [];
    const labels = cells.map(cell => {
      const clone = cell.cloneNode(true) as HTMLElement;
      clone.querySelector('.dana-table-header-tools')?.remove();
      return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
    });
    for (const [cell, controls] of this.headerControls) {
      const index = cells.indexOf(cell);
      if (index !== controls.columnIndex || labels[index] !== controls.label ||
          controls.tools.parentElement !== cell || cell.hasAttribute('data-dana-table-static')) {
        this.filters.delete(controls.columnIndex);
        if (this.sortColumn === controls.columnIndex) this.sortColumn = -1;
        this.danaTableDisposeHeader(cell);
      }
    }
    if (!headerRow) return;
    for (const body of Array.from(table.tBodies)) {
      for (const row of Array.from(body.rows)) {
        Array.from(row.cells).forEach((cell, index) => {
          this.renderer.setAttribute(cell, 'data-dana-label', cell.colSpan > 1 ? '' : labels[index] || 'Actions');
        });
      }
    }

    Array.from(headerRow.cells).forEach((cell, columnIndex) => {
      if (cell.querySelector('.dana-table-header-tools') || cell.hasAttribute('data-dana-table-static')) return;

      const clone = cell.cloneNode(true) as HTMLTableCellElement;
      clone.querySelector('.dana-table-header-tools')?.remove();
      const label = (clone.textContent ?? '').replace(/\s+/g, ' ').trim();

      if (!label || /^(action|actions|view|edit|details|print|remove|delete|open|select)$/i.test(label)) return;

      const attributes = new Map(['tabindex', 'aria-label', 'aria-sort'].map(attribute =>
        [attribute, { original: cell.getAttribute(attribute), written: null as string | null }],
      ));
      this.renderer.addClass(cell, 'dana-table-sortable');
      this.danaTableSetHeaderAttribute(cell, 'tabindex', '0', attributes);
      this.danaTableSetHeaderAttribute(cell, 'aria-label', `Sort by ${label}`, attributes);

      const headerTools = this.renderer.createElement('span') as HTMLSpanElement;
      this.renderer.addClass(headerTools, 'dana-table-header-tools');
      const cleanups: (() => void)[] = [];

      const sortIndicator = this.renderer.createElement('span') as HTMLSpanElement;
      this.renderer.addClass(sortIndicator, 'dana-table-sort-indicator');
      this.renderer.addClass(sortIndicator, 'dana-glyph');
      this.renderer.addClass(sortIndicator, 'gear-glyph');
      this.renderer.addClass(sortIndicator, 'dana-glyph-sort');
      this.renderer.addClass(sortIndicator, 'gear-glyph-sort');
      this.renderer.setAttribute(sortIndicator, 'aria-hidden', 'true');

      const filterTrigger = this.renderer.createElement('button') as HTMLButtonElement;
      this.renderer.setAttribute(filterTrigger, 'type', 'button');
      this.renderer.addClass(filterTrigger, 'dana-table-filter-trigger');
      this.renderer.setAttribute(filterTrigger, 'aria-label', `Filter ${label}`);
      this.renderer.setAttribute(filterTrigger, 'title', `Filter ${label}`);
      this.renderer.setAttribute(filterTrigger, 'aria-expanded', 'false');

      const funnel = this.renderer.createElement('span') as HTMLSpanElement;
      this.renderer.addClass(funnel, 'dana-table-filter-funnel');
      this.renderer.setAttribute(funnel, 'aria-hidden', 'true');
      this.renderer.setProperty(
        funnel,
        'innerHTML',
        '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4.5 5.5h15l-5.8 6.6v5.2l-3.4 1.7v-6.9L4.5 5.5Z"></path></svg>'
      );
      this.renderer.appendChild(filterTrigger, funnel);

      const popover = this.danaTableCreatePopover(label, columnIndex, filterTrigger, cleanups);
      this.headerControls.set(cell, { tools: headerTools, popover, columnIndex, label, cleanups, attributes });

      const toggleSort = () => {
        if (this.sortColumn === columnIndex) {
          this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortColumn = columnIndex;
          this.sortDirection = 'asc';
        }
        this.danaTableUpdateSortIndicators(headerRow);
        this.danaTableApplyFilters();
      };

      this.listen(cell, 'click', (event: Event) => {
        const target = event.target as HTMLElement | null;
        if (this.danaTableIsHeaderControl(target, cell)) return;
        event.preventDefault();
        toggleSort();
      }, cleanups);

      this.listen(cell, 'keydown', (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        if (this.danaTableIsHeaderControl(target, cell)) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleSort();
        }
      }, cleanups);

      this.listen(filterTrigger, 'click', (event: Event) => {
        event.preventDefault();
        event.stopPropagation();

        const opening = this.openPopover !== popover;
        this.danaTableClosePopover();

        if (opening) {
          this.openPopover = popover;
          this.openTrigger = filterTrigger;
          this.renderer.setStyle(popover, 'display', 'block');
          filterTrigger.setAttribute('aria-expanded', 'true');
          this.danaTablePositionOpenPopover();
          const input = popover.querySelector<HTMLInputElement>('.dana-table-filter-popover-input');
          queueMicrotask(() => { if (!this.destroyed && this.openPopover === popover) input?.focus(); });
        }
      }, cleanups);

      this.renderer.appendChild(headerTools, sortIndicator);
      this.renderer.appendChild(headerTools, filterTrigger);
      this.renderer.appendChild(cell, headerTools);
    });

    this.danaTableUpdateSortIndicators(headerRow);
  }

  private danaTableDisposeHeader(cell: HTMLTableCellElement): void {
    const controls = this.headerControls.get(cell);
    if (!controls) return;
    if (this.openPopover === controls.popover) this.danaTableClosePopover();
    controls.cleanups.splice(0).forEach(cleanup => cleanup());
    for (const element of [controls.popover, controls.tools]) {
      if (element.parentNode) this.renderer.removeChild(element.parentNode, element);
    }
    this.popovers.delete(controls.popover);
    this.headerControls.delete(cell);
    this.renderer.removeClass(cell, 'dana-table-sortable');
    this.renderer.removeClass(cell, 'dana-table-sort-active');
    for (const [attribute, state] of controls.attributes) {
      // Angular may leave unchanged bindings alone, and application updates take precedence.
      if (state.written === null || cell.getAttribute(attribute) !== state.written) continue;
      if (state.original === null) this.renderer.removeAttribute(cell, attribute);
      else this.renderer.setAttribute(cell, attribute, state.original);
    }
  }

  private danaTableSetHeaderAttribute(cell: HTMLTableCellElement, attribute: string, value: string,
    attributes = this.headerControls.get(cell)?.attributes): void {
    const state = attributes?.get(attribute);
    if (state) {
      const current = cell.getAttribute(attribute);
      if (state.written !== null && current !== state.written) state.original = current;
      state.written = value;
    }
    this.renderer.setAttribute(cell, attribute, value);
  }

  private danaTableIsHeaderControl(target: HTMLElement | null, cell: HTMLTableCellElement): boolean {
    const control = target?.closest('button,a,input,select,textarea,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="checkbox"],[role="combobox"]');
    return !!control && control !== cell && cell.contains(control);
  }

  private danaTableCreatePopover(label: string, columnIndex: number, trigger: HTMLButtonElement,
    cleanups: (() => void)[]): HTMLDivElement {
    const ownerDocument = this.host.nativeElement.ownerDocument;

    const popover = this.renderer.createElement('div') as HTMLDivElement;
    this.renderer.addClass(popover, 'dana-table-filter-popover');
    const id = `dana-table-filter-${++nextPopoverId}`;
    this.renderer.setAttribute(popover, 'id', id);
    this.renderer.setAttribute(popover, 'role', 'dialog');
    this.renderer.setAttribute(popover, 'aria-label', `Filter ${label}`);
    this.renderer.setAttribute(trigger, 'aria-controls', id);
    this.renderer.setAttribute(trigger, 'aria-haspopup', 'dialog');
    this.popovers.add(popover);
    this.renderer.setStyle(popover, 'display', 'none');

    const heading = this.renderer.createElement('div') as HTMLDivElement;
    this.renderer.addClass(heading, 'dana-table-filter-popover-heading');

    const title = this.renderer.createElement('div') as HTMLDivElement;
    this.renderer.addClass(title, 'dana-table-filter-popover-title');
    this.renderer.setProperty(title, 'textContent', `Filter ${label}`);

    const close = this.renderer.createElement('button') as HTMLButtonElement;
    this.renderer.setAttribute(close, 'type', 'button');
    this.renderer.addClass(close, 'dana-table-filter-popover-close');
    this.renderer.setAttribute(close, 'aria-label', 'Close filter');

    const closeIcon = this.renderer.createElement('span') as HTMLSpanElement;
    this.renderer.addClass(closeIcon, 'dana-glyph');
    this.renderer.addClass(closeIcon, 'dana-glyph-close');
    this.renderer.addClass(closeIcon, 'gear-glyph');
    this.renderer.addClass(closeIcon, 'gear-glyph-close');
    this.renderer.setAttribute(closeIcon, 'aria-hidden', 'true');
    this.renderer.appendChild(close, closeIcon);

    const inputWrap = this.renderer.createElement('div') as HTMLDivElement;
    this.renderer.addClass(inputWrap, 'dana-table-filter-search-wrap');

    const searchIcon = this.renderer.createElement('span') as HTMLSpanElement;
    this.renderer.addClass(searchIcon, 'dana-table-filter-search-icon');
    this.renderer.setAttribute(searchIcon, 'aria-hidden', 'true');
    this.renderer.setProperty(
      searchIcon,
      'innerHTML',
      '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M10.8 5a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 10.8 5Zm0 1.8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm4.7 8 3.7 3.7-1.3 1.3-3.7-3.7 1.3-1.3Z"></path></svg>'
    );

    const input = this.renderer.createElement('input') as HTMLInputElement;
    this.renderer.setAttribute(input, 'type', 'search');
    this.renderer.addClass(input, 'dana-table-filter-popover-input');
    this.renderer.setAttribute(input, 'placeholder', `Search ${label.toLocaleLowerCase()}…`);
    this.renderer.setAttribute(input, 'aria-label', `Search ${label}`);
    this.renderer.setAttribute(input, 'autocomplete', 'off');
    this.renderer.setAttribute(input, 'spellcheck', 'false');

    const footer = this.renderer.createElement('div') as HTMLDivElement;
    this.renderer.addClass(footer, 'dana-table-filter-popover-footer');

    const status = this.renderer.createElement('span') as HTMLSpanElement;
    this.renderer.addClass(status, 'dana-table-filter-status');
    this.renderer.setProperty(status, 'textContent', 'Not filtered');

    const clear = this.renderer.createElement('button') as HTMLButtonElement;
    this.renderer.setAttribute(clear, 'type', 'button');
    this.renderer.addClass(clear, 'dana-table-filter-clear');
    this.renderer.setProperty(clear, 'textContent', 'Clear filter');
    this.renderer.setAttribute(clear, 'aria-label', `Clear ${label} filter`);

    const syncFilter = () => {
      const value = input.value.trim().toLocaleLowerCase();
      if (value) {
        this.filters.set(columnIndex, value);
        this.renderer.addClass(trigger, 'dana-table-filter-trigger-active');
        this.renderer.setProperty(status, 'textContent', 'Filter active');
      } else {
        this.filters.delete(columnIndex);
        this.renderer.removeClass(trigger, 'dana-table-filter-trigger-active');
        this.renderer.setProperty(status, 'textContent', 'Not filtered');
      }
      this.danaTableApplyFilters();
    };

    this.listen(close, 'click', (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      this.danaTableClosePopover();
      trigger.focus();
    }, cleanups);

    this.listen(input, 'input', syncFilter, cleanups);
    this.listen(input, 'click', (event: Event) => event.stopPropagation(), cleanups);
    this.listen(input, 'keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.danaTableClosePopover(true);
      }
      event.stopPropagation();
    }, cleanups);

    this.listen(clear, 'click', (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      input.value = '';
      syncFilter();
      input.focus();
    }, cleanups);

    this.renderer.appendChild(heading, title);
    this.renderer.appendChild(heading, close);
    this.renderer.appendChild(inputWrap, searchIcon);
    this.renderer.appendChild(inputWrap, input);
    this.renderer.appendChild(footer, status);
    this.renderer.appendChild(footer, clear);
    this.renderer.appendChild(popover, heading);
    this.renderer.appendChild(popover, inputWrap);
    this.renderer.appendChild(popover, footer);

    // Keep overlays in the native modal's top layer and outside its inert background.
    const overlayRoot = this.host.nativeElement.closest('dialog') ?? ownerDocument.body;
    this.renderer.appendChild(overlayRoot, popover);
    return popover;
  }

  private danaTablePositionOpenPopover(): void {
    if (!this.openPopover || !this.openTrigger) return;

    const rect = this.openTrigger.getBoundingClientRect();
    const width = Math.max(0, Math.min(304, window.innerWidth - 24));

    let left = rect.left;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    if (left < 12) left = 12;

    let top = rect.bottom + 8;
    const estimatedHeight = 150;
    if (top + estimatedHeight > window.innerHeight - 12) {
      top = Math.max(12, rect.top - estimatedHeight - 8);
    }

    this.renderer.setStyle(this.openPopover, 'width', `${width}px`);
    this.renderer.setStyle(this.openPopover, 'left', `${Math.round(left)}px`);
    this.renderer.setStyle(this.openPopover, 'top', `${Math.round(top)}px`);
  }

  private danaTableClosePopover(restoreFocus = false): void {
    if (!this.openPopover) return;
    const trigger = this.openTrigger;
    trigger?.setAttribute('aria-expanded', 'false');
    this.renderer.setStyle(this.openPopover, 'display', 'none');
    this.openPopover = undefined;
    this.openTrigger = undefined;
    if (restoreFocus && trigger?.isConnected) trigger.focus();
  }

  private danaTableUpdateSortIndicators(headerRow: HTMLTableRowElement): void {
    Array.from(headerRow.cells).forEach((cell, index) => {
      const indicator = cell.querySelector<HTMLSpanElement>('.dana-table-sort-indicator');
      if (!indicator) return;

      const active = index === this.sortColumn;
      for (const iconClass of ['dana-glyph-sort', 'dana-glyph-sort-asc', 'dana-glyph-sort-desc', 'gear-glyph-sort', 'gear-glyph-sort-asc', 'gear-glyph-sort-desc']) {
        this.renderer.removeClass(indicator, iconClass);
      }
      this.renderer.addClass(
        indicator,
        active
          ? (this.sortDirection === 'asc' ? 'gear-glyph-sort-asc' : 'gear-glyph-sort-desc')
          : 'gear-glyph-sort'
      );
      this.renderer.addClass(indicator, active
        ? (this.sortDirection === 'asc' ? 'dana-glyph-sort-asc' : 'dana-glyph-sort-desc')
        : 'dana-glyph-sort');
      this.danaTableSetHeaderAttribute(cell,
        'aria-sort',
        active ? (this.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
      );

      if (active) this.renderer.addClass(cell, 'dana-table-sort-active');
      else this.renderer.removeClass(cell, 'dana-table-sort-active');
    });
  }

  private danaTableApplyFilters(): void {
    const tbody = this.host.nativeElement.tBodies.item(0);
    if (!tbody || this.destroyed) return;

    this.applying = true;
    this.observer?.disconnect();

    try {
      const { groups, emptyRows } = this.danaTableBuildRowGroups(tbody);
      let visibleGroupCount = 0;

      for (const group of groups) {
        let visible = true;

        for (const [columnIndex, filter] of this.filters) {
          const value = (group.parent.cells.item(columnIndex)?.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLocaleLowerCase();

          if (!value.includes(filter)) {
            visible = false;
            break;
          }
        }

        if (visible) visibleGroupCount += 1;

        for (const row of group.rows) {
          this.renderer.setStyle(row, 'display', visible ? '' : 'none');
        }
      }

      for (const row of emptyRows) {
        this.renderer.setStyle(
          row,
          'display',
          groups.length === 0 && this.filters.size === 0 ? '' : 'none'
        );
      }

      if (this.sortColumn >= 0) {
        groups.sort((a, b) => {
          const av = (a.parent.cells.item(this.sortColumn)?.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim();
          const bv = (b.parent.cells.item(this.sortColumn)?.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim();
          const result = this.danaTableCompare(av, bv);
          return this.sortDirection === 'asc' ? result : -result;
        });

        // Reapplying a filter or an async cell update must not detach already ordered
        // rows: removing a focused row from the DOM drops its input/link focus.
        let next = tbody.firstElementChild;
        for (const row of [...groups.flatMap(group => group.rows), ...emptyRows]) {
          if (row === next) next = next.nextElementSibling;
          else this.renderer.insertBefore(tbody, row, next);
        }
      }

      this.danaTableSyncNoMatchState(tbody, visibleGroupCount, groups.length);
    } finally {
      this.applying = false;

      if (this.observer && !this.destroyed) {
        this.observer.observe(this.host.nativeElement, {
          childList:true,
          subtree:true,
          characterData:true,
          attributes:true,
          attributeFilter:['data-dana-table-static']
        });
      }
    }
  }

  private danaTableBuildRowGroups(tbody: HTMLTableSectionElement): {
    groups: DanaTableRowGroup[];
    emptyRows: HTMLTableRowElement[];
  } {
    const groups: DanaTableRowGroup[] = [];
    const emptyRows: HTMLTableRowElement[] = [];
    const groupsByKey = new Map<string, DanaTableRowGroup>();
    let currentGroup: DanaTableRowGroup | undefined;

    for (const row of Array.from(tbody.rows)) {
      if (row.classList.contains('dana-table-generated-empty')) continue;

      const isDetail = row.hasAttribute('data-dana-table-detail');
      const isEmpty = !isDetail && (
        row.querySelector('td[danaTableEmpty], td.empty-row') !== null ||
        (row.cells.length === 1 && (row.cells.item(0)?.colSpan ?? 1) > 1)
      );

      if (isEmpty) {
        emptyRows.push(row);
        currentGroup = undefined;
        continue;
      }

      const key = row.getAttribute('data-dana-table-group')?.trim() ?? '';

      if (isDetail) {
        const group = (key ? groupsByKey.get(key) : undefined) ?? currentGroup;
        if (group) {
          group.rows.push(row);
        }
        continue;
      }

      currentGroup = { parent: row, rows: [row] };
      groups.push(currentGroup);
      if (key) groupsByKey.set(key, currentGroup);
    }

    return { groups, emptyRows };
  }

  private danaTableSyncNoMatchState(
    tbody: HTMLTableSectionElement,
    visibleGroupCount: number,
    totalGroupCount: number
  ): void {
    const existing = tbody.querySelector<HTMLTableRowElement>('.dana-table-generated-empty');
    const shouldShow = this.filters.size > 0 && totalGroupCount > 0 && visibleGroupCount === 0;

    if (!shouldShow) {
      if (existing?.parentNode) this.renderer.removeChild(existing.parentNode, existing);
      return;
    }

    if (existing) return;

    const row = this.renderer.createElement('tr') as HTMLTableRowElement;
    this.renderer.addClass(row, 'dana-table-generated-empty');

    const cell = this.renderer.createElement('td') as HTMLTableCellElement;
    this.renderer.addClass(cell, 'empty-row');
    this.renderer.setAttribute(
      cell,
      'colspan',
      String(this.host.nativeElement.tHead?.rows.item(0)?.cells.length ?? 1)
    );
    this.renderer.setProperty(cell, 'textContent', 'No rows match the active table filters.');

    this.renderer.appendChild(row, cell);
    this.renderer.appendChild(tbody, row);
  }

  private danaTableCompare(a: string, b: string): number {
    const numberPattern = /^\s*[-+]?\d[\d,]*(?:\.\d+)?\s*$/;

    if (numberPattern.test(a) && numberPattern.test(b)) {
      return Number(a.replace(/,/g,'')) - Number(b.replace(/,/g,''));
    }

    if (/[/:-]|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(a+b)) {
      const ad=Date.parse(a);
      const bd=Date.parse(b);
      if (Number.isFinite(ad) && Number.isFinite(bd)) return ad-bd;
    }

    return a.localeCompare(b, undefined, {
      numeric:true,
      sensitivity:'base'
    });
  }
}
