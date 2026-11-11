import { BaseEntity } from '../common/entity';

/** "TOC" in the legacy code — the kind of check a cutter log records. */
export interface TypeOfCheck extends BaseEntity {
  name: string;
  description: string;
}
