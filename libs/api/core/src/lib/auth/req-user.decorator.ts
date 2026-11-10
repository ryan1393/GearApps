import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '@gearapps/shared/domain';

export type RequestUser = AuthenticatedUser;

/** Injects the authenticated user (from the validated JWT) into a handler parameter. */
export const ReqUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);

/** Shortcut for just the user id. */
export const ReqUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest().user?.id;
});
