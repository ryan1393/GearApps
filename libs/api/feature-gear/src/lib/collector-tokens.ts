import { ReqUser, RequestUser } from '@gearapps/api/core';
import { CreateCollectorTokenDto } from '@gearapps/api/data-access';
import { CollectorToken, CreatedCollectorToken, DockerCollectorConnection } from '@gearapps/shared/domain';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@Injectable()
export abstract class CollectorTokensService {
  abstract list(): Promise<CollectorToken[]>;
  abstract create(name: string, createdBy: string): Promise<CreatedCollectorToken>;
  abstract revoke(id: string): Promise<void>;
  abstract dockerConnection(): Promise<DockerCollectorConnection>;
  abstract connectDocker(createdBy: string): Promise<DockerCollectorConnection>;
}

/** Admins issue and revoke the tokens machine collectors (Lapper Read) sign in with. */
@Controller({ path: 'collector-token', version: '1' })
@ApiTags('Gear · Collector tokens')
@ApiBearerAuth()
export class CollectorTokensController {
  constructor(private readonly service: CollectorTokensService) {}

  @Get()
  @ApiOperation({ summary: 'Collector tokens (the secrets themselves are never returned)' })
  list(@ReqUser() user: RequestUser): Promise<CollectorToken[]> {
    requireAdmin(user);
    return this.service.list();
  }

  @Get('docker')
  @ApiOperation({ summary: 'Whether the Docker Lapper Read collector is connected, and with which token' })
  dockerConnection(@ReqUser() user: RequestUser): Promise<DockerCollectorConnection> {
    requireAdmin(user);
    return this.service.dockerConnection();
  }

  @Post('docker')
  @ApiOperation({
    summary:
      'Connect the Docker collector: issue it a new token on its private volume and revoke the previous one. The token is never returned.',
  })
  connectDocker(@ReqUser() user: RequestUser): Promise<DockerCollectorConnection> {
    requireAdmin(user);
    return this.service.connectDocker(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a collector token; the response is the only time it is shown' })
  create(
    @ReqUser() user: RequestUser,
    @Body() body: CreateCollectorTokenDto,
  ): Promise<CreatedCollectorToken> {
    requireAdmin(user);
    return this.service.create(body.name.trim(), user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a collector token; collectors using it stop immediately' })
  revoke(@ReqUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    requireAdmin(user);
    return this.service.revoke(id);
  }
}

function requireAdmin(user: RequestUser | undefined): void {
  // Collector tokens act as non-admin users, so a token can never mint or revoke tokens.
  if (user?.role !== 'admin' || 'collectorTokenId' in (user ?? {}))
    throw new ForbiddenException('Only MeshForge administrators can manage collector tokens');
}
