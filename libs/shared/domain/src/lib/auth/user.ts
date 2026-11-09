import { BaseEntity } from '../common/entity';

export interface User extends BaseEntity {
  email: string;
  password: string;
  fname: string;
  lname: string;
}

export type CreateUser = Pick<User, 'email' | 'password' | 'fname' | 'lname'>;
export type UpdateUser = Partial<Omit<User, 'id'>>;
export type PublicUser = Omit<User, 'password'>;
