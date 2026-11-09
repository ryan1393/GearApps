import {
  canEditGearApp,
  GearAppKey,
  GEAR_APP_EDITOR_DEPARTMENT_NAMES,
} from '@libs/shared/util-constants';
import { IRequestUserData } from '@libs/shared/util-types';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  GEAR_APP_EDIT_METADATA_KEY,
  ROLES_REQUEST_KEY,
  SKIP_AUTH_KEY,
} from '../constants';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_REQUEST_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const skipAuth = this.reflector.getAllAndOverride<boolean>(SKIP_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipAuth) return true;

    const user = context.switchToHttp().getRequest().user as
      | IRequestUserData
      | undefined;

    if (roles?.length) {
      if (!user || !roles.includes(user.role)) {
        throw new ForbiddenException(
          'Your account does not have permission to perform this action',
        );
      }
    }

    const app = this.reflector.getAllAndOverride<GearAppKey>(
      GEAR_APP_EDIT_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (app && user && !canEditGearApp(app, user.role, user.departmentCode)) {
      const department =
        user.departmentDescription ||
        user.departmentCode ||
        'No department assigned';

      throw new ForbiddenException(
        `View-only access: ${department} cannot perform transactions in ${app.replace(/_/g, ' ')}. ` +
          `Editing is limited to ${GEAR_APP_EDITOR_DEPARTMENT_NAMES[app]}.`,
      );
    }

    return true;
  }
}
