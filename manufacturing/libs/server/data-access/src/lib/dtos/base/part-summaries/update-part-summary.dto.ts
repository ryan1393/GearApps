import { PartialType } from '@nestjs/swagger';

import { CreatePartSummaryDto } from './create-part-summary.dto';

export class UpdatePartSummaryDto extends PartialType(
  CreatePartSummaryDto,
) {}
