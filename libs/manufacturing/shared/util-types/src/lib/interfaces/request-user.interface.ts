import { AuthenticatedUser } from '@gearapps/shared/domain';
import { RoleType } from '../enums';

export interface IRequestUserData extends AuthenticatedUser {
  role: RoleType;
}
