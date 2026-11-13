import { IsString, Matches, MaxLength } from 'class-validator';

export class ScanPackingSlipDto {
  @IsString()
  @Matches(/^[0-9]{8}$/)
  deliveryNumber!: string;
}

export class PackingSlipScanTokenDto {
  @IsString()
  @MaxLength(2048)
  @Matches(/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/)
  token!: string;
}
