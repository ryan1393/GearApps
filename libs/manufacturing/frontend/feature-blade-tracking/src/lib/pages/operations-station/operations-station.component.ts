import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { canUseMeshForgeAction } from '@meshforge/manufacturing/shared/util-constants';
import { Component, ElementRef, ViewChild, ViewEncapsulation, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { DanaTabDirective, DanaTabsDirective } from '@dana/ui';
import { CoaterShipmentsComponent } from '../coater-shipments/coater-shipments.component';
import { GrindingComponent } from '../grinding/grinding.component';
import { IntakeComponent } from '../intake/intake.component';
import { InternalMovementComponent } from '../internal-movement/internal-movement.component';
import { LoadContainerComponent } from '../load-container/load-container.component';
import { ReceiveContainerComponent } from '../receive-container/receive-container.component';
import { BLADE_OPERATIONS, BladeOperationKey, StationOperation, isBladeOperation } from './operations-station.operations';
import { focusExpectedScan } from '@meshforge/manufacturing/frontend/util-common';

const LAST_OPERATION_KEY = 'meshforge.blade-tracking.operations-station';
const HIDDEN_TABS_KEY = 'meshforge.blade-tracking.operations-station.hidden-tabs';

/**
 * One touchscreen workstation for every blade operation. The tabs replace the separate
 * operation pages, and the work area is sized to the viewport so the page itself never scrolls.
 *
 * An operation is created the first time its tab opens and then kept alive while other tabs are
 * used, so a half-loaded container or a tray waiting for its shelf is still there on return.
 */
@Component({
  selector: 'gear-blade-operations-station',
  standalone: true,
  imports: [
    RouterLink,
    DanaTabsDirective,
    DanaTabDirective,
    IntakeComponent,
    GrindingComponent,
    LoadContainerComponent,
    CoaterShipmentsComponent,
    ReceiveContainerComponent,
    InternalMovementComponent,
  ],
  templateUrl: './operations-station.component.html',
  styleUrls: ['./operations-station.component.css', './operations-station-pages.css'],
  // The station lays out the embedded operation pages, so its rules cannot be view-encapsulated.
  // Every rule is scoped under .ops-station.
  encapsulation: ViewEncapsulation.None,
  // Default change detection on purpose: the embedded operation pages update plain fields from
  // HTTP callbacks, and an OnPush host would stop those views from refreshing.
})
export class OperationsStationComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host: ElementRef<HTMLElement> | null = inject(ElementRef, { optional: true });

  @ViewChild(IntakeComponent) private intake?: StationOperation;
  @ViewChild(GrindingComponent) private grinding?: StationOperation;
  @ViewChild(LoadContainerComponent) private loadContainer?: StationOperation;
  @ViewChild(CoaterShipmentsComponent) private coaterShipments?: StationOperation;
  @ViewChild(ReceiveContainerComponent) private receiveContainer?: StationOperation;
  @ViewChild(InternalMovementComponent) private internalMovement?: StationOperation;

  private readonly session = inject(AuthSessionService);
  private readonly identity = toSignal(this.session.authState$, { initialValue: this.session.currentUser });
  readonly operations = BLADE_OPERATIONS;
  allowed(key: BladeOperationKey): boolean {
    const actions: Record<BladeOperationKey, readonly string[]> = {
      intake: ['bladeTrays:createBladeBatch'], grinding: ['trays:startGrinding', 'trays:completeGrinding'],
      'load-container': ['containerTrays:createContainerTray'],
      'coater-shipments': ['create', 'update', 'add', 'remove', 'review', 'print', 'prepareRpa', 'emailRpa', 'dispatch', 'labels', 'cancel'].map(action => 'coater-shipments:' + action),
      'receive-container': ['containerTrays:unloadTrayFromContainer'], 'internal-movement': ['locationTrays:createLocationTray'],
    };
    return actions[key].some(action => canUseMeshForgeAction(this.identity(), action));
  }
  private readonly requested = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('op'))), {
    initialValue: this.route.snapshot.queryParamMap.get('op'),
  });

  /** `?tray=` from another app (e.g. Cutter Builder's Waiting For Grinding list): the tray to open on Grinding. */
  readonly requestedTray = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('tray'))), {
    initialValue: this.route.snapshot.queryParamMap.get('tray'),
  });

  readonly active = computed<BladeOperationKey>(() => {
    const requested = this.requested();
    const preferred = isBladeOperation(requested) ? requested : (lastOperation() ?? 'intake');
    return this.allowed(preferred) ? preferred : (BLADE_OPERATIONS.find(row => this.allowed(row.key))?.key ?? 'intake');
  });
  readonly activeOperation = computed(() => BLADE_OPERATIONS.find((operation) => operation.key === this.active()) ?? BLADE_OPERATIONS[0]);

  /** Operations opened at least once; they stay alive until the station is left. */
  readonly visited = signal<ReadonlySet<BladeOperationKey>>(new Set());
  /** Tabs this workstation has chosen not to show. The open operation is always shown. */
  readonly hidden = signal<ReadonlySet<BladeOperationKey>>(storedHiddenTabs());
  readonly shownOperations = computed(() => BLADE_OPERATIONS.filter((operation) => this.allowed(operation.key) && (!this.hidden().has(operation.key) || operation.key === this.active())));
  settingsOpen = false;

  constructor() {
    effect(() => {
      const key = this.active();
      if (!this.allowed(key)) return;
      remember(key);
      untracked(() => this.open(key));
    });
  }

  select(key: BladeOperationKey): void {
    if (key === this.active()) {
      this.focusExpectedScan(key);
      return;
    }
    void this.router.navigate([], { relativeTo: this.route, queryParams: { op: key }, replaceUrl: true });
  }

  /** A tab shows a marker while its operation has work under way, so the operator knows to come back to it. */
  inProgress(key: BladeOperationKey): boolean {
    return this.operation(key)?.inProgress ?? false;
  }

  toggleTab(key: BladeOperationKey): void {
    const hidden = new Set(this.hidden());
    if (hidden.has(key)) hidden.delete(key);
    else if (BLADE_OPERATIONS.length - hidden.size > 1) hidden.add(key);
    this.hidden.set(hidden);
    storeHiddenTabs(hidden);
  }

  /** The last shown tab cannot be hidden: the station always offers at least one operation. */
  isOnlyShownTab(key: BladeOperationKey): boolean {
    return !this.hidden().has(key) && BLADE_OPERATIONS.length - this.hidden().size === 1;
  }

  private open(key: BladeOperationKey): void {
    const reopened = this.visited().has(key);
    if (!reopened) this.visited.set(new Set([...this.visited(), key]));
    // After the panel has rendered (or been unhidden) and its scan boxes have settled.
    setTimeout(() => {
      if (key !== this.active()) return;
      if (reopened) this.operation(key)?.stationActivated();
      this.focusExpectedScan(key);
    });
  }

  private operation(key: BladeOperationKey): StationOperation | undefined {
    switch (key) {
      case 'intake': return this.intake;
      case 'grinding': return this.grinding;
      case 'load-container': return this.loadContainer;
      case 'coater-shipments': return this.coaterShipments;
      case 'receive-container': return this.receiveContainer;
      case 'internal-movement': return this.internalMovement;
    }
  }

  /** After a tab is tapped the cursor would stay on the tab and the next scan would be lost. */
  private focusExpectedScan(key: BladeOperationKey): void {
    focusExpectedScan(this.host?.nativeElement.querySelector<HTMLElement>(`[data-operation-panel="${key}"]`));
  }
}

/** A workstation usually runs one operation, so it reopens on the last one used there. */
function lastOperation(): BladeOperationKey | null {
  try {
    const stored = localStorage.getItem(LAST_OPERATION_KEY);
    return isBladeOperation(stored) ? stored : null;
  } catch {
    return null;
  }
}

function remember(key: BladeOperationKey): void {
  try {
    localStorage.setItem(LAST_OPERATION_KEY, key);
  } catch {
    // Storage may be blocked; the station still works, it just opens on Blade Intake.
  }
}

function storedHiddenTabs(): ReadonlySet<BladeOperationKey> {
  try {
    const keys = (localStorage.getItem(HIDDEN_TABS_KEY) ?? '').split(',').filter(isBladeOperation);
    return new Set(keys.length < BLADE_OPERATIONS.length ? keys : []);
  } catch {
    return new Set();
  }
}

function storeHiddenTabs(hidden: ReadonlySet<BladeOperationKey>): void {
  try {
    localStorage.setItem(HIDDEN_TABS_KEY, [...hidden].join(','));
  } catch {
    // Storage may be blocked; the choice then lasts until the page reloads.
  }
}
