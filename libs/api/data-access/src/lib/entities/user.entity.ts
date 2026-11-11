import { User } from '@meshforge/shared/domain';
import { EntitySchema } from 'typeorm';
import { str, uuidPrimary } from './column-helpers';

export const UserEntity = new EntitySchema<User>({
  name: 'Users',
  columns: {
    id: uuidPrimary,
    email: { type: String, nullable: false, unique: true },
    password: str(),
    fname: str(true),
    lname: str(true),
  },
});
