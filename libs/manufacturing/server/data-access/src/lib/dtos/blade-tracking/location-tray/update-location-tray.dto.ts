import { PartialType } from '@nestjs/swagger';

import { CreateLocationTrayDto } from './create-location-tray.dto';

export class UpdateLocationTrayDto extends PartialType(
  CreateLocationTrayDto,
) {}
