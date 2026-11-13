import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { TruckDirections, type TruckDirection } from '@truck-log/shared/contracts';
export class CreateTruckVisitDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    loadNumber!: string;
    @IsIn(Object.values(TruckDirections))
    direction!: TruckDirection;
    @IsString()
    @MaxLength(200)
    carrierName!: string;
    @IsString()
    @MaxLength(200)
    driverName!: string;
    @IsString()
    @IsNotEmpty()
    @MaxLength(30)
    @Matches(/^\+?[0-9()\s.-]+$/, {
        message: 'Driver phone number contains invalid characters.',
    })
    driverPhone!: string;
    @IsString()
    @MaxLength(100)
    tractorId!: string;
    @IsString()
    @MaxLength(100)
    trailerId!: string;
    @IsBoolean()
    isDropTrailer!: boolean;
    @IsString()
    @MaxLength(250)
    originName!: string;
    @IsString()
    @MaxLength(250)
    destinationName!: string;
    @IsString()
    @MaxLength(50)
    dockCode!: string;
    @IsOptional()
    @IsString()
    @MaxLength(4000)
    notes?: string;
    @IsOptional()
    @IsString()
    @MaxLength(120)
    actor?: string;

    /** Exact RXO identity selected by the guard. All three fields are optional
     * for manual/non-RXO visits, but the service rejects partial tuples. */
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(80)
    rxoSiteKey?: string;

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    rxoShipmentId?: string;

    @IsOptional()
    @IsIn(Object.values(TruckDirections))
    rxoDirection?: TruckDirection;

    @IsOptional()
    @IsIn(['EAST', 'WEST'])
    guardGate?: 'EAST' | 'WEST';

    @IsOptional()
    @IsUUID('4')
    clientRequestId?: string;

  @IsOptional()
    @IsBoolean()
    autoPrintDockSlip?: boolean;
}
