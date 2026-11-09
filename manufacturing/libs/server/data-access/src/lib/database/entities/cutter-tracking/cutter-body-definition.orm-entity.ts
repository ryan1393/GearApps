import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index } from 'typeorm';

import { AbstractOrmEntity } from '@libs/server/util-common';
import { ICutterBodyDefinition } from '@libs/shared/util-types';

@Entity({ name: 'cutter_body_definitions' })
export class CutterBodyDefinitionOrmEntity extends AbstractOrmEntity {
  @Index({ unique: true })
  @Column({ type: String })
  definition_code!: string;

  @Column({ type: String })
  cutter_head_code!: string;

  @Column({ type: String })
  supplier_code!: string;

  @Column({ type: String })
  supplier_name!: string;

  @Column({ type: String })
  hand_code!: string;

  @Column({ type: String })
  hand_name!: string;

  @Column({ type: String })
  blade_family_code!: string;

  @Column({ type: String })
  blade_family_name!: string;

  @Column({ type: String })
  size_code!: string;

  @Column({ type: String, nullable: true })
  size_description!: string | null;

  @Column({ type: Boolean, default: true })
  enabled!: boolean;

  public override toJSON(): ICutterBodyDefinition {
    return instanceToPlain(this) as ICutterBodyDefinition;
  }
}
