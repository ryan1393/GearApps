import { Component, ViewEncapsulation, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { DanaTabDirective, DanaTabsDirective } from '@dana/ui';
import { CoaterShipmentsComponent } from '../coater-shipments/coater-shipments.component';
import { GrindingComponent } from '../grinding/grinding.component';
import { IntakeComponent } from '../intake/intake.component';
import { InternalMovementComponent } from '../internal-movement/internal-movement.component';
import { LoadContainerComponent } from '../load-container/load-container.component';
import { ReceiveContainerComponent } from '../receive-container/receive-container.component';
import { BLADE_OPERATIONS, BladeOperationKey, isBladeOperation } from './operations-station.operations';

const LAST_OPERATION_KEY = 'meshforge.blade-tracking.operations-station';

/**
 * One touchscreen workstation for every blade operation. The tabs replace the separate
 * operation pages, and the work area is sized to the viewport so the page itself never scrolls.
 */
@Component({
  selector: 'gear-blade-operations-station',
  standalone: true,
  imports: [
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
  styleUrls: ['./operations-station.component.css'],
  // The station restyles the embedded operation pages, so its rules cannot be view-encapsulated.
  // Every rule is scoped under .ops-station.
  encapsulation: ViewEncapsulation.None,
  // Default change detection on purpose: the embedded operation pages update plain fields from
  // HTTP callbacks, and an OnPush host would stop those views from refreshing.
})
export class OperationsStationComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly operations = BLADE_OPERATIONS;
  private readonly requested = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('op'))), {
    initialValue: this.route.snapshot.queryParamMap.get('op'),
  });

  readonly active = computed<BladeOperationKey>(() => {
    const requested = this.requested();
    return isBladeOperation(requested) ? requested : (lastOperation() ?? 'intake');
  });

  constructor() {
    effect(() => remember(this.active()));
  }

  select(key: BladeOperationKey): void {
    if (key === this.active()) return;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { op: key }, replaceUrl: true });
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
