import { instanceToPlain } from 'class-transformer';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractOrmEntity } from '@meshforge/manufacturing/server/util-common';
import {
  ILocation,
  ILocationEntity,
} from '@meshforge/manufacturing/shared/util-types';
import { LocationDto, LocationDtoOptions } from '../../../dtos/blade-tracking/locations/location.dto';
import { UserOrmEntity } from '../user.orm-entity';
import { PartSummaryOrmEntity } from '../base/part-summary.orm-entity';
import { CutterPartTypeOrmEntity } from '../cutter-tracking/cutter-part-type.orm-entity';


@Entity({ name: 'locations' })
// @UseDto(LocationDto)
export class LocationOrmEntity
  extends AbstractOrmEntity<LocationDto, LocationDtoOptions>
  implements ILocationEntity {
  @Column({
    nullable: false,
    type: String,
    unique: true,
  })
  serial_number!: string;

  @Column({
    nullable: false,
    type: String,
  })
  number!: string;

  @Column({
    nullable: true,
    type: String,
  })
  description!: string | null;

  @Column({ nullable: true, type: String })
  department!: string | null;

  @Column({ nullable: false, type: String, default: 'INTERNAL' })
  location_type!: string;

  @Column({
    nullable: false,
    type: Boolean,
    default: true,
  })
  enabled!: boolean;

  /** The Summary kept at this location. Optional; printed on the location's summary tag. */
  @Column({ type: String, nullable: true })
  summary_id!: string | null;

  @ManyToOne(() => PartSummaryOrmEntity, { nullable: true })
  @JoinColumn({ name: 'summary_id' })
  summary?: PartSummaryOrmEntity | null;

  /** The part type kept at this location. Optional; printed on the location's summary tag. */
  @Column({ type: String, nullable: true })
  part_type_id!: string | null;

  @ManyToOne(() => CutterPartTypeOrmEntity, { nullable: true })
  @JoinColumn({ name: 'part_type_id' })
  part_type?: CutterPartTypeOrmEntity | null;

  @ManyToOne(() => UserOrmEntity, {
    nullable: true,
  })
  @JoinColumn({ name: 'createdBy' })
  createdByUser!: UserOrmEntity | null;

  @ManyToOne(() => UserOrmEntity, {
    nullable: true,
  })
  @JoinColumn({ name: 'updatedBy' })
  updatedByUser!: UserOrmEntity | null;

  @ManyToOne(() => UserOrmEntity, {
    nullable: true,
  })
  @JoinColumn({ name: 'deletedBy' })
  deletedByUser!: UserOrmEntity | null;

  public override toJSON(): ILocation {
    return instanceToPlain(this) as ILocation;
  }
}
