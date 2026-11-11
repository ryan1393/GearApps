import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index } from 'typeorm';

import { AbstractOrmEntity } from '@meshforge/manufacturing/server/util-common';
import { IModel } from '@meshforge/manufacturing/shared/util-types';

@Entity({ name: 'models' })
@Index(['model_number', 'model_type'], { unique: true })
export class ModelOrmEntity extends AbstractOrmEntity {
  /** Text, so a model can be numbered like "S-110" or "9¼" as well as "174". */
  @Column({ type: String, nullable: true })
  model_number!: string | null;

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
