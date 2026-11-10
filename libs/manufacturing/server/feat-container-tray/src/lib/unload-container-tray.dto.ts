import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class UnloadContainerTrayDto {
  @ApiProperty({ description: 'Scanned Cuttergrind Finished shelf tag (CGFR-<summary> for RING or CGFP-<summary> for PINION)' })
  @IsString()
  shelf_location_serial_number!: string;
}
