import { IsString } from 'class-validator';

import { IGoogleLoginPayload } from '@gearapps/manufacturing/shared/util-types';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleAuthLoginDto implements IGoogleLoginPayload {
  @ApiProperty()
  @IsString()
  idToken!: string;
}
