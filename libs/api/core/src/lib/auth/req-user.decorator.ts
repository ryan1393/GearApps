import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface RequestUser {
  userId: string;
  email: string;
  fname?: string;
  lname?: string;
  role?: string;
}

/** Injects the authenticated user (from the validated JWT) into a handler parameter. */
export const ReqUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);

/** Shortcut for just the user id. */
export const ReqUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest().user?.userId;
});
