import { AfterViewChecked, Component, ElementRef, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, finalize, timeout } from 'rxjs';
import type { TvBoardSnapshot, TvVisitRecord } from '@truck-log/shared/contracts';
import { TV_ROTATION_DEFAULT, tvRotationSeconds, tvRotationKey, tvAge, TvAge, TvAgePart } from './tv-display.preferences';
import { readTvSnapshot, tvBoard, tvElapsed, tvPages, tvPhase, tvUrgency, TvBoardView, TvDockTile } from './tv-display.model';

/** Rotation resumes on its own after this long without an edit in the rotation box. */
const ROTATION_EDIT_IDLE_MS = 60_000;
/** How often the per-page counts go back to the screen's full capacity before refitting. */
const CAPACITY_RESET_MS = 10 * 60_000;
/** A snapshot this much older than the last one means the server clock was reset, not a replay. */
const CLOCK_RESET_MS = 60_000;

@Component({
  selector: 'tl-tv-display', standalone: true, imports: [CommonModule, RouterLink],
  templateUrl: './tv-display.component.html',
})
export class TvDisplayComponent implements OnInit, OnDestroy, AfterViewChecked {
  management = false;
  snapshot: TvBoardSnapshot | null = null;
  view: TvBoardView | null = null;
  now = Date.now();
  cycle = 0;
  paused = false;
  refreshError = '';
  fullscreenMessage = '';
  rotationSeconds = TV_ROTATION_DEFAULT;
  rotationInput = String(TV_ROTATION_DEFAULT);
  rotationMessage = '';
  rotationError = '';
  rotationEditing = false;
  ageSeconds = 0;
  tileCapacity = 6;
  rowCapacity = 8;
  waitingCapacity = 3;
  summaryCapacity = 8;
  private request?: Subscription;
  private subscriptions = new Subscription();
  private pollTimer?: number;
  private tickTimer?: number;
  private destroyed = false;
  private inFlight = false;
  private receivedMonotonic = 0;
  private serverTime = 0;
  private nextRotation = 0;
  private requestId = 0;
  private fitFrame?: number;
  private fitKey = '';
  private capacityMeasuredAt = 0;
  private rotationEditedAt = 0;
  constructor(private readonly http: HttpClient, private readonly route: ActivatedRoute, private readonly element: ElementRef<HTMLElement>) {}
  ngOnInit(): void {
    this.measure();
    this.subscriptions.add(this.route.data.subscribe(data => {
      this.management = data['tvAudience'] === 'management'; this.cycle = 0;
      this.readRotation();
    }));
    this.tickTimer = window.setInterval(() => this.tick(), 1000);
    this.refresh();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.pollTimer !== undefined) window.clearTimeout(this.pollTimer);
    if (this.tickTimer !== undefined) window.clearInterval(this.tickTimer);
    if (this.fitFrame !== undefined) window.cancelAnimationFrame(this.fitFrame);
    this.request?.unsubscribe();
    this.subscriptions.unsubscribe();
  }
  @HostListener('window:resize') measure(): void {
    this.capacityMeasuredAt = performance.now();
    const w = window.innerWidth, h = window.innerHeight;
    this.tileCapacity = w < 700 ? 1 : w < 1400 ? (h < 900 ? 2 : 4) : (h < 820 ? 3 : 6);
    this.rowCapacity = w < 700 ? 1 : Math.max(2, Math.min(12, Math.floor((h - (w < 1150 ? 470 : 385)) / 88)));
    this.waitingCapacity = w < 700 ? 1 : w < 1200 ? 2 : 3;
    this.summaryCapacity = w < 1150 ? (w < 700 ? 2 : 4) : Math.max(2, Math.min(10, Math.floor((h - 395) / 82)));
  }
  get dockColumns(): number { return Math.min(this.tileCapacity, window.innerWidth < 700 ? 1 : window.innerWidth < 1400 ? 2 : 3); }
  ngAfterViewChecked(): void {
    if (this.destroyed || !this.snapshot) return;
    const key = [this.management, this.cycle, this.snapshot.generatedAt, window.innerWidth, window.innerHeight,
      this.tileCapacity, this.rowCapacity, this.waitingCapacity, this.summaryCapacity,
      this.rotationMessage, this.rotationError, this.fullscreenMessage].join('|');
    if (key === this.fitKey || this.fitFrame !== undefined) return;
    this.fitKey = key;
    this.fitFrame = window.requestAnimationFrame(() => {
      this.fitFrame = undefined;
      if (!this.destroyed) this.fitToVisibleArea();
    });
  }
  private fitToVisibleArea(): void {
    const root = this.element.nativeElement;
    const overflows = (selector: string): boolean => Array.from(root.querySelectorAll<HTMLElement>(selector))
      .some(el => el.scrollHeight > el.clientHeight + 3 || el.scrollWidth > el.clientWidth + 3);
    if (this.management) {
      if (overflows('.tl-tv-visit-panel') && this.rowCapacity > 1) this.rowCapacity--;
      if (overflows('.tl-tv-summary-panel') && this.summaryCapacity > 1) this.summaryCapacity--;
    } else {
      if (overflows('.tl-tv-dock-card') && this.tileCapacity > 1) this.tileCapacity = Math.max(1, this.tileCapacity - this.dockColumns);
      if (overflows('.tl-tv-wait-panel') && this.waitingCapacity > 1) this.waitingCapacity--;
    }
  }
  tick(): void {
    const mono = performance.now();
    if (this.snapshot) {
      this.ageSeconds = Math.max(0, Math.floor((mono - this.receivedMonotonic) / 1000));
      this.now = this.serverTime + Math.max(0, mono - this.receivedMonotonic);
    }
    // An unattended TV must not stay paused because someone clicked the rotation box and walked away.
    if (this.rotationEditing && mono - this.rotationEditedAt > ROTATION_EDIT_IDLE_MS) {
      this.rotationEditing = false; this.rotationInput = String(this.rotationSeconds); this.rotationError = '';
      this.nextRotation = mono + this.rotationSeconds * 1000;
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    if (!this.paused && !this.rotationEditing && mono >= this.nextRotation) { this.cycle++; this.nextRotation = mono + this.rotationSeconds * 1000; }
  }
  refresh(): void {
    if (this.destroyed || this.inFlight) return;
    if (this.pollTimer !== undefined) window.clearTimeout(this.pollTimer);
    this.inFlight = true;
    this.request = this.http.get<unknown>('/api/v1/tv/board', {params: {tvRefresh: String(++this.requestId)}}).pipe(
      timeout(8000), finalize(() => {
        this.inFlight = false;
        if (!this.destroyed) this.pollTimer = window.setTimeout(() => this.refresh(), 10000);
      }),
    ).subscribe({
      next: raw => {
        if (this.destroyed) return;
        try {
          const next = readTvSnapshot(raw), time = Date.parse(next.generatedAt);
          // Same-or-older answers are replays (a cache) and are refused, except a clearly older clock:
          // after the database clock is corrected backwards, the TV must not stay "stale" for hours.
          if (this.snapshot && time <= this.serverTime && this.serverTime - time < CLOCK_RESET_MS) throw new Error('No newer server snapshot.');
          // fitToVisibleArea only ever lowers the per-page counts; start again from the screen's
          // full capacity now and then so one busy hour cannot leave a TV at 1 card per page for days.
          if (performance.now() - this.capacityMeasuredAt > CAPACITY_RESET_MS) this.measure();
          this.snapshot = next; this.view = tvBoard(next);
          this.serverTime = time; this.receivedMonotonic = performance.now(); this.now = time;
          this.ageSeconds = 0; this.refreshError = '';
        } catch { this.refreshError = 'Refresh could not be verified. Last successful data is retained.'; }
      },
      error: () => { if (!this.destroyed) this.refreshError = 'Connection unavailable. Showing last successful data; retrying automatically.'; },
    });
  }
  get stale(): boolean { return !!this.refreshError || (!!this.snapshot && this.ageSeconds >= 30); }
  get tilePages(): TvDockTile[][] { return tvPages(this.view?.tiles || [], this.tileCapacity); }
  get rowPages(): TvVisitRecord[][] { return tvPages(this.view?.visits || [], this.rowCapacity); }
  get waitPages(): TvVisitRecord[][] { return tvPages(this.view?.waiting || [], this.waitingCapacity); }
  get summaryPages(): TvDockTile[][] {
    // one entry per occupied dock; detailed truck cards retain ALL occupants.
    const seen = new Set<string>();
    return tvPages((this.view?.tiles || []).filter(t => {
      const key = t.dock.id ? 'configured:' + t.dock.id : 'unlisted:' + (t.visit?.dockCode ?? t.dock.code);
      if (seen.has(key)) return false; seen.add(key); return true;
    }), this.summaryCapacity);
  }
  get tiles(): TvDockTile[] { const pages = this.tilePages; return pages[this.cycle % pages.length]; }
  get rows(): TvVisitRecord[] { const pages = this.rowPages; return pages[this.cycle % pages.length]; }
  get waiting(): TvVisitRecord[] { const pages = this.waitPages; return pages[this.cycle % pages.length]; }
  get dockSummary(): TvDockTile[] { const pages = this.summaryPages; return pages[this.cycle % pages.length]; }
  pageNumber(pages: unknown[][]): number { return this.cycle % pages.length + 1; }
  step(delta: number): void { this.cycle = Math.max(0, this.cycle + delta); this.nextRotation = performance.now() + this.rotationSeconds * 1000; }
  togglePause(): void { this.paused = !this.paused; this.nextRotation = performance.now() + this.rotationSeconds * 1000; }
  elapsed(value: string | null): string { return tvElapsed(value, this.now); }
  age(value: string | null): TvAge { return tvAge(value, this.now); }
  trackAgePart(_i: number, part: TvAgePart): string { return part.unit; }
  private readRotation(): void {
    let saved: number | null = null;
    this.rotationMessage = ''; this.rotationError = ''; this.rotationEditing = false;
    try { saved = tvRotationSeconds(window.localStorage.getItem(tvRotationKey(this.management))); }
    catch { this.rotationMessage = 'Browser storage unavailable; rotation can still be changed for this session.'; }
    const query = tvRotationSeconds(this.route.snapshot.queryParamMap.get('rotate'));
    this.rotationSeconds = query ?? saved ?? TV_ROTATION_DEFAULT;
    this.rotationInput = String(this.rotationSeconds);
    this.nextRotation = performance.now() + this.rotationSeconds * 1000;
  }
  editRotation(value: string): void {
    if (this.destroyed) return;
    this.rotationInput = value; this.rotationEditing = true; this.rotationEditedAt = performance.now(); this.rotationError = ''; this.rotationMessage = '';
  }
  focusRotation(): void { this.rotationEditing = true; this.rotationEditedAt = performance.now(); }
  blurRotation(): void {
    this.rotationEditing = false;
    this.nextRotation = performance.now() + this.rotationSeconds * 1000;
  }
  applyRotation(event?: Event): void {
    event?.preventDefault();
    if (this.destroyed) return;
    const seconds = tvRotationSeconds(this.rotationInput);
    this.rotationMessage = ''; this.rotationError = '';
    if (seconds === null) {
      this.rotationError = 'Enter a whole number from 10 to 120 seconds.';
      return;
    }
    this.rotationSeconds = seconds; this.rotationInput = String(seconds); this.rotationEditing = false;
    this.nextRotation = performance.now() + seconds * 1000;
    let persisted = false, linkUpdated = true;
    try {
      const key = tvRotationKey(this.management);
      window.localStorage.setItem(key, String(seconds));
      persisted = window.localStorage.getItem(key) === String(seconds);
    } catch { /* A blocked preference must never stop live data. */ }
    try {
      // Preserve the existing ?rotate= link behavior. Update an old override on Apply
      // so a reload cannot silently revert the just-selected interval.
      const url = new URL(window.location.href);
      if (url.searchParams.has('rotate')) {
        url.searchParams.set('rotate', String(seconds));
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      }
    } catch { linkUpdated = false; }
    this.rotationMessage = persisted
      ? 'Saved for this ' + (this.management ? 'Management' : 'Dockworker') + ' TV browser.'
      : 'Applied for this session only; browser storage could not be saved.';
    if (!linkUpdated) this.rotationMessage += ' The current link could not be updated; its rotate value may override this setting after reload.';
  }
  urgency(v: TvVisitRecord): string { return this.snapshot ? tvUrgency(v, this.snapshot, this.now) : ''; }
  phase(v: TvVisitRecord): string { return tvPhase(v); }
  /** Dana wall tone for aging (warning) and overdue (danger) visits. */
  urgencyTone(v: TvVisitRecord): 'warning' | 'danger' | null {
    const u = this.urgency(v);
    return u === 'overdue' ? 'danger' : u === 'aging' ? 'warning' : null;
  }
  phaseLabel(v: TvVisitRecord): string {
    return tvPhase(v) === 'dock' ? 'At / sent to dock' : tvPhase(v) === 'checkout' ? 'Awaiting guard checkout' : 'Status needs review';
  }
  time(value: string | number | null): string {
    if (value === null) return '—';
    return new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}).format(new Date(value));
  }
  trackVisit(_i: number, v: TvVisitRecord): number { return v.id; }
  trackTile(_i: number, t: TvDockTile): string { return t.key; }
  async fullscreen(): Promise<void> {
    this.fullscreenMessage = '';
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else this.fullscreenMessage = 'Use the browser full-screen option (F11 on Windows).';
    } catch { this.fullscreenMessage = 'Use the browser full-screen option (F11 on Windows).'; }
  }
}
