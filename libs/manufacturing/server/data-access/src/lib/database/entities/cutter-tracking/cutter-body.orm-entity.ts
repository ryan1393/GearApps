import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AbstractOrmEntity } from '@gearapps/manufacturing/server/util-common';
import { ICutterBody } from '@gearapps/manufacturing/shared/util-types';
import { CutterBodyDefinitionOrmEntity } from './cutter-body-definition.orm-entity';
@Entity({ name: 'cutter_bodies' })
export class CutterBodyOrmEntity extends AbstractOrmEntity {
  /**
   * Dana cutter-body serial number. Null until the body is etched.
   * Once assigned, this becomes the normal scanned barcode.
   */
  @Index({ unique: true })
  @Column({ type: String, nullable: true })
  dana_serial_number!: string | null;
  /**
   * MF/manufacturer serial number.
   * Required for NEW cutter bodies, but nullable for imported historical
   * bodies where the true manufacturer serial was never recorded.
   */
  @Index({ unique: true })
  @Column({ type: String, nullable: true })
  mf_serial_number!: string | null;
  @Column({ type: String, nullable: true })
  definition_id!: string | null;

  @ManyToOne(() => CutterBodyDefinitionOrmEntity, { nullable: true })
  @JoinColumn({ name: 'definition_id' })
  definition!: CutterBodyDefinitionOrmEntity | null;

  @Column({ type: String, nullable: true }) description!: string | null;
  @Column({ type: Boolean, default: true }) enabled!: boolean;
  public override toJSON(): ICutterBody { return instanceToPlain(this) as ICutterBody; }
}
