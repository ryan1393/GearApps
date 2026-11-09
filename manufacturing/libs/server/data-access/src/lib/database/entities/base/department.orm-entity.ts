import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index } from 'typeorm';

import { AbstractOrmEntity } from '@gearapps/manufacturing/server/util-common';
import { IDepartment } from '@gearapps/manufacturing/shared/util-types';

@Entity({ name: 'departments' })
export class DepartmentOrmEntity extends AbstractOrmEntity {
  @Index({ unique: true })
  @Column({ type: String })
  code!: string;

  @Column({ type: String })
  description!: string;

  @Index()
  @Column({ type: Boolean, default: true })
  active!: boolean;

  @Column({ type: Boolean, default: true })
  enabled!: boolean;

  public override toJSON(): IDepartment {
    return instanceToPlain(this) as IDepartment;
  }
}
