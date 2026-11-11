import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GreenshedApiService, GreenshedDashboard, greenshedApiErrorText } from '@meshforge/manufacturing/frontend/data-access-greenshed';

import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { canEditMeshForgeApp } from '@meshforge/manufacturing/shared/util-constants';
import {
  DanaCountBadgeDirective,
  DanaDashboardPanelComponent,
  DanaKpiCardDirective,
  DanaKpiGridDirective,
  DanaOperationCardComponent,
  DanaOperationGridDirective,
  DanaPageHeaderComponent,
  DanaPanelActionDirective,
  DanaPanelHeaderDirective,
  DanaStatusBadgeDirective,
  DanaTableDirective,
  DanaTableEmptyDirective,
  DanaTableShellDirective,
  DanaToneDirective,
} from '@dana/ui';
@Component({
  selector:'gear-greenshed-dashboard', standalone:true,
  imports: [DanaToneDirective, 
    CommonModule,
    RouterLink,
    DanaKpiGridDirective,
    DanaKpiCardDirective,
    DanaPanelHeaderDirective,
    DanaPanelActionDirective,
    DanaTableShellDirective,
    DanaTableDirective,
    DanaCountBadgeDirective,
    DanaStatusBadgeDirective,
    DanaTableEmptyDirective,
    DanaPageHeaderComponent,
    DanaOperationCardComponent,
    DanaOperationGridDirective,
    DanaDashboardPanelComponent
  ],
  templateUrl:'./greenshed-dashboard.component.html'
})
export class GreenshedDashboardComponent implements OnInit {
  private readonly session = inject(AuthSessionService);
  private readonly api=inject(GreenshedApiService);
  data:GreenshedDashboard|null=null; loading=true; error='';
  get canEdit(): boolean {
    const user = this.session.currentUser;
    return canEditMeshForgeApp(
      'GREENSHED',
      user?.role,
      user?.departmentCode,
    );
  }

  ngOnInit(){this.refresh();}
  refresh(){this.loading=true;this.error='';this.api.getDashboard().subscribe({
    next:d=>{this.data=d;this.loading=false;},
    error:(e:HttpErrorResponse)=>{this.loading=false;this.error=greenshedApiErrorText(e,'Could not load Greenshed dashboard.');}
  });}
}
