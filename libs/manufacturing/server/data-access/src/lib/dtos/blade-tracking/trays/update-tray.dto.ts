import { PartialType } from '@nestjs/swagger';

import { CreateTrayDto } from './create-tray.dto';

export class UpdateTrayDto extends PartialType(
  CreateTrayDto,
) {}
