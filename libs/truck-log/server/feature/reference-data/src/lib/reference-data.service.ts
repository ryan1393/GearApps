import { returnedRows } from '@truck-log/server/data-access';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CreateCarrierReferenceDto,
  CreateDriverReferenceDto,
  CreateLocationReferenceDto,
  UpdateCarrierReferenceDto,
  UpdateDriverReferenceDto,
  UpdateLocationReferenceDto,
} from './dto/reference-data.dto';

@Injectable()
export class ReferenceDataService {
  constructor(private readonly dataSource: DataSource) {}

  private clean(value: string | undefined, field: string) {
    const result = value?.trim() || '';
    if (!result) throw new BadRequestException(`${field} is required.`);
    return result;
  }

  private optional(value: string | undefined) {
    const result = value?.trim();
    return result || null;
  }

  private duplicateError(error: unknown, label: string): never {
    if ((error as { code?: string })?.code === '23505') {
      throw new BadRequestException(`${label} already exists.`);
    }
    throw error;
  }

  drivers(includeInactive = false) {
    return this.dataSource.query(
      `SELECT id,
              name,
              phone_number AS "phoneNumber",
              active,
              last_used_at AS "lastUsedAt",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
         FROM drivers
        WHERE ($1::boolean = true OR active = true)
        ORDER BY active DESC, last_used_at DESC NULLS LAST, LOWER(name), id`,
      [includeInactive],
    );
  }

  carriers(includeInactive = false) {
    return this.dataSource.query(
      `SELECT id,
              name,
              active,
              last_used_at AS "lastUsedAt",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
         FROM carriers
        WHERE ($1::boolean = true OR active = true)
        ORDER BY active DESC, last_used_at DESC NULLS LAST, LOWER(name), id`,
      [includeInactive],
    );
  }

  locations(includeInactive = false) {
    return this.dataSource.query(
      `SELECT id,
              name,
              address_line1 AS "addressLine1",
              city,
              state,
              postal_code AS "postalCode",
              country,
              active,
              last_used_at AS "lastUsedAt",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
         FROM locations
        WHERE ($1::boolean = true OR active = true)
        ORDER BY active DESC, last_used_at DESC NULLS LAST, LOWER(name), id`,
      [includeInactive],
    );
  }

  async checkInReferenceData() {
    const [drivers, carriers, locations] = await Promise.all([
      this.drivers(false),
      this.carriers(false),
      this.locations(false),
    ]);
    return { drivers, carriers, locations };
  }

  async createDriver(dto: CreateDriverReferenceDto) {
    try {
      const rows = await this.dataSource.query(
        `INSERT INTO drivers(name, phone_number, active, created_at, updated_at)
         VALUES($1,$2,true,NOW(),NOW())
         RETURNING id, name, phone_number AS "phoneNumber", active,
                   last_used_at AS "lastUsedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [this.clean(dto.name, 'Driver name'), this.optional(dto.phoneNumber)],
      );
      return rows[0];
    } catch (error) {
      return this.duplicateError(error, 'Driver');
    }
  }

  async updateDriver(id: number, dto: UpdateDriverReferenceDto) {
    const rows = await this.dataSource.query(
      `SELECT id, name, phone_number AS "phoneNumber", active FROM drivers WHERE id=$1`,
      [id],
    );
    const current = rows[0];
    if (!current) throw new NotFoundException('Driver not found.');

    const name = dto.name === undefined ? current.name : this.clean(dto.name, 'Driver name');
    const phone = dto.phoneNumber === undefined ? current.phoneNumber : this.optional(dto.phoneNumber);
    const active = dto.active === undefined ? current.active : dto.active;

    try {
      const updated = returnedRows(await this.dataSource.query(
        `UPDATE drivers
            SET name=$2, phone_number=$3, active=$4, updated_at=NOW()
          WHERE id=$1
          RETURNING id, name, phone_number AS "phoneNumber", active,
                    last_used_at AS "lastUsedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, name, phone, active],
      ));
      return updated[0];
    } catch (error) {
      return this.duplicateError(error, 'Driver');
    }
  }

  async createCarrier(dto: CreateCarrierReferenceDto) {
    try {
      const rows = await this.dataSource.query(
        `INSERT INTO carriers(name, active, created_at, updated_at)
         VALUES($1,true,NOW(),NOW())
         RETURNING id, name, active, last_used_at AS "lastUsedAt",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [this.clean(dto.name, 'Carrier name')],
      );
      return rows[0];
    } catch (error) {
      return this.duplicateError(error, 'Carrier');
    }
  }

  async updateCarrier(id: number, dto: UpdateCarrierReferenceDto) {
    const rows = await this.dataSource.query(
      `SELECT id, name, active FROM carriers WHERE id=$1`,
      [id],
    );
    const current = rows[0];
    if (!current) throw new NotFoundException('Carrier not found.');

    const name = dto.name === undefined ? current.name : this.clean(dto.name, 'Carrier name');
    const active = dto.active === undefined ? current.active : dto.active;

    try {
      const updated = returnedRows(await this.dataSource.query(
        `UPDATE carriers SET name=$2, active=$3, updated_at=NOW() WHERE id=$1
         RETURNING id, name, active, last_used_at AS "lastUsedAt",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, name, active],
      ));
      return updated[0];
    } catch (error) {
      return this.duplicateError(error, 'Carrier');
    }
  }

  async createLocation(dto: CreateLocationReferenceDto) {
    try {
      const rows = await this.dataSource.query(
        `INSERT INTO locations(
           name, address_line1, city, state, postal_code, country,
           active, created_at, updated_at
         )
         VALUES($1,$2,$3,$4,$5,$6,true,NOW(),NOW())
         RETURNING id, name, address_line1 AS "addressLine1", city, state,
                   postal_code AS "postalCode", country, active,
                   last_used_at AS "lastUsedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          this.clean(dto.name, 'Location name'),
          this.optional(dto.addressLine1),
          this.optional(dto.city),
          this.optional(dto.state),
          this.optional(dto.postalCode),
          this.optional(dto.country),
        ],
      );
      return rows[0];
    } catch (error) {
      return this.duplicateError(error, 'Location');
    }
  }

  async updateLocation(id: number, dto: UpdateLocationReferenceDto) {
    const rows = await this.dataSource.query(
      `SELECT id, name, address_line1 AS "addressLine1", city, state,
              postal_code AS "postalCode", country, active
         FROM locations WHERE id=$1`,
      [id],
    );
    const current = rows[0];
    if (!current) throw new NotFoundException('Location not found.');

    const updatedValues = {
      name: dto.name === undefined ? current.name : this.clean(dto.name, 'Location name'),
      addressLine1: dto.addressLine1 === undefined ? current.addressLine1 : this.optional(dto.addressLine1),
      city: dto.city === undefined ? current.city : this.optional(dto.city),
      state: dto.state === undefined ? current.state : this.optional(dto.state),
      postalCode: dto.postalCode === undefined ? current.postalCode : this.optional(dto.postalCode),
      country: dto.country === undefined ? current.country : this.optional(dto.country),
      active: dto.active === undefined ? current.active : dto.active,
    };

    try {
      const updated = returnedRows(await this.dataSource.query(
        `UPDATE locations
            SET name=$2, address_line1=$3, city=$4, state=$5, postal_code=$6,
                country=$7, active=$8, updated_at=NOW()
          WHERE id=$1
          RETURNING id, name, address_line1 AS "addressLine1", city, state,
                    postal_code AS "postalCode", country, active,
                    last_used_at AS "lastUsedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          id,
          updatedValues.name,
          updatedValues.addressLine1,
          updatedValues.city,
          updatedValues.state,
          updatedValues.postalCode,
          updatedValues.country,
          updatedValues.active,
        ],
      ));
      return updated[0];
    } catch (error) {
      return this.duplicateError(error, 'Location');
    }
  }
}
