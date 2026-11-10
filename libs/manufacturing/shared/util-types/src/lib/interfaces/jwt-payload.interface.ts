import { RoleType } from '../enums';

export interface IJwtPayload {
  /**
   * User UUID
   */
  sub: string;

  email: string;

  role: RoleType;

  departmentId: string | null;

  departmentCode: string | null;

  departmentDescription: string | null;

  iat: string;

  exp: number;
}
