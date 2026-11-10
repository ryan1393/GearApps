import { PartialType } from '@nestjs/swagger';

import { CreateContainerTrayDto } from './create-container-tray.dto';

export class UpdateContainerTrayDto extends PartialType(
  CreateContainerTrayDto,
) {}
