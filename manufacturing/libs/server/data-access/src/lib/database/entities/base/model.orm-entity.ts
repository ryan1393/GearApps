import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index } from 'typeorm';

import { AbstractOrmEntity } from '@libs/server/util-common';
import { IModel } from '@libs/shared/util-types';

@Entity({ name: 'models' })
@Index(['model_number', 'model_type'], { unique: true })
export class ModelOrmEntity extends AbstractOrmEntity {
  @Column({ type: Number, nullable: true })
  model_number!: number | null;

  @Column({ type: String, nullable: true })
  model_type!: string | null;

  @Index()
  @Column({ type: Boolean, default: true })
  active!: boolean;

  @Column({ type: Boolean, default: true })
  enabled!: boolean;

  public override toJSON(): IModel {
    return instanceToPlain(this) as IModel;
  }
}
