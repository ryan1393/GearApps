import { PartialType } from '@nestjs/swagger';

import { CreateBladeDto } from './create-blade.dto';

export class UpdateBladeDto extends PartialType(
  CreateBladeDto,
) {}
