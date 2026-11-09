import { BaseEntity } from '@gearapps/shared/domain';
import {
  Body,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Type,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { CrudService } from './crud-service';

export interface CrudDtos {
  /** Full entity DTO (response shape). */
  entity: Type<unknown>;
  create: Type<unknown>;
  update: Type<unknown>;
  /** Human-readable singular name used in Swagger summaries. */
  name: string;
}

export interface CrudController<T extends BaseEntity> {
  readonly service: CrudService<T>;
  findAll(): Promise<T[]>;
  findOne(id: string): Promise<T>;
  create(body: unknown, requestKey?: string): Promise<T>;
  upsert(id: string, body: unknown): Promise<T>;
  update(id: string, body: unknown): Promise<T>;
  remove(id: string): Promise<void>;
}

/**
 * Builds a base controller class with the standard REST routes
 * (GET /, GET /:id, POST /, PUT /:id, PATCH /:id, DELETE /:id) wired to a
 * {@link CrudService}. Extend the returned class and declare `service`
 * via constructor injection; add entity-specific routes on the subclass.
 *
 * Specific routes like `GET /by-machine/:id` must be declared on the subclass;
 * Nest registers subclass routes before inherited ones so they win over `/:id`.
 */
export function crudController<T extends BaseEntity>(dtos: CrudDtos): Type<CrudController<T>> {
  abstract class CrudControllerHost implements CrudController<T> {
    abstract readonly service: CrudService<T>;

    @Get()
    @ApiOperation({ summary: `List all ${dtos.name} records` })
    @ApiOkResponse({ type: dtos.entity, isArray: true })
    findAll(): Promise<T[]> {
      return this.service.findAll();
    }

    @Get(':id')
    @ApiOperation({ summary: `Get one ${dtos.name}` })
    @ApiOkResponse({ type: dtos.entity })
    @ApiNotFoundResponse()
    findOne(@Param('id', ParseUUIDPipe) id: string): Promise<T> {
      return this.service.findOne(id);
    }

    @Post()
    @ApiOperation({ summary: `Create a ${dtos.name}` })
    @ApiBody({ type: dtos.create })
    @ApiCreatedResponse({ type: dtos.entity })
    @ApiBadRequestResponse()
    create(@Body() body: unknown, @Headers('idempotency-key') requestKey?: string): Promise<T> {
      return this.service.create(body as never, requestKey);
    }

    @Put(':id')
    @ApiOperation({ summary: `Create or replace a ${dtos.name}` })
    @ApiBody({ type: dtos.entity })
    @ApiOkResponse({ type: dtos.entity })
    upsert(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<T> {
      return this.service.upsert(id, body as never);
    }

    @Patch(':id')
    @ApiOperation({ summary: `Partially update a ${dtos.name}` })
    @ApiBody({ type: dtos.update })
    @ApiOkResponse({ type: dtos.entity })
    @ApiNotFoundResponse()
    update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<T> {
      return this.service.update(id, body as never);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: `Delete a ${dtos.name}` })
    @ApiNoContentResponse()
    @ApiNotFoundResponse()
    remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
      return this.service.remove(id);
    }
  }

  // `@Body() body: unknown` reflects as Object, which the global ValidationPipe skips.
  // Point the design-time param types at the concrete DTOs so bodies are validated
  // and transformed exactly as if the routes had been hand-written with those types.
  const proto = CrudControllerHost.prototype;
  Reflect.defineMetadata('design:paramtypes', [dtos.create, String], proto, 'create');
  Reflect.defineMetadata('design:paramtypes', [String, dtos.entity], proto, 'upsert');
  Reflect.defineMetadata('design:paramtypes', [String, dtos.update], proto, 'update');

  return CrudControllerHost as unknown as Type<CrudController<T>>;
}
