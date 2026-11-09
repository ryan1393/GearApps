import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Auth, DepartmentAppEdit, ReqUserId } from '@libs/server/util-common';
import { RoleType, Uuid } from '@libs/shared/util-types';
import { cancelWorkflow, getWorkflowCancellation, ReversalApp } from '@libs/server/data-access';

class CancelWorkflowDto {
  @IsString() @MinLength(1) @MaxLength(200) identifier!: string;
  @IsUUID() operation_id!: string;
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}

@Controller({ path: 'workflow-cancellation', version: '1' })
export class WorkflowCancellationController {
  constructor(@InjectDataSource() private readonly source: DataSource) {}

  @Get('greenshed')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getGreenshed(@Query('identifier') identifier = '') {
    return getWorkflowCancellation(this.source, 'GREENSHED', identifier.trim().toUpperCase());
  }

  @Get('cutter-builder')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getCutter(@Query('identifier') identifier = '') {
    return getWorkflowCancellation(this.source, 'CUTTER_BUILDER', identifier.trim().toUpperCase());
  }

  @Get('blade-tracking')
  @Auth([RoleType.ADMIN, RoleType.USER])
  getTray(@Query('identifier') identifier = '') {
    return getWorkflowCancellation(this.source, 'BLADE_TRACKING', identifier.trim());
  }

  @Post('greenshed')
  @DepartmentAppEdit('GREENSHED')
  @Auth([RoleType.ADMIN, RoleType.USER])
  cancelGreenshed(@Body() dto: CancelWorkflowDto, @ReqUserId() user: Uuid) {
    return this.cancel('GREENSHED', dto, user);
  }

  @Post('cutter-builder')
  @DepartmentAppEdit('CUTTER_BUILDER')
  @Auth([RoleType.ADMIN, RoleType.USER])
  cancelBuild(@Body() dto: CancelWorkflowDto, @ReqUserId() user: Uuid) {
    return this.cancel('CUTTER_BUILDER', dto, user);
  }

  @Post('blade-tracking')
  @DepartmentAppEdit('BLADE_TRACKING')
  @Auth([RoleType.ADMIN, RoleType.USER])
  cancelTray(@Body() dto: CancelWorkflowDto, @ReqUserId() user: Uuid) {
    return this.cancel('BLADE_TRACKING', dto, user);
  }

  private cancel(app: ReversalApp, dto: CancelWorkflowDto, user: Uuid) {
    return cancelWorkflow(this.source, app, app === 'BLADE_TRACKING' ? dto.identifier.trim() : dto.identifier.trim().toUpperCase(), dto.operation_id, dto.reason, user);
  }
}
