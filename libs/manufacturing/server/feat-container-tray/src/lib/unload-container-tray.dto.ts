import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class UnloadContainerTrayDto {
  @ApiProperty({ description: 'Scanned Cuttergrind Finished shelf tag (CGFR-A1A for RING or CGFP-A1A for PINION: shelf letter, layer number, bin letter)' })
  @IsString()
  shelf_location_serial_number!: string;
}
