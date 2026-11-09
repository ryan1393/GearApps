import { Component } from '@angular/core';

/** Administration > Workflow: read-only summary of the three-step operator flow. */
@Component({
  selector: 'section[tlAdminWorkflowTab]',
  standalone: true,
  template: `
    <div class="dana-panel-header"><div><h2>Operator flow</h2><small>Truck Log's three steps</small></div></div>
    <ol class="dana-action-list">
      <li class="dana-action-row"><span class="dana-step-number">1</span><div class="dana-action-main"><strong>Guard check-in</strong><span>Driver and truck details, dock, paperwork and the dock slip.</span></div></li>
      <li class="dana-action-row"><span class="dana-step-number">2</span><div class="dana-action-main"><strong>Dock complete</strong><span>The dock marks service complete and sends the driver back.</span></div></li>
      <li class="dana-action-row"><span class="dana-step-number">3</span><div class="dana-action-main"><strong>Final guard checkout</strong><span>The guard closes the visit when the truck leaves.</span></div></li>
    </ol>
    <div class="dana-panel-body"><p class="dana-note">Database, ports and document storage paths are deployment settings and stay off the operator screens.</p></div>`,
})
export class AdminWorkflowTabComponent {}
