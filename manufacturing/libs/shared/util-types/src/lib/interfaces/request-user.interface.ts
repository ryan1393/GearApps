import { RoleType } from '../enums';

/**
 * Interface representing the `req.user` object created by Passport
 * when validating JWTs. Should only be needed by the backend.
 */
export interface IRequestUserData {
  /**
   * User UUID
   */
  id: string;

  email: string;

  role: RoleType;

  departmentId: string | null;

  departmentCode: string | null;

  departmentDescription: string | null;
}
