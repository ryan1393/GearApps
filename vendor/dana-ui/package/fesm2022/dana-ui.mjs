import * as i0 from '@angular/core';
import { ChangeDetectionStrategy, Component, Directive, HostBinding, Input, HostListener, Injectable, EventEmitter, ViewChild, Output, forwardRef } from '@angular/core';
import * as i2 from '@angular/common';
import { CommonModule, AsyncPipe } from '@angular/common';
import { BehaviorSubject } from 'rxjs';
import { NG_VALUE_ACCESSOR } from '@angular/forms';

class DanaDashboardGridComponent {
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaDashboardGridComponent, deps: [], target: i0.ɵɵFactoryTarget.Component }); }
    static { this.ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "14.0.0", version: "20.3.35", type: DanaDashboardGridComponent, isStandalone: true, selector: "[danaDashboardGrid]", host: { classAttribute: "dana-dashboard-grid" }, ngImport: i0, template: '<ng-content></ng-content>', isInline: true, changeDetection: i0.ChangeDetectionStrategy.OnPush }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaDashboardGridComponent, decorators: [{
            type: Component,
            args: [{
                    selector: '[danaDashboardGrid]',
                    standalone: true,
                    changeDetection: ChangeDetectionStrategy.OnPush,
                    template: '<ng-content></ng-content>',
                    host: { class: 'dana-dashboard-grid' },
                }]
        }] });

class DanaDashboardPanelComponent {
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaDashboardPanelComponent, deps: [], target: i0.ɵɵFactoryTarget.Component }); }
    static { this.ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "14.0.0", version: "20.3.35", type: DanaDashboardPanelComponent, isStandalone: true, selector: "[danaDashboardPanel]", host: { classAttribute: "dana-dashboard-panel dana-panel" }, ngImport: i0, template: '<ng-content></ng-content>', isInline: true, changeDetection: i0.ChangeDetectionStrategy.OnPush }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaDashboardPanelComponent, decorators: [{
            type: Component,
            args: [{
                    selector: '[danaDashboardPanel]',
                    standalone: true,
                    changeDetection: ChangeDetectionStrategy.OnPush,
                    template: '<ng-content></ng-content>',
                    host: { class: 'dana-dashboard-panel dana-panel' },
                }]
        }] });

class DanaKpiGridDirective {
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaKpiGridDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaKpiGridDirective, isStandalone: true, selector: "[danaKpiGrid]", host: { classAttribute: "dana-kpi-grid kpi-grid" }, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaKpiGridDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: '[danaKpiGrid]',
                    standalone: true,
                    host: { class: 'dana-kpi-grid kpi-grid' },
                }]
        }] });

class DanaKpiCardDirective {
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaKpiCardDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaKpiCardDirective, isStandalone: true, selector: "[danaKpiCard]", host: { classAttribute: "dana-kpi-card kpi-card" }, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaKpiCardDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: '[danaKpiCard]',
                    standalone: true,
                    host: { class: 'dana-kpi-card kpi-card' },
                }]
        }] });

class DanaPanelHeaderDirective {
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaPanelHeaderDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaPanelHeaderDirective, isStandalone: true, selector: "[danaPanelHeader]", ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaPanelHeaderDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: '[danaPanelHeader]',
                    standalone: true,
                }]
        }] });

class DanaPanelActionDirective {
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaPanelActionDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaPanelActionDirective, isStandalone: true, selector: "[danaPanelAction]", ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaPanelActionDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: '[danaPanelAction]',
                    standalone: true,
                }]
        }] });

class DanaTableShellDirective {
    constructor() {
        this.hostClass = true;
    }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaTableShellDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaTableShellDirective, isStandalone: true, selector: "[danaTableShell]", host: { properties: { "class.dana-table-shell": "this.hostClass" } }, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaTableShellDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: '[danaTableShell]',
                    standalone: true,
                }]
        }], propDecorators: { hostClass: [{
                type: HostBinding,
                args: ['class.dana-table-shell']
            }] } });

let nextPopoverId = 0;
class DanaTableDirective {
    constructor(host, renderer) {
        this.host = host;
        this.renderer = renderer;
        this.filters = new Map();
        this.sortColumn = -1;
        this.sortDirection = 'asc';
        this.destroyed = false;
        this.updateScheduled = false;
        this.popovers = new Set();
        this.cleanups = [];
        this.applying = false;
    }
    ngAfterViewInit() {
        queueMicrotask(() => {
            if (this.destroyed)
                return;
            this.danaTableInitialize();
            this.danaTableConnectObserver();
        });
        this.listen('document', 'click', (event) => {
            const target = event.target;
            if (target?.closest('.dana-table-filter-trigger') || target?.closest('.dana-table-filter-popover'))
                return;
            this.danaTableClosePopover();
        });
        this.listen('document', 'keydown', (event) => {
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
    ngOnDestroy() {
        this.destroyed = true;
        this.observer?.disconnect();
        this.cleanups.splice(0).forEach(cleanup => cleanup());
        this.danaTableClosePopover();
        for (const popover of this.popovers) {
            if (popover.parentNode)
                this.renderer.removeChild(popover.parentNode, popover);
        }
        this.popovers.clear();
    }
    listen(target, event, callback) {
        this.cleanups.push(this.renderer.listen(target, event, callback));
    }
    danaTableConnectObserver() {
        if (typeof MutationObserver === 'undefined')
            return;
        this.observer?.disconnect();
        this.observer = new MutationObserver(() => {
            if (this.destroyed || this.applying || this.updateScheduled)
                return;
            this.updateScheduled = true;
            queueMicrotask(() => {
                this.updateScheduled = false;
                if (this.destroyed)
                    return;
                this.danaTableInitialize();
                this.danaTableApplyFilters();
            });
        });
        // Include body/header replacement, including tables that start without a tbody.
        this.observer.observe(this.host.nativeElement, { childList: true, subtree: true, characterData: true });
    }
    danaTableInitialize() {
        const table = this.host.nativeElement;
        const headerRow = table.tHead?.rows.item(table.tHead.rows.length - 1);
        if (!headerRow)
            return;
        Array.from(headerRow.cells).forEach((cell, columnIndex) => {
            if (cell.querySelector('.dana-table-header-tools') || cell.hasAttribute('data-dana-table-static'))
                return;
            const clone = cell.cloneNode(true);
            clone.querySelector('.dana-table-header-tools')?.remove();
            const label = (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (!label || /^(action|actions|view|edit|details|print|remove|delete|open|select)$/i.test(label))
                return;
            this.renderer.addClass(cell, 'dana-table-sortable');
            this.renderer.setAttribute(cell, 'tabindex', '0');
            this.renderer.setAttribute(cell, 'aria-label', `Sort by ${label}`);
            const headerTools = this.renderer.createElement('span');
            this.renderer.addClass(headerTools, 'dana-table-header-tools');
            const sortIndicator = this.renderer.createElement('span');
            this.renderer.addClass(sortIndicator, 'dana-table-sort-indicator');
            this.renderer.addClass(sortIndicator, 'dana-glyph');
            this.renderer.addClass(sortIndicator, 'gear-glyph');
            this.renderer.addClass(sortIndicator, 'dana-glyph-sort');
            this.renderer.addClass(sortIndicator, 'gear-glyph-sort');
            this.renderer.setAttribute(sortIndicator, 'aria-hidden', 'true');
            const filterTrigger = this.renderer.createElement('button');
            this.renderer.setAttribute(filterTrigger, 'type', 'button');
            this.renderer.addClass(filterTrigger, 'dana-table-filter-trigger');
            this.renderer.setAttribute(filterTrigger, 'aria-label', `Filter ${label}`);
            this.renderer.setAttribute(filterTrigger, 'title', `Filter ${label}`);
            this.renderer.setAttribute(filterTrigger, 'aria-expanded', 'false');
            const funnel = this.renderer.createElement('span');
            this.renderer.addClass(funnel, 'dana-table-filter-funnel');
            this.renderer.setAttribute(funnel, 'aria-hidden', 'true');
            this.renderer.setProperty(funnel, 'innerHTML', '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4.5 5.5h15l-5.8 6.6v5.2l-3.4 1.7v-6.9L4.5 5.5Z"></path></svg>');
            this.renderer.appendChild(filterTrigger, funnel);
            const popover = this.danaTableCreatePopover(label, columnIndex, filterTrigger);
            const toggleSort = () => {
                if (this.sortColumn === columnIndex) {
                    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
                }
                else {
                    this.sortColumn = columnIndex;
                    this.sortDirection = 'asc';
                }
                this.danaTableUpdateSortIndicators(headerRow);
                this.danaTableApplyFilters();
            };
            this.listen(cell, 'click', (event) => {
                const target = event.target;
                if (target?.closest('.dana-table-filter-trigger'))
                    return;
                event.preventDefault();
                toggleSort();
            });
            this.listen(cell, 'keydown', (event) => {
                const target = event.target;
                if (target?.closest('.dana-table-filter-trigger'))
                    return;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleSort();
                }
            });
            this.listen(filterTrigger, 'click', (event) => {
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
                    const input = popover.querySelector('.dana-table-filter-popover-input');
                    queueMicrotask(() => { if (!this.destroyed && this.openPopover === popover)
                        input?.focus(); });
                }
            });
            this.renderer.appendChild(headerTools, sortIndicator);
            this.renderer.appendChild(headerTools, filterTrigger);
            this.renderer.appendChild(cell, headerTools);
        });
        this.danaTableUpdateSortIndicators(headerRow);
    }
    danaTableCreatePopover(label, columnIndex, trigger) {
        const ownerDocument = this.host.nativeElement.ownerDocument;
        const popover = this.renderer.createElement('div');
        this.renderer.addClass(popover, 'dana-table-filter-popover');
        const id = `dana-table-filter-${++nextPopoverId}`;
        this.renderer.setAttribute(popover, 'id', id);
        this.renderer.setAttribute(popover, 'role', 'dialog');
        this.renderer.setAttribute(popover, 'aria-label', `Filter ${label}`);
        this.renderer.setAttribute(trigger, 'aria-controls', id);
        this.renderer.setAttribute(trigger, 'aria-haspopup', 'dialog');
        this.popovers.add(popover);
        this.renderer.setStyle(popover, 'display', 'none');
        const heading = this.renderer.createElement('div');
        this.renderer.addClass(heading, 'dana-table-filter-popover-heading');
        const title = this.renderer.createElement('div');
        this.renderer.addClass(title, 'dana-table-filter-popover-title');
        this.renderer.setProperty(title, 'textContent', `Filter ${label}`);
        const close = this.renderer.createElement('button');
        this.renderer.setAttribute(close, 'type', 'button');
        this.renderer.addClass(close, 'dana-table-filter-popover-close');
        this.renderer.setAttribute(close, 'aria-label', 'Close filter');
        const closeIcon = this.renderer.createElement('span');
        this.renderer.addClass(closeIcon, 'dana-glyph');
        this.renderer.addClass(closeIcon, 'dana-glyph-close');
        this.renderer.addClass(closeIcon, 'gear-glyph');
        this.renderer.addClass(closeIcon, 'gear-glyph-close');
        this.renderer.setAttribute(closeIcon, 'aria-hidden', 'true');
        this.renderer.appendChild(close, closeIcon);
        const inputWrap = this.renderer.createElement('div');
        this.renderer.addClass(inputWrap, 'dana-table-filter-search-wrap');
        const searchIcon = this.renderer.createElement('span');
        this.renderer.addClass(searchIcon, 'dana-table-filter-search-icon');
        this.renderer.setAttribute(searchIcon, 'aria-hidden', 'true');
        this.renderer.setProperty(searchIcon, 'innerHTML', '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M10.8 5a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 10.8 5Zm0 1.8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm4.7 8 3.7 3.7-1.3 1.3-3.7-3.7 1.3-1.3Z"></path></svg>');
        const input = this.renderer.createElement('input');
        this.renderer.setAttribute(input, 'type', 'search');
        this.renderer.addClass(input, 'dana-table-filter-popover-input');
        this.renderer.setAttribute(input, 'placeholder', `Search ${label.toLocaleLowerCase()}…`);
        this.renderer.setAttribute(input, 'aria-label', `Search ${label}`);
        this.renderer.setAttribute(input, 'autocomplete', 'off');
        this.renderer.setAttribute(input, 'spellcheck', 'false');
        const footer = this.renderer.createElement('div');
        this.renderer.addClass(footer, 'dana-table-filter-popover-footer');
        const status = this.renderer.createElement('span');
        this.renderer.addClass(status, 'dana-table-filter-status');
        this.renderer.setProperty(status, 'textContent', 'Not filtered');
        const clear = this.renderer.createElement('button');
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
            }
            else {
                this.filters.delete(columnIndex);
                this.renderer.removeClass(trigger, 'dana-table-filter-trigger-active');
                this.renderer.setProperty(status, 'textContent', 'Not filtered');
            }
            this.danaTableApplyFilters();
        };
        this.listen(close, 'click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.danaTableClosePopover();
            trigger.focus();
        });
        this.listen(input, 'input', syncFilter);
        this.listen(input, 'click', (event) => event.stopPropagation());
        this.listen(input, 'keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                this.danaTableClosePopover(true);
            }
            event.stopPropagation();
        });
        this.listen(clear, 'click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            input.value = '';
            syncFilter();
            input.focus();
        });
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
    danaTablePositionOpenPopover() {
        if (!this.openPopover || !this.openTrigger)
            return;
        const rect = this.openTrigger.getBoundingClientRect();
        const width = Math.max(0, Math.min(304, window.innerWidth - 24));
        let left = rect.left;
        if (left + width > window.innerWidth - 12)
            left = window.innerWidth - width - 12;
        if (left < 12)
            left = 12;
        let top = rect.bottom + 8;
        const estimatedHeight = 150;
        if (top + estimatedHeight > window.innerHeight - 12) {
            top = Math.max(12, rect.top - estimatedHeight - 8);
        }
        this.renderer.setStyle(this.openPopover, 'width', `${width}px`);
        this.renderer.setStyle(this.openPopover, 'left', `${Math.round(left)}px`);
        this.renderer.setStyle(this.openPopover, 'top', `${Math.round(top)}px`);
    }
    danaTableClosePopover(restoreFocus = false) {
        if (!this.openPopover)
            return;
        const trigger = this.openTrigger;
        trigger?.setAttribute('aria-expanded', 'false');
        this.renderer.setStyle(this.openPopover, 'display', 'none');
        this.openPopover = undefined;
        this.openTrigger = undefined;
        if (restoreFocus && trigger?.isConnected)
            trigger.focus();
    }
    danaTableUpdateSortIndicators(headerRow) {
        Array.from(headerRow.cells).forEach((cell, index) => {
            const indicator = cell.querySelector('.dana-table-sort-indicator');
            if (!indicator)
                return;
            const active = index === this.sortColumn;
            for (const iconClass of ['dana-glyph-sort', 'dana-glyph-sort-asc', 'dana-glyph-sort-desc', 'gear-glyph-sort', 'gear-glyph-sort-asc', 'gear-glyph-sort-desc']) {
                this.renderer.removeClass(indicator, iconClass);
            }
            this.renderer.addClass(indicator, active
                ? (this.sortDirection === 'asc' ? 'gear-glyph-sort-asc' : 'gear-glyph-sort-desc')
                : 'gear-glyph-sort');
            this.renderer.addClass(indicator, active
                ? (this.sortDirection === 'asc' ? 'dana-glyph-sort-asc' : 'dana-glyph-sort-desc')
                : 'dana-glyph-sort');
            cell.setAttribute('aria-sort', active ? (this.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
            if (active)
                this.renderer.addClass(cell, 'dana-table-sort-active');
            else
                this.renderer.removeClass(cell, 'dana-table-sort-active');
        });
    }
    danaTableApplyFilters() {
        const tbody = this.host.nativeElement.tBodies.item(0);
        if (!tbody || this.destroyed)
            return;
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
                if (visible)
                    visibleGroupCount += 1;
                for (const row of group.rows) {
                    this.renderer.setStyle(row, 'display', visible ? '' : 'none');
                }
            }
            for (const row of emptyRows) {
                this.renderer.setStyle(row, 'display', groups.length === 0 && this.filters.size === 0 ? '' : 'none');
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
                for (const group of groups) {
                    for (const row of group.rows) {
                        this.renderer.appendChild(tbody, row);
                    }
                }
                for (const row of emptyRows) {
                    this.renderer.appendChild(tbody, row);
                }
            }
            this.danaTableSyncNoMatchState(tbody, visibleGroupCount, groups.length);
        }
        finally {
            this.applying = false;
            if (this.observer && !this.destroyed) {
                this.observer.observe(this.host.nativeElement, {
                    childList: true,
                    subtree: true,
                    characterData: true
                });
            }
        }
    }
    danaTableBuildRowGroups(tbody) {
        const groups = [];
        const emptyRows = [];
        const groupsByKey = new Map();
        let currentGroup;
        for (const row of Array.from(tbody.rows)) {
            if (row.classList.contains('dana-table-generated-empty'))
                continue;
            const isDetail = row.hasAttribute('data-dana-table-detail');
            const isEmpty = !isDetail && (row.querySelector('td[danaTableEmpty], td.empty-row') !== null ||
                (row.cells.length === 1 && (row.cells.item(0)?.colSpan ?? 1) > 1));
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
            if (key)
                groupsByKey.set(key, currentGroup);
        }
        return { groups, emptyRows };
    }
    danaTableSyncNoMatchState(tbody, visibleGroupCount, totalGroupCount) {
        const existing = tbody.querySelector('.dana-table-generated-empty');
        const shouldShow = this.filters.size > 0 && totalGroupCount > 0 && visibleGroupCount === 0;
        if (!shouldShow) {
            if (existing?.parentNode)
                this.renderer.removeChild(existing.parentNode, existing);
            return;
        }
        if (existing)
            return;
        const row = this.renderer.createElement('tr');
        this.renderer.addClass(row, 'dana-table-generated-empty');
        const cell = this.renderer.createElement('td');
        this.renderer.addClass(cell, 'empty-row');
        this.renderer.setAttribute(cell, 'colspan', String(this.host.nativeElement.tHead?.rows.item(0)?.cells.length ?? 1));
        this.renderer.setProperty(cell, 'textContent', 'No rows match the active table filters.');
        this.renderer.appendChild(row, cell);
        this.renderer.appendChild(tbody, row);
    }
    danaTableCompare(a, b) {
        const numberPattern = /^\s*[-+]?\d[\d,]*(?:\.\d+)?\s*$/;
        if (numberPattern.test(a) && numberPattern.test(b)) {
            return Number(a.replace(/,/g, '')) - Number(b.replace(/,/g, ''));
        }
        if (/[/:-]|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(a + b)) {
            const ad = Date.parse(a);
            const bd = Date.parse(b);
            if (Number.isFinite(ad) && Number.isFinite(bd))
                return ad - bd;
        }
        return a.localeCompare(b, undefined, {
            numeric: true,
            sensitivity: 'base'
        });
    }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaTableDirective, deps: [{ token: i0.ElementRef }, { token: i0.Renderer2 }], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaTableDirective, isStandalone: true, selector: "table[danaTable]", ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaTableDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: 'table[danaTable]',
                    standalone: true,
                }]
        }], ctorParameters: () => [{ type: i0.ElementRef }, { type: i0.Renderer2 }] });

class DanaCountBadgeDirective {
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaCountBadgeDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaCountBadgeDirective, isStandalone: true, selector: "[danaCountBadge]", ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaCountBadgeDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: '[danaCountBadge]',
                    standalone: true,
                }]
        }] });

class DanaStatusBadgeDirective {
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaStatusBadgeDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaStatusBadgeDirective, isStandalone: true, selector: "[danaStatusBadge]", ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaStatusBadgeDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: '[danaStatusBadge]',
                    standalone: true,
                }]
        }] });

class DanaLoadingStateDirective {
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaLoadingStateDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaLoadingStateDirective, isStandalone: true, selector: "[danaLoadingState]", host: { attributes: { "role": "status", "aria-live": "polite" } }, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaLoadingStateDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: '[danaLoadingState]',
                    standalone: true,
                    host: { role: 'status', 'aria-live': 'polite' },
                }]
        }] });

class DanaEmptyStateDirective {
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaEmptyStateDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaEmptyStateDirective, isStandalone: true, selector: "[danaEmptyState]", ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaEmptyStateDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: '[danaEmptyState]',
                    standalone: true,
                }]
        }] });

class DanaTableEmptyDirective {
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaTableEmptyDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaTableEmptyDirective, isStandalone: true, selector: "td[danaTableEmpty]", ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaTableEmptyDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: 'td[danaTableEmpty]',
                    standalone: true,
                }]
        }] });

class DanaSummaryGridDirective {
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaSummaryGridDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaSummaryGridDirective, isStandalone: true, selector: "[danaSummaryGrid]", host: { classAttribute: "dana-summary-grid" }, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaSummaryGridDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: '[danaSummaryGrid]',
                    standalone: true,
                    host: {
                        class: 'dana-summary-grid',
                    },
                }]
        }] });

class DanaSummaryCardDirective {
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaSummaryCardDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaSummaryCardDirective, isStandalone: true, selector: "[danaSummaryCard]", host: { classAttribute: "dana-summary-card" }, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaSummaryCardDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: '[danaSummaryCard]',
                    standalone: true,
                    host: {
                        class: 'dana-summary-card',
                    },
                }]
        }] });

class DanaPageHeaderComponent {
    constructor() {
        this.eyebrow = '';
        this.heading = '';
        this.description = '';
        this.dashboard = false;
    }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaPageHeaderComponent, deps: [], target: i0.ɵɵFactoryTarget.Component }); }
    static { this.ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "14.0.0", version: "20.3.35", type: DanaPageHeaderComponent, isStandalone: true, selector: "[danaPageHeader]", inputs: { eyebrow: "eyebrow", heading: "heading", description: "description", dashboard: "dashboard" }, host: { classAttribute: "dana-page-header gear-page-header" }, ngImport: i0, template: `
    <div>
      <p class="dana-eyebrow gear-eyebrow">{{ eyebrow }}</p>
      <h1 [class.dana-page-title]="!dashboard" [class.gear-page-title]="!dashboard">{{ heading }}</h1>
      <p [class.dana-page-description]="!dashboard" [class.gear-page-description]="!dashboard">{{ description }}</p>
    </div>
    <ng-content select="[danaPageHeaderAction]"></ng-content>
  `, isInline: true, changeDetection: i0.ChangeDetectionStrategy.OnPush }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaPageHeaderComponent, decorators: [{
            type: Component,
            args: [{
                    selector: '[danaPageHeader]',
                    standalone: true,
                    changeDetection: ChangeDetectionStrategy.OnPush,
                    host: {
                        class: 'dana-page-header gear-page-header',
                    },
                    template: `
    <div>
      <p class="dana-eyebrow gear-eyebrow">{{ eyebrow }}</p>
      <h1 [class.dana-page-title]="!dashboard" [class.gear-page-title]="!dashboard">{{ heading }}</h1>
      <p [class.dana-page-description]="!dashboard" [class.gear-page-description]="!dashboard">{{ description }}</p>
    </div>
    <ng-content select="[danaPageHeaderAction]"></ng-content>
  `,
                }]
        }], propDecorators: { eyebrow: [{
                type: Input
            }], heading: [{
                type: Input
            }], description: [{
                type: Input
            }], dashboard: [{
                type: Input
            }] } });

class DanaOperationCardComponent {
    constructor() {
        this.icon = 'search';
        this.tone = 'blue';
        this.heading = '';
        this.description = '';
    }
    get resolvedIcon() {
        return this.icon?.trim() || 'search';
    }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaOperationCardComponent, deps: [], target: i0.ɵɵFactoryTarget.Component }); }
    static { this.ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "14.0.0", version: "20.3.35", type: DanaOperationCardComponent, isStandalone: true, selector: "a[danaOperationCard]", inputs: { icon: "icon", tone: "tone", heading: "heading", description: "description" }, host: { classAttribute: "dana-operation-card operation-card" }, ngImport: i0, template: `
    <span [class]="'dana-operation-icon operation-icon ' + tone" [attr.data-tone]="tone" aria-hidden="true">
      <span [class]="'gear-glyph gear-glyph-' + resolvedIcon + ' dana-glyph dana-glyph-' + resolvedIcon"></span>
    </span>
    <span class="dana-operation-copy operation-copy"><strong>{{ heading }}</strong><small>{{ description }}</small></span>
    <span class="dana-operation-arrow operation-arrow" aria-hidden="true"></span>
  `, isInline: true, changeDetection: i0.ChangeDetectionStrategy.OnPush }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaOperationCardComponent, decorators: [{
            type: Component,
            args: [{
                    selector: 'a[danaOperationCard]',
                    standalone: true,
                    changeDetection: ChangeDetectionStrategy.OnPush,
                    host: { class: 'dana-operation-card operation-card' },
                    template: `
    <span [class]="'dana-operation-icon operation-icon ' + tone" [attr.data-tone]="tone" aria-hidden="true">
      <span [class]="'gear-glyph gear-glyph-' + resolvedIcon + ' dana-glyph dana-glyph-' + resolvedIcon"></span>
    </span>
    <span class="dana-operation-copy operation-copy"><strong>{{ heading }}</strong><small>{{ description }}</small></span>
    <span class="dana-operation-arrow operation-arrow" aria-hidden="true"></span>
  `,
                }]
        }], propDecorators: { icon: [{
                type: Input
            }], tone: [{
                type: Input
            }], heading: [{
                type: Input
            }], description: [{
                type: Input
            }] } });

class DanaOperationGridDirective {
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaOperationGridDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaOperationGridDirective, isStandalone: true, selector: "[danaOperationGrid]", host: { classAttribute: "dana-operation-grid operation-grid" }, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaOperationGridDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: '[danaOperationGrid]',
                    standalone: true,
                    host: {
                        class: 'dana-operation-grid operation-grid',
                    },
                }]
        }] });

class DanaButtonDirective {
    constructor() {
        this.danaButton = 'secondary';
    }
    get danaPrimary() { return this.danaButton === 'primary'; }
    get gearPrimary() { return this.danaPrimary; }
    get danaSecondary() { return this.danaButton === 'secondary'; }
    get gearSecondary() { return this.danaSecondary; }
    get danaSuccess() { return this.danaButton === 'success'; }
    get gearSuccess() { return this.danaSuccess; }
    get danaDanger() { return this.danaButton === 'danger'; }
    get gearDanger() { return this.danaDanger; }
    get danaDark() { return this.danaButton === 'dark'; }
    get gearDark() { return this.danaDark; }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaButtonDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaButtonDirective, isStandalone: true, selector: "button[danaButton], a[danaButton]", inputs: { danaButton: "danaButton" }, host: { properties: { "class.dana-btn-primary": "this.danaPrimary", "class.gear-btn-primary": "this.gearPrimary", "class.dana-btn-secondary": "this.danaSecondary", "class.gear-btn-secondary": "this.gearSecondary", "class.dana-btn-success": "this.danaSuccess", "class.gear-btn-success": "this.gearSuccess", "class.dana-btn-danger": "this.danaDanger", "class.gear-btn-danger": "this.gearDanger", "class.dana-btn-dark": "this.danaDark", "class.gear-btn-dark": "this.gearDark" }, classAttribute: "dana-btn gear-btn" }, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaButtonDirective, decorators: [{
            type: Directive,
            args: [{ selector: 'button[danaButton], a[danaButton]', standalone: true, host: { class: 'dana-btn gear-btn' } }]
        }], propDecorators: { danaButton: [{
                type: Input
            }], danaPrimary: [{
                type: HostBinding,
                args: ['class.dana-btn-primary']
            }], gearPrimary: [{
                type: HostBinding,
                args: ['class.gear-btn-primary']
            }], danaSecondary: [{
                type: HostBinding,
                args: ['class.dana-btn-secondary']
            }], gearSecondary: [{
                type: HostBinding,
                args: ['class.gear-btn-secondary']
            }], danaSuccess: [{
                type: HostBinding,
                args: ['class.dana-btn-success']
            }], gearSuccess: [{
                type: HostBinding,
                args: ['class.gear-btn-success']
            }], danaDanger: [{
                type: HostBinding,
                args: ['class.dana-btn-danger']
            }], gearDanger: [{
                type: HostBinding,
                args: ['class.gear-btn-danger']
            }], danaDark: [{
                type: HostBinding,
                args: ['class.dana-btn-dark']
            }], gearDark: [{
                type: HostBinding,
                args: ['class.gear-btn-dark']
            }] } });

class DanaIconButtonDirective {
    constructor() {
        this.danaIconButton = 'default';
    }
    get danger() { return this.danaIconButton === 'danger'; }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaIconButtonDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaIconButtonDirective, isStandalone: true, selector: "button[danaIconButton], a[danaIconButton]", inputs: { danaIconButton: "danaIconButton" }, host: { properties: { "class.dana-icon-btn-danger": "this.danger" }, classAttribute: "dana-icon-btn" }, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaIconButtonDirective, decorators: [{
            type: Directive,
            args: [{ selector: 'button[danaIconButton], a[danaIconButton]', standalone: true, host: { class: 'dana-icon-btn' } }]
        }], propDecorators: { danaIconButton: [{
                type: Input
            }], danger: [{
                type: HostBinding,
                args: ['class.dana-icon-btn-danger']
            }] } });

class DanaToolbarDirective {
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaToolbarDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaToolbarDirective, isStandalone: true, selector: "[danaToolbar]", host: { classAttribute: "dana-toolbar gear-actions" }, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaToolbarDirective, decorators: [{
            type: Directive,
            args: [{ selector: '[danaToolbar]', standalone: true, host: { class: 'dana-toolbar gear-actions' } }]
        }] });

class DanaAlertDirective {
    constructor() {
        this.danaAlert = 'info';
    }
    get info() { return this.danaAlert === 'info'; }
    get success() { return this.danaAlert === 'success'; }
    get gearSuccess() { return this.success; }
    get warning() { return this.danaAlert === 'warning'; }
    get gearWarning() { return this.warning; }
    get danger() { return this.danaAlert === 'danger'; }
    get gearDanger() { return this.danger; }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaAlertDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaAlertDirective, isStandalone: true, selector: "[danaAlert]", inputs: { danaAlert: "danaAlert" }, host: { attributes: { "role": "status" }, properties: { "class.dana-alert-info": "this.info", "class.dana-alert-success": "this.success", "class.gear-alert-success": "this.gearSuccess", "class.dana-alert-warning": "this.warning", "class.gear-alert-warning": "this.gearWarning", "class.dana-alert-danger": "this.danger", "class.gear-alert-danger": "this.gearDanger" }, classAttribute: "dana-alert gear-alert" }, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaAlertDirective, decorators: [{
            type: Directive,
            args: [{ selector: '[danaAlert]', standalone: true, host: { class: 'dana-alert gear-alert', role: 'status' } }]
        }], propDecorators: { danaAlert: [{
                type: Input
            }], info: [{
                type: HostBinding,
                args: ['class.dana-alert-info']
            }], success: [{
                type: HostBinding,
                args: ['class.dana-alert-success']
            }], gearSuccess: [{
                type: HostBinding,
                args: ['class.gear-alert-success']
            }], warning: [{
                type: HostBinding,
                args: ['class.dana-alert-warning']
            }], gearWarning: [{
                type: HostBinding,
                args: ['class.gear-alert-warning']
            }], danger: [{
                type: HostBinding,
                args: ['class.dana-alert-danger']
            }], gearDanger: [{
                type: HostBinding,
                args: ['class.gear-alert-danger']
            }] } });

class DanaDetailGridDirective {
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaDetailGridDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaDetailGridDirective, isStandalone: true, selector: "[danaDetailGrid]", host: { classAttribute: "dana-detail-grid gear-detail-grid" }, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaDetailGridDirective, decorators: [{
            type: Directive,
            args: [{ selector: '[danaDetailGrid]', standalone: true, host: { class: 'dana-detail-grid gear-detail-grid' } }]
        }] });

class DanaDetailItemComponent {
    constructor() {
        this.label = '';
        this.value = '';
    }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaDetailItemComponent, deps: [], target: i0.ɵɵFactoryTarget.Component }); }
    static { this.ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "14.0.0", version: "20.3.35", type: DanaDetailItemComponent, isStandalone: true, selector: "dana-detail-item", inputs: { label: "label", value: "value" }, host: { classAttribute: "dana-detail gear-detail" }, ngImport: i0, template: `<span class="dana-detail-label gear-detail-label">{{ label }}</span><span class="dana-detail-value gear-detail-value"><ng-content></ng-content>{{ value }}</span>`, isInline: true, changeDetection: i0.ChangeDetectionStrategy.OnPush }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaDetailItemComponent, decorators: [{
            type: Component,
            args: [{ selector: 'dana-detail-item', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, host: { class: 'dana-detail gear-detail' }, template: `<span class="dana-detail-label gear-detail-label">{{ label }}</span><span class="dana-detail-value gear-detail-value"><ng-content></ng-content>{{ value }}</span>` }]
        }], propDecorators: { label: [{
                type: Input
            }], value: [{
                type: Input
            }] } });

class DanaTabsDirective {
    constructor(host) {
        this.host = host;
    }
    onKeydown(event) {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
            return;
        const tabs = Array.from(this.host.nativeElement.querySelectorAll('[danaTab]:not([disabled])'));
        if (!tabs.length)
            return;
        const current = Math.max(0, tabs.indexOf(document.activeElement));
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (current + 1) % tabs.length : (current - 1 + tabs.length) % tabs.length;
        event.preventDefault();
        tabs[next]?.focus();
    }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaTabsDirective, deps: [{ token: i0.ElementRef }], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaTabsDirective, isStandalone: true, selector: "[danaTabs]", host: { attributes: { "role": "tablist" }, listeners: { "keydown": "onKeydown($event)" }, classAttribute: "dana-tabs" }, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaTabsDirective, decorators: [{
            type: Directive,
            args: [{ selector: '[danaTabs]', standalone: true, host: { class: 'dana-tabs', role: 'tablist' } }]
        }], ctorParameters: () => [{ type: i0.ElementRef }], propDecorators: { onKeydown: [{
                type: HostListener,
                args: ['keydown', ['$event']]
            }] } });

class DanaTabDirective {
    constructor() {
        this.active = false;
    }
    get isActive() { return this.active; }
    get ariaSelected() { return String(this.active); }
    get tabIndex() { return this.active ? 0 : -1; }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaTabDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaTabDirective, isStandalone: true, selector: "button[danaTab], a[danaTab]", inputs: { active: "active" }, host: { attributes: { "role": "tab" }, properties: { "class.is-active": "this.isActive", "attr.aria-selected": "this.ariaSelected", "attr.tabindex": "this.tabIndex" }, classAttribute: "dana-tab" }, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaTabDirective, decorators: [{
            type: Directive,
            args: [{ selector: 'button[danaTab], a[danaTab]', standalone: true, host: { class: 'dana-tab', role: 'tab' } }]
        }], propDecorators: { active: [{
                type: Input
            }], isActive: [{
                type: HostBinding,
                args: ['class.is-active']
            }], ariaSelected: [{
                type: HostBinding,
                args: ['attr.aria-selected']
            }], tabIndex: [{
                type: HostBinding,
                args: ['attr.tabindex']
            }] } });

class DanaToastService {
    constructor() {
        this.nextId = 1;
        this.noticesSubject = new BehaviorSubject([]);
        this.notices$ = this.noticesSubject.asObservable();
    }
    success(message, title = 'Done', durationMs = 4500) { this.show('success', title, message, durationMs); }
    warning(message, title = 'Attention', durationMs = 6500) { this.show('warning', title, message, durationMs); }
    error(message, title = 'Something went wrong', durationMs = 6500) { this.show('error', title, message, durationMs); }
    info(message, title = 'Notice', durationMs = 5000) { this.show('info', title, message, durationMs); }
    dismiss(id) { this.noticesSubject.next(this.noticesSubject.value.filter(n => n.id !== id)); }
    show(tone, title, message, durationMs) { const notice = { id: this.nextId++, tone, title, message, durationMs }; this.noticesSubject.next([...this.noticesSubject.value, notice].slice(-4)); globalThis.setTimeout(() => this.dismiss(notice.id), durationMs); }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaToastService, deps: [], target: i0.ɵɵFactoryTarget.Injectable }); }
    static { this.ɵprov = i0.ɵɵngDeclareInjectable({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaToastService, providedIn: 'root' }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaToastService, decorators: [{
            type: Injectable,
            args: [{ providedIn: 'root' }]
        }] });

class DanaToastHostComponent {
    constructor(toast) {
        this.toast = toast;
    }
    trackById(_i, n) { return n.id; }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaToastHostComponent, deps: [{ token: DanaToastService }], target: i0.ɵɵFactoryTarget.Component }); }
    static { this.ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "14.0.0", version: "20.3.35", type: DanaToastHostComponent, isStandalone: true, selector: "dana-toast-host, gear-toast-host", ngImport: i0, template: `<div class="dana-toast-stack gear-toast-stack" aria-live="polite" aria-relevant="additions removals"><article *ngFor="let notice of toast.notices$ | async; trackBy: trackById" class="dana-toast gear-toast" [class.toast-success]="notice.tone === 'success'" [class.toast-warning]="notice.tone === 'warning'" [class.toast-error]="notice.tone === 'error'" [class.toast-info]="notice.tone === 'info'" [attr.role]="notice.tone === 'error' ? 'alert' : 'status'"><div class="dana-toast-icon gear-toast-icon" aria-hidden="true">{{ notice.tone === 'success' ? '✓' : notice.tone === 'warning' ? '!' : notice.tone === 'error' ? '!' : 'i' }}</div><div class="dana-toast-copy gear-toast-copy"><strong>{{ notice.title }}</strong><span>{{ notice.message }}</span></div><button type="button" class="dana-toast-close gear-toast-close" aria-label="Dismiss notification" (click)="toast.dismiss(notice.id)">×</button></article></div>`, isInline: true, dependencies: [{ kind: "ngmodule", type: CommonModule }, { kind: "directive", type: i2.NgForOf, selector: "[ngFor][ngForOf]", inputs: ["ngForOf", "ngForTrackBy", "ngForTemplate"] }, { kind: "pipe", type: i2.AsyncPipe, name: "async" }], changeDetection: i0.ChangeDetectionStrategy.OnPush }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaToastHostComponent, decorators: [{
            type: Component,
            args: [{ selector: 'dana-toast-host, gear-toast-host', standalone: true, imports: [CommonModule, AsyncPipe], changeDetection: ChangeDetectionStrategy.OnPush, template: `<div class="dana-toast-stack gear-toast-stack" aria-live="polite" aria-relevant="additions removals"><article *ngFor="let notice of toast.notices$ | async; trackBy: trackById" class="dana-toast gear-toast" [class.toast-success]="notice.tone === 'success'" [class.toast-warning]="notice.tone === 'warning'" [class.toast-error]="notice.tone === 'error'" [class.toast-info]="notice.tone === 'info'" [attr.role]="notice.tone === 'error' ? 'alert' : 'status'"><div class="dana-toast-icon gear-toast-icon" aria-hidden="true">{{ notice.tone === 'success' ? '✓' : notice.tone === 'warning' ? '!' : notice.tone === 'error' ? '!' : 'i' }}</div><div class="dana-toast-copy gear-toast-copy"><strong>{{ notice.title }}</strong><span>{{ notice.message }}</span></div><button type="button" class="dana-toast-close gear-toast-close" aria-label="Dismiss notification" (click)="toast.dismiss(notice.id)">×</button></article></div>` }]
        }], ctorParameters: () => [{ type: DanaToastService }] });

let nextDialogId = 0;
class DanaConfirmDialogComponent {
    constructor() {
        this.open = false;
        this.title = 'Confirm';
        this.message = '';
        this.confirmLabel = 'Confirm';
        this.cancelLabel = 'Cancel';
        this.danger = false;
        this.confirm = new EventEmitter();
        this.cancel = new EventEmitter();
        this.messageId = `dana-dialog-message-${++nextDialogId}`;
        this.destroyed = false;
    }
    ngOnChanges() { this.syncOpen(); }
    ngAfterViewInit() { this.syncOpen(); }
    ngOnDestroy() {
        this.destroyed = true;
        this.close();
    }
    onCancel(event) {
        // The parent owns `open`, as it does for the action buttons.
        event.preventDefault();
        this.cancel.emit();
    }
    onClose() {
        if (!this.destroyed && this.open && !this.dialogRef?.nativeElement.open)
            this.cancel.emit();
    }
    onBackdropClick(event) {
        const dialog = this.dialogRef?.nativeElement;
        if (!dialog || event.target !== dialog)
            return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom)
            this.cancel.emit();
    }
    syncOpen() {
        const dialog = this.dialogRef?.nativeElement;
        if (!dialog || typeof dialog.showModal !== 'function')
            return;
        if (this.open && !dialog.open) {
            this.previouslyFocused = dialog.ownerDocument.activeElement;
            // Native modality makes the background inert and contains keyboard focus.
            dialog.showModal();
            this.cancelButton?.nativeElement.focus();
        }
        else if (!this.open)
            this.close();
    }
    close() {
        const dialog = this.dialogRef?.nativeElement;
        if (!dialog?.open)
            return;
        dialog.close();
        if (this.previouslyFocused?.isConnected)
            this.previouslyFocused.focus();
        this.previouslyFocused = undefined;
    }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaConfirmDialogComponent, deps: [], target: i0.ɵɵFactoryTarget.Component }); }
    static { this.ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "14.0.0", version: "20.3.35", type: DanaConfirmDialogComponent, isStandalone: true, selector: "dana-confirm-dialog", inputs: { open: "open", title: "title", message: "message", confirmLabel: "confirmLabel", cancelLabel: "cancelLabel", danger: "danger" }, outputs: { confirm: "confirm", cancel: "cancel" }, viewQueries: [{ propertyName: "dialogRef", first: true, predicate: ["dialog"], descendants: true, static: true }, { propertyName: "cancelButton", first: true, predicate: ["cancelButton"], descendants: true, static: true }], usesOnChanges: true, ngImport: i0, template: `
    <dialog #dialog class="dana-confirm-dialog" role="alertdialog" aria-modal="true"
      [attr.aria-label]="title" [attr.aria-describedby]="message ? messageId : null" (cancel)="onCancel($event)" (close)="onClose()"
      (click)="onBackdropClick($event)">
      <h2>{{ title }}</h2>
      <p [id]="messageId">{{ message }}</p>
      <ng-content></ng-content>
      <div class="dana-dialog-actions">
        <button #cancelButton type="button" class="dana-btn dana-btn-secondary" (click)="cancel.emit()">{{ cancelLabel }}</button>
        <button type="button" class="dana-btn" [class.dana-btn-danger]="danger"
          [class.dana-btn-primary]="!danger" (click)="confirm.emit()">{{ confirmLabel }}</button>
      </div>
    </dialog>
  `, isInline: true, dependencies: [{ kind: "ngmodule", type: CommonModule }], changeDetection: i0.ChangeDetectionStrategy.OnPush }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaConfirmDialogComponent, decorators: [{
            type: Component,
            args: [{
                    selector: 'dana-confirm-dialog',
                    standalone: true,
                    imports: [CommonModule],
                    changeDetection: ChangeDetectionStrategy.OnPush,
                    template: `
    <dialog #dialog class="dana-confirm-dialog" role="alertdialog" aria-modal="true"
      [attr.aria-label]="title" [attr.aria-describedby]="message ? messageId : null" (cancel)="onCancel($event)" (close)="onClose()"
      (click)="onBackdropClick($event)">
      <h2>{{ title }}</h2>
      <p [id]="messageId">{{ message }}</p>
      <ng-content></ng-content>
      <div class="dana-dialog-actions">
        <button #cancelButton type="button" class="dana-btn dana-btn-secondary" (click)="cancel.emit()">{{ cancelLabel }}</button>
        <button type="button" class="dana-btn" [class.dana-btn-danger]="danger"
          [class.dana-btn-primary]="!danger" (click)="confirm.emit()">{{ confirmLabel }}</button>
      </div>
    </dialog>
  `,
                }]
        }], propDecorators: { open: [{
                type: Input
            }], title: [{
                type: Input
            }], message: [{
                type: Input
            }], confirmLabel: [{
                type: Input
            }], cancelLabel: [{
                type: Input
            }], danger: [{
                type: Input
            }], confirm: [{
                type: Output
            }], cancel: [{
                type: Output
            }], dialogRef: [{
                type: ViewChild,
                args: ['dialog', { static: true }]
            }], cancelButton: [{
                type: ViewChild,
                args: ['cancelButton', { static: true }]
            }] } });

class DanaMobileNavDirective {
    constructor() {
        /** Match the consuming app's CSS desktop breakpoint. */
        this.desktopMinWidth = 1025;
        this.open = false;
    }
    isDesktop() {
        const configuredWidth = Number(this.desktopMinWidth);
        const width = Number.isSafeInteger(configuredWidth) && configuredWidth > 0 ? configuredWidth : 1025;
        return typeof window !== 'undefined' && window.matchMedia(`(min-width: ${width}px)`).matches;
    }
    toggle() {
        if (this.isDesktop()) {
            this.open = false;
            document.querySelector('.dana-sidebar .dana-side-link')?.focus();
            return;
        }
        this.open = !this.open;
    }
    close() {
        this.open = false;
    }
    onEscape() {
        this.close();
    }
    onResize() {
        if (this.isDesktop()) {
            this.close();
        }
    }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaMobileNavDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaMobileNavDirective, isStandalone: true, selector: "[danaMobileNav]", inputs: { desktopMinWidth: "desktopMinWidth" }, host: { listeners: { "document:keydown.escape": "onEscape()", "window:resize": "onResize()" } }, exportAs: ["danaMobileNav"], ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaMobileNavDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: '[danaMobileNav]',
                    standalone: true,
                    exportAs: 'danaMobileNav',
                }]
        }], propDecorators: { desktopMinWidth: [{
                type: Input
            }], onEscape: [{
                type: HostListener,
                args: ['document:keydown.escape']
            }], onResize: [{
                type: HostListener,
                args: ['window:resize']
            }] } });

class DanaResponsiveGridDirective {
    constructor() {
        this.hostClass = true;
        this.danaColumns = 4;
        this.danaCompactColumns = 2;
        this.danaMobileColumns = 1;
        this.danaGridGap = 'var(--gear-space-4, 16px)';
    }
    get columns() { return String(this.danaColumns); }
    get compactColumns() { return String(this.danaCompactColumns); }
    get mobileColumns() { return String(this.danaMobileColumns); }
    get gap() { return this.danaGridGap; }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaResponsiveGridDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaResponsiveGridDirective, isStandalone: true, selector: "[danaResponsiveGrid]", inputs: { danaColumns: "danaColumns", danaCompactColumns: "danaCompactColumns", danaMobileColumns: "danaMobileColumns", danaGridGap: "danaGridGap" }, host: { properties: { "class.dana-responsive-grid": "this.hostClass", "style.--dana-grid-columns": "this.columns", "style.--dana-grid-compact-columns": "this.compactColumns", "style.--dana-grid-mobile-columns": "this.mobileColumns", "style.--dana-grid-gap": "this.gap" } }, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaResponsiveGridDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: '[danaResponsiveGrid]',
                    standalone: true,
                }]
        }], propDecorators: { hostClass: [{
                type: HostBinding,
                args: ['class.dana-responsive-grid']
            }], danaColumns: [{
                type: Input
            }], danaCompactColumns: [{
                type: Input
            }], danaMobileColumns: [{
                type: Input
            }], danaGridGap: [{
                type: Input
            }], columns: [{
                type: HostBinding,
                args: ['style.--dana-grid-columns']
            }], compactColumns: [{
                type: HostBinding,
                args: ['style.--dana-grid-compact-columns']
            }], mobileColumns: [{
                type: HostBinding,
                args: ['style.--dana-grid-mobile-columns']
            }], gap: [{
                type: HostBinding,
                args: ['style.--dana-grid-gap']
            }] } });

class DanaStackDirective {
    constructor() {
        this.hostClass = true;
        this.danaStackGap = 'var(--gear-space-4, 16px)';
        this.danaStackAlign = 'stretch';
        this.danaStackJustify = 'flex-start';
        this.danaStackMobile = false;
    }
    get mobile() { return this.danaStackMobile; }
    get gap() { return this.danaStackGap; }
    get align() { return this.danaStackAlign; }
    get justify() { return this.danaStackJustify; }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaStackDirective, deps: [], target: i0.ɵɵFactoryTarget.Directive }); }
    static { this.ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.3.35", type: DanaStackDirective, isStandalone: true, selector: "[danaStack]", inputs: { danaStackGap: "danaStackGap", danaStackAlign: "danaStackAlign", danaStackJustify: "danaStackJustify", danaStackMobile: "danaStackMobile" }, host: { properties: { "class.dana-stack": "this.hostClass", "class.dana-stack-mobile": "this.mobile", "style.--dana-stack-gap": "this.gap", "style.--dana-stack-align": "this.align", "style.--dana-stack-justify": "this.justify" } }, ngImport: i0 }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaStackDirective, decorators: [{
            type: Directive,
            args: [{
                    selector: '[danaStack]',
                    standalone: true,
                }]
        }], propDecorators: { hostClass: [{
                type: HostBinding,
                args: ['class.dana-stack']
            }], danaStackGap: [{
                type: Input
            }], danaStackAlign: [{
                type: Input
            }], danaStackJustify: [{
                type: Input
            }], danaStackMobile: [{
                type: Input
            }], mobile: [{
                type: HostBinding,
                args: ['class.dana-stack-mobile']
            }], gap: [{
                type: HostBinding,
                args: ['style.--dana-stack-gap']
            }], align: [{
                type: HostBinding,
                args: ['style.--dana-stack-align']
            }], justify: [{
                type: HostBinding,
                args: ['style.--dana-stack-justify']
            }] } });

let nextId = 0;
/**
 * Searchable dropdown that lists rows under column headers.
 *
 * - Pick mode (default): the bound value is the chosen row's key; typing only filters.
 * - Free-text mode (`freeText`): the bound value is the typed text; rows are suggestions,
 *   and choosing one fills in the text from `textOf` and emits `picked`.
 *
 * Keyboard: Down/Up move, Enter picks, Escape closes, Home/End jump. Works with ngModel
 * and reactive forms.
 */
class DanaComboboxComponent {
    get disabled() { return this.disabledValue; }
    set disabled(value) {
        this.disabledValue = value;
        if (value) {
            this.close();
            if (!this.freeText) {
                this.inputText = this.labelFor(this.selectedKey);
                this.query = '';
            }
        }
    }
    constructor(host, cdr) {
        this.host = host;
        this.cdr = cdr;
        this.options = [];
        this.columns = [];
        /** Stable key for a row (pick mode binds to this). */
        this.keyOf = (row) => String(row);
        this.freeText = false;
        this.placeholder = 'Select…';
        this.ariaLabel = '';
        this.emptyText = 'No matches';
        this.loading = false;
        this.loadingText = 'Loading…';
        /** Rows visible before the list scrolls. */
        this.maxRows = 8;
        this.disabledValue = false;
        /** Upper-case typed text (load numbers, trailer IDs). */
        this.uppercase = false;
        this.picked = new EventEmitter();
        this.textChange = new EventEmitter();
        this.inputId = `dana-combobox-${++nextId}`;
        this.listId = `${this.inputId}-list`;
        this.open = false;
        this.query = '';
        this.inputText = '';
        this.selectedKey = '';
        this.activeIndex = -1;
        this.filtered = [];
        /** Fixed-position placement so a panel or table that clips overflow cannot cut the list off. */
        this.placement = { top: null, bottom: null, left: 0, width: 0, listMax: 336, above: false };
        this.onChange = () => undefined;
        this.onTouched = () => undefined;
        this.destroyed = false;
    }
    get gridTemplate() {
        return this.columns.map((column) => column.width || '1fr').join(' ');
    }
    ngOnChanges() {
        // New options while the list is open must not overwrite what the user is typing.
        if (!this.freeText && !this.open)
            this.inputText = this.labelFor(this.selectedKey);
        this.refilter();
    }
    // ControlValueAccessor
    writeValue(value) {
        const text = value == null ? '' : String(value);
        if (this.freeText) {
            this.inputText = text;
            this.query = '';
        }
        else {
            this.selectedKey = text;
            this.inputText = this.labelFor(text);
            this.query = '';
        }
        this.refilter();
        this.cdr.markForCheck();
    }
    registerOnChange(fn) { this.onChange = fn; }
    registerOnTouched(fn) { this.onTouched = fn; }
    setDisabledState(disabled) { this.disabled = disabled; this.cdr.markForCheck(); }
    cell(column, row) {
        const value = column.value(row);
        return value == null || value === '' ? '—' : String(value);
    }
    describe(row) {
        return this.columns.map((column) => `${column.label}: ${this.cell(column, row)}`).join(', ');
    }
    optionId(index) { return `${this.inputId}-option-${index}`; }
    onFocus() { this.openList(); }
    onInput(raw) {
        if (this.disabled)
            return;
        const text = this.uppercase ? raw.toUpperCase() : raw;
        if (text !== raw)
            this.inputRef.nativeElement.value = text;
        this.inputText = text;
        this.query = text;
        if (this.freeText) {
            this.onChange(text);
            this.textChange.emit(text);
        }
        else if (!text && this.selectedKey) {
            this.selectedKey = '';
            this.onChange('');
            this.picked.emit(null);
        }
        if (!this.open)
            this.openList();
        this.refilter();
        this.activeIndex = this.filtered.length ? 0 : -1;
    }
    onKeydown(event) {
        if (this.disabled)
            return;
        const last = this.filtered.length - 1;
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                if (!this.open) {
                    this.openList(true);
                    return;
                }
                this.move(Math.min(last, this.activeIndex + 1));
                break;
            case 'ArrowUp':
                event.preventDefault();
                if (!this.open) {
                    this.openList(true);
                    return;
                }
                this.move(Math.max(0, this.activeIndex - 1));
                break;
            case 'Home':
                if (this.open && this.filtered.length) {
                    event.preventDefault();
                    this.move(0);
                }
                break;
            case 'End':
                if (this.open && this.filtered.length) {
                    event.preventDefault();
                    this.move(last);
                }
                break;
            case 'Enter':
                if (this.open && this.activeIndex >= 0 && this.filtered[this.activeIndex]) {
                    event.preventDefault();
                    this.pick(this.filtered[this.activeIndex]);
                }
                break;
            case 'Escape':
                if (this.open) {
                    event.preventDefault();
                    this.close();
                }
                break;
            case 'Tab':
                this.close();
                break;
        }
    }
    onBlur() {
        this.onTouched();
        // Pick mode never keeps half-typed text: show the chosen row again.
        if (!this.freeText) {
            this.inputText = this.labelFor(this.selectedKey);
            this.query = '';
        }
        this.close();
    }
    openList(showAll = false) {
        if (this.disabled || this.open)
            return;
        if (showAll)
            this.query = '';
        this.open = true;
        // Scroll events from overflow panels do not bubble to the window.
        const document = this.host.nativeElement.ownerDocument;
        const reposition = () => this.onViewportChange();
        document.addEventListener('scroll', reposition, true);
        this.scrollCleanup = () => document.removeEventListener('scroll', reposition, true);
        this.place();
        this.refilter();
        const selected = this.filtered.findIndex((row) => !this.freeText && this.keyOf(row) === this.selectedKey);
        this.activeIndex = selected >= 0 ? selected : (this.filtered.length ? 0 : -1);
        this.cdr.markForCheck();
        this.scrollActive();
    }
    close() {
        this.scrollCleanup?.();
        this.scrollCleanup = undefined;
        if (!this.open)
            return;
        this.open = false;
        this.activeIndex = -1;
        this.cdr.markForCheck();
    }
    clear() {
        if (this.disabled)
            return;
        this.selectedKey = '';
        this.inputText = '';
        this.query = '';
        this.onChange('');
        this.picked.emit(null);
        this.refilter();
        this.inputRef.nativeElement.focus();
    }
    pick(row) {
        if (this.disabled)
            return;
        const key = this.keyOf(row);
        if (this.freeText) {
            this.inputText = this.textFor(row);
            this.onChange(this.inputText);
            this.textChange.emit(this.inputText);
        }
        else {
            this.selectedKey = key;
            this.inputText = this.textFor(row);
            this.onChange(key);
        }
        this.query = '';
        this.picked.emit(row);
        this.close();
        this.refilter();
    }
    onViewportChange() {
        if (!this.open)
            return;
        this.place();
        this.cdr.markForCheck();
    }
    /** Below the input when there is room, otherwise above; never wider than the viewport. */
    place() {
        if (typeof window === 'undefined')
            return;
        const rect = this.host.nativeElement.getBoundingClientRect();
        const gap = 6, edge = 16;
        const preferred = parseFloat(getComputedStyle(this.host.nativeElement).getPropertyValue('--dana-combobox-panel-width')) || 680;
        const width = Math.min(Math.max(rect.width, preferred), window.innerWidth - edge * 2);
        const left = Math.min(Math.max(edge, rect.left), window.innerWidth - edge - width);
        const below = window.innerHeight - rect.bottom - gap - edge;
        const above = rect.top - gap - edge;
        const header = 36, foot = 8, rows = 42 * Math.min(Math.max(this.maxRows, 1), 8);
        const openAbove = below < Math.min(rows, 220) && above > below;
        const room = Math.max(120, (openAbove ? above : below) - header - foot);
        this.placement = {
            top: openAbove ? null : rect.bottom + gap,
            bottom: openAbove ? window.innerHeight - rect.top + gap : null,
            left, width, listMax: Math.min(rows, room), above: openAbove,
        };
    }
    onDocumentMouseDown(event) {
        if (this.open && !this.host.nativeElement.contains(event.target))
            this.close();
    }
    ngOnDestroy() {
        this.destroyed = true;
        this.scrollCleanup?.();
    }
    move(index) {
        this.activeIndex = index;
        this.cdr.markForCheck();
        this.scrollActive();
    }
    scrollActive() {
        queueMicrotask(() => {
            if (this.destroyed || !this.open)
                return;
            const el = this.host.nativeElement.querySelector(`#${this.optionId(this.activeIndex)}`);
            el?.scrollIntoView?.({ block: 'nearest' });
        });
    }
    refilter() {
        const terms = this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const rows = [...(this.options ?? [])];
        this.filtered = terms.length
            ? rows.filter((row) => {
                const haystack = this.columns.map((column) => this.cell(column, row)).join(' ').toLowerCase();
                return terms.every((term) => haystack.includes(term));
            })
            : rows;
        if (this.activeIndex >= this.filtered.length)
            this.activeIndex = this.filtered.length - 1;
    }
    textFor(row) {
        if (this.textOf)
            return this.textOf(row);
        const first = this.columns[0];
        return first ? String(first.value(row) ?? '') : this.keyOf(row);
    }
    labelFor(key) {
        if (!key)
            return '';
        const row = (this.options ?? []).find((candidate) => this.keyOf(candidate) === key);
        return row ? this.textFor(row) : key;
    }
    static { this.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaComboboxComponent, deps: [{ token: i0.ElementRef }, { token: i0.ChangeDetectorRef }], target: i0.ɵɵFactoryTarget.Component }); }
    static { this.ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "17.0.0", version: "20.3.35", type: DanaComboboxComponent, isStandalone: true, selector: "dana-combobox", inputs: { options: "options", columns: "columns", keyOf: "keyOf", textOf: "textOf", freeText: "freeText", placeholder: "placeholder", ariaLabel: "ariaLabel", emptyText: "emptyText", loading: "loading", loadingText: "loadingText", maxRows: "maxRows", disabled: "disabled", uppercase: "uppercase" }, outputs: { picked: "picked", textChange: "textChange" }, host: { listeners: { "window:resize": "onViewportChange()", "document:mousedown": "onDocumentMouseDown($event)" }, properties: { "class.is-open": "open", "class.is-disabled": "disabled" }, classAttribute: "dana-combobox" }, providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DanaComboboxComponent), multi: true }], viewQueries: [{ propertyName: "inputRef", first: true, predicate: ["input"], descendants: true, static: true }], usesOnChanges: true, ngImport: i0, template: `
    <div class="dana-combobox-control">
      <input
        #input
        class="dana-combobox-input"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        [id]="inputId"
        [attr.aria-label]="ariaLabel || null"
        [attr.aria-expanded]="open"
        [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="open && activeIndex >= 0 ? optionId(activeIndex) : null"
        aria-autocomplete="list"
        [placeholder]="placeholder"
        [disabled]="disabled"
        [value]="inputText"
        (input)="onInput($any($event.target).value)"
        (focus)="onFocus()"
        (click)="openList()"
        (keydown)="onKeydown($event)"
        (blur)="onBlur()">
      @if (!freeText && selectedKey && !disabled) {
        <button type="button" class="dana-combobox-clear" tabindex="-1" aria-label="Clear" (mousedown)="$event.preventDefault()" (click)="clear()">&times;</button>
      }
      <button type="button" class="dana-combobox-toggle" tabindex="-1" [attr.aria-label]="open ? 'Close list' : 'Open list'"
        [disabled]="disabled" (mousedown)="$event.preventDefault()" (click)="open ? close() : openList(true)">
        <span aria-hidden="true"></span>
      </button>
    </div>
    @if (open) {
      <div class="dana-combobox-panel" [class.is-above]="placement.above" [style.--dana-combobox-columns]="gridTemplate"
        [style.top.px]="placement.top" [style.bottom.px]="placement.bottom" [style.left.px]="placement.left" [style.width.px]="placement.width"
        [style.--dana-combobox-list-max]="placement.listMax + 'px'">
        <div class="dana-combobox-head" aria-hidden="true">
          @for (column of columns; track column.label) {
            <span [class.is-end]="column.align === 'end'">{{ column.label }}</span>
          }
        </div>
        <ul class="dana-combobox-list" role="listbox" [id]="listId" [attr.aria-label]="ariaLabel || placeholder">
          @for (row of filtered; track keyOf(row); let i = $index) {
            <li
              class="dana-combobox-option"
              role="option"
              [id]="optionId(i)"
              [class.is-active]="i === activeIndex"
              [class.is-selected]="!freeText && keyOf(row) === selectedKey"
              [attr.aria-selected]="!freeText && keyOf(row) === selectedKey"
              [attr.aria-label]="describe(row)"
              (mousedown)="$event.preventDefault()"
              (mouseenter)="activeIndex = i"
              (click)="pick(row)">
              @for (column of columns; track column.label) {
                <span [class.is-end]="column.align === 'end'">{{ cell(column, row) }}</span>
              }
            </li>
          } @empty {
            <li class="dana-combobox-empty" role="presentation">{{ loading ? loadingText : emptyText }}</li>
          }
        </ul>
        @if (filtered.length > maxRows && query) {
          <div class="dana-combobox-foot" aria-live="polite">{{ filtered.length }} matches</div>
        }
      </div>
    }
  `, isInline: true, dependencies: [{ kind: "ngmodule", type: CommonModule }], changeDetection: i0.ChangeDetectionStrategy.OnPush }); }
}
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "20.3.35", ngImport: i0, type: DanaComboboxComponent, decorators: [{
            type: Component,
            args: [{
                    selector: 'dana-combobox',
                    standalone: true,
                    imports: [CommonModule],
                    changeDetection: ChangeDetectionStrategy.OnPush,
                    providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DanaComboboxComponent), multi: true }],
                    host: { class: 'dana-combobox', '[class.is-open]': 'open', '[class.is-disabled]': 'disabled' },
                    template: `
    <div class="dana-combobox-control">
      <input
        #input
        class="dana-combobox-input"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        [id]="inputId"
        [attr.aria-label]="ariaLabel || null"
        [attr.aria-expanded]="open"
        [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="open && activeIndex >= 0 ? optionId(activeIndex) : null"
        aria-autocomplete="list"
        [placeholder]="placeholder"
        [disabled]="disabled"
        [value]="inputText"
        (input)="onInput($any($event.target).value)"
        (focus)="onFocus()"
        (click)="openList()"
        (keydown)="onKeydown($event)"
        (blur)="onBlur()">
      @if (!freeText && selectedKey && !disabled) {
        <button type="button" class="dana-combobox-clear" tabindex="-1" aria-label="Clear" (mousedown)="$event.preventDefault()" (click)="clear()">&times;</button>
      }
      <button type="button" class="dana-combobox-toggle" tabindex="-1" [attr.aria-label]="open ? 'Close list' : 'Open list'"
        [disabled]="disabled" (mousedown)="$event.preventDefault()" (click)="open ? close() : openList(true)">
        <span aria-hidden="true"></span>
      </button>
    </div>
    @if (open) {
      <div class="dana-combobox-panel" [class.is-above]="placement.above" [style.--dana-combobox-columns]="gridTemplate"
        [style.top.px]="placement.top" [style.bottom.px]="placement.bottom" [style.left.px]="placement.left" [style.width.px]="placement.width"
        [style.--dana-combobox-list-max]="placement.listMax + 'px'">
        <div class="dana-combobox-head" aria-hidden="true">
          @for (column of columns; track column.label) {
            <span [class.is-end]="column.align === 'end'">{{ column.label }}</span>
          }
        </div>
        <ul class="dana-combobox-list" role="listbox" [id]="listId" [attr.aria-label]="ariaLabel || placeholder">
          @for (row of filtered; track keyOf(row); let i = $index) {
            <li
              class="dana-combobox-option"
              role="option"
              [id]="optionId(i)"
              [class.is-active]="i === activeIndex"
              [class.is-selected]="!freeText && keyOf(row) === selectedKey"
              [attr.aria-selected]="!freeText && keyOf(row) === selectedKey"
              [attr.aria-label]="describe(row)"
              (mousedown)="$event.preventDefault()"
              (mouseenter)="activeIndex = i"
              (click)="pick(row)">
              @for (column of columns; track column.label) {
                <span [class.is-end]="column.align === 'end'">{{ cell(column, row) }}</span>
              }
            </li>
          } @empty {
            <li class="dana-combobox-empty" role="presentation">{{ loading ? loadingText : emptyText }}</li>
          }
        </ul>
        @if (filtered.length > maxRows && query) {
          <div class="dana-combobox-foot" aria-live="polite">{{ filtered.length }} matches</div>
        }
      </div>
    }
  `,
                }]
        }], ctorParameters: () => [{ type: i0.ElementRef }, { type: i0.ChangeDetectorRef }], propDecorators: { options: [{
                type: Input
            }], columns: [{
                type: Input
            }], keyOf: [{
                type: Input
            }], textOf: [{
                type: Input
            }], freeText: [{
                type: Input
            }], placeholder: [{
                type: Input
            }], ariaLabel: [{
                type: Input
            }], emptyText: [{
                type: Input
            }], loading: [{
                type: Input
            }], loadingText: [{
                type: Input
            }], maxRows: [{
                type: Input
            }], disabled: [{
                type: Input
            }], uppercase: [{
                type: Input
            }], picked: [{
                type: Output
            }], textChange: [{
                type: Output
            }], inputRef: [{
                type: ViewChild,
                args: ['input', { static: true }]
            }], onViewportChange: [{
                type: HostListener,
                args: ['window:resize']
            }], onDocumentMouseDown: [{
                type: HostListener,
                args: ['document:mousedown', ['$event']]
            }] } });

const DANA_UI_GEAR_COMPAT_FEATURES_STYLESHEET = '@dana/ui/styles/gear-compat-features.css';
const DANA_UI_GEAR_COMPAT_OVERRIDES_STYLESHEET = '@dana/ui/styles/gear-compat-overrides.css';
const DANA_UI_CORE_STYLESHEET = '@dana/ui/styles/dana-core.css';
const DANA_UI_GEAR_COMPAT_STYLESHEET = '@dana/ui/styles/gear-compat.css';
const DANA_UI_GLOBAL_STYLESHEET = '@dana/ui/styles/dana-ui.css';
const DANA_APPS_GLOBAL_STYLESHEET = DANA_UI_GLOBAL_STYLESHEET;
const GEAR_APPS_GLOBAL_STYLESHEET = DANA_UI_GLOBAL_STYLESHEET;

/**
 * Generated bundle index. Do not edit.
 */

export { DANA_APPS_GLOBAL_STYLESHEET, DANA_UI_CORE_STYLESHEET, DANA_UI_GEAR_COMPAT_FEATURES_STYLESHEET, DANA_UI_GEAR_COMPAT_OVERRIDES_STYLESHEET, DANA_UI_GEAR_COMPAT_STYLESHEET, DANA_UI_GLOBAL_STYLESHEET, DanaAlertDirective, DanaButtonDirective, DanaComboboxComponent, DanaConfirmDialogComponent, DanaCountBadgeDirective, DanaDashboardGridComponent, DanaDashboardPanelComponent, DanaDetailGridDirective, DanaDetailItemComponent, DanaEmptyStateDirective, DanaIconButtonDirective, DanaKpiCardDirective, DanaKpiGridDirective, DanaLoadingStateDirective, DanaMobileNavDirective, DanaOperationCardComponent, DanaOperationGridDirective, DanaPageHeaderComponent, DanaPanelActionDirective, DanaPanelHeaderDirective, DanaResponsiveGridDirective, DanaStackDirective, DanaStatusBadgeDirective, DanaSummaryCardDirective, DanaSummaryGridDirective, DanaTabDirective, DanaTableDirective, DanaTableEmptyDirective, DanaTableShellDirective, DanaTabsDirective, DanaToastHostComponent, DanaToastService, DanaToolbarDirective, GEAR_APPS_GLOBAL_STYLESHEET };
//# sourceMappingURL=dana-ui.mjs.map
