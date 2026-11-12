import { randomUUID } from 'node:crypto';
import {
  Body,
  CanActivate,
  ConflictException,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  RequestMethod,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { Auth, ReqUserId, SKIP_AUTH_KEY } from '@meshforge/manufacturing/server/util-common';
import { RoleType, Uuid } from '@meshforge/manufacturing/shared/util-types';

export function actionKey(controller: object, handler: { name: string }): string {
  return `${Reflect.getMetadata(PATH_METADATA, controller) ?? ''}:${handler.name}`;
}
export class SaveRoleDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  permissions!: string[];
  @IsBoolean() enabled!: boolean;
}
export class AssignRoleDto {
  @IsOptional() @IsUUID() role_id?: string | null;
}

@Injectable()
export class AccessManagementService {
  constructor(
    @InjectDataSource() private readonly source: DataSource,
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}
  catalog() {
    const scanner = new MetadataScanner();
    const actions: Array<{
      key: string;
      screen: string;
      action: string;
      method: string;
      path: string;
    }> = [];
    for (const wrapper of this.discovery.getControllers()) {
      const controller = wrapper.metatype;
      if (!controller?.prototype) continue;
      const screen = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
      if (!screen || ['auth', 'health', 'admin/access'].includes(screen)) continue;
      for (const name of scanner.getAllMethodNames(controller.prototype)) {
        const handler = controller.prototype[name];
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        if (this.reflector.getAllAndOverride(SKIP_AUTH_KEY, [handler, controller])) continue;
        const roles = this.reflector.getAllAndOverride<string[]>('roles', [handler, controller]);
        // Custom roles narrow existing non-admin privileges; admin-only actions stay admin-only.
        if (roles?.length && !roles.includes(RoleType.USER)) continue;
        actions.push({
          key: actionKey(controller, handler),
          screen,
          action: name.replace(/([a-z])([A-Z])/g, '$1 $2'),
          method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)],
          path: String(Reflect.getMetadata(PATH_METADATA, handler) ?? ''),
        });
      }
    }
    return [...new Map(actions.map((row) => [row.key, row])).values()].sort(
      (a, b) => a.screen.localeCompare(b.screen) || a.action.localeCompare(b.action),
    );
  }
  async list() {
    return this.source.query(
      `SELECT r.*, (SELECT count(*)::int FROM meshforge_user_roles u WHERE u.role_id=r.id) AS assigned_users FROM meshforge_roles r ORDER BY lower(name)`,
    );
  }
  async save(dto: SaveRoleDto, actor: Uuid, id: string = randomUUID()) {
    const name = dto.name.trim();
    if (!name) throw new ConflictException('Enter a role name.');
    const known = new Set(this.catalog().map((row) => row.key));
    if (dto.permissions.some((key) => !known.has(key)))
      throw new ConflictException(
        'Unknown or administrator-only permission. Reload the permission list.',
      );
    return this.source.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('meshforge-access-management'))`);
      const [before] = await manager.query('SELECT * FROM meshforge_roles WHERE id=$1 FOR UPDATE', [
        id,
      ]);
      const duplicates = await manager.query(
        'SELECT id FROM meshforge_roles WHERE lower(name)=lower($1) AND id<>$2',
        [name, id],
      );
      if (duplicates.length) throw new ConflictException('A role with this name already exists.');
      const [role] = await manager.query(
        `INSERT INTO meshforge_roles(id,name,permissions,enabled) VALUES($1,$2,$3::jsonb,$4)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, permissions=EXCLUDED.permissions,enabled=EXCLUDED.enabled,updated_at=now() RETURNING *`,
        [id, name, JSON.stringify(dto.permissions), dto.enabled],
      );
      await manager.query(
        `UPDATE users SET "authVersion"="authVersion"+1,"refreshToken"=NULL WHERE id IN (SELECT user_id FROM meshforge_user_roles WHERE role_id=$1)`,
        [id],
      );
      await this.audit(manager, actor, 'role.save', id, { before: before ?? null, after: role });
      return role;
    });
  }
  async assignments() {
    return this.source.query('SELECT user_id,role_id FROM meshforge_user_roles');
  }
  async assign(userId: Uuid, dto: AssignRoleDto, actor: Uuid) {
    return this.source.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('meshforge-access-management'))`);
      const [user] = await manager.query('SELECT id,role FROM users WHERE id=$1 FOR UPDATE', [
        userId,
      ]);
      if (!user || user.role === 'admin')
        throw new ConflictException(
          'Assign custom roles to non-admin accounts. Administrator safeguards remain separate.',
        );
      const [before] = await manager.query(
        'SELECT role_id FROM meshforge_user_roles WHERE user_id=$1',
        [userId],
      );
      if (dto.role_id) {
        const [role] = await manager.query(
          'SELECT id FROM meshforge_roles WHERE id=$1 AND enabled=true FOR SHARE',
          [dto.role_id],
        );
        if (!role) throw new ConflictException('Choose an enabled role.');
        await manager.query(
          'INSERT INTO meshforge_user_roles(user_id,role_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET role_id=EXCLUDED.role_id',
          [userId, dto.role_id],
        );
      } else await manager.query('DELETE FROM meshforge_user_roles WHERE user_id=$1', [userId]);
      await manager.query(
        'UPDATE users SET "authVersion"="authVersion"+1,"refreshToken"=NULL WHERE id=$1',
        [userId],
      );
      await this.audit(manager, actor, 'role.assign', userId, {
        before: before?.role_id ?? null,
        after: dto.role_id ?? null,
      });
      return { saved: true };
    });
  }
  async audit(
    manager: EntityManager,
    actor: Uuid,
    action: string,
    target: string,
    detail: unknown,
  ) {
    await manager.query(
      'INSERT INTO meshforge_access_audit(id,actor_id,action,target_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)',
      [randomUUID(), actor, action, target, JSON.stringify(detail)],
    );
  }
}

/** Runs after the JWT guard. Read current grants on every request; old tokens cannot retain removed access. */
@Injectable()
export class CustomRoleGuard implements CanActivate {
  constructor(
    @InjectDataSource() private readonly source: DataSource,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride(SKIP_AUTH_KEY, [context.getHandler(), context.getClass()]))
      return true;
    const request = context.switchToHttp().getRequest();
    if (!request.user || request.user.role === 'admin') return true;
    const path = Reflect.getMetadata(PATH_METADATA, context.getClass());
    if (path === 'auth' || path === 'health') return true;
    const [assigned] = await this.source.query(
      `SELECT r.permissions,r.enabled FROM meshforge_user_roles u JOIN meshforge_roles r ON r.id=u.role_id WHERE u.user_id=$1`,
      [request.user.id],
    );
    if (!assigned) return true;
    if (
      !assigned.enabled ||
      !assigned.permissions.includes(actionKey(context.getClass(), context.getHandler()))
    ) {
      throw new ForbiddenException(
        'Your assigned role does not allow this action. Contact an administrator.',
      );
    }
    return true;
  }
}

@Controller({ path: 'admin/access', version: '1' })
export class AccessManagementController {
  constructor(private readonly service: AccessManagementService) {}
  @Get('catalog') @Auth([RoleType.ADMIN]) catalog() {
    return this.service.catalog();
  }
  @Get('roles') @Auth([RoleType.ADMIN]) list() {
    return this.service.list();
  }
  @Post('roles') @Auth([RoleType.ADMIN]) create(
    @Body() dto: SaveRoleDto,
    @ReqUserId() actor: Uuid,
  ) {
    return this.service.save(dto, actor);
  }
  @Patch('roles/:id') @Auth([RoleType.ADMIN]) update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveRoleDto,
    @ReqUserId() actor: Uuid,
  ) {
    return this.service.save(dto, actor, id);
  }
  @Get('assignments') @Auth([RoleType.ADMIN]) assignments() {
    return this.service.assignments();
  }
  @Put('users/:id/role') @Auth([RoleType.ADMIN]) assign(
    @Param('id', ParseUUIDPipe) id: Uuid,
    @Body() dto: AssignRoleDto,
    @ReqUserId() actor: Uuid,
  ) {
    return this.service.assign(id, dto, actor);
  }
}
