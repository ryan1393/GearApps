import { RoleType } from '../enums';

export interface IJwtPayload {
  /**
   * User UUID
   */
  sub: string;

  email: string;

  role: RoleType;

  /** Null/absent preserves legacy access; an empty list denies custom-role actions. */
  permissions?: string[] | null;

  departmentId: string | null;

  departmentCode: string | null;

  departmentDescription: string | null;

  iat: string;

  exp: number;
}
