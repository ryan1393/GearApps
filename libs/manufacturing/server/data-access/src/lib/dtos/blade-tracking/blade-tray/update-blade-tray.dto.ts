import { PartialType } from '@nestjs/swagger';

import { CreateBladeTrayDto } from './create-blade-tray.dto';

export class UpdateBladeTrayDto extends PartialType(
  CreateBladeTrayDto,
) {}
