import { AuthenticatedUser } from '@meshforge/shared/domain';
import { RoleType } from '../enums';

export interface IRequestUserData extends AuthenticatedUser {
  role: RoleType;
}
