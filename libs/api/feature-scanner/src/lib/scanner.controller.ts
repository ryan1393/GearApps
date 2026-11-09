import { ErrorResponseDto, ScannerCommandDto } from '@gearapps/api/data-access';
import { ScannerDetailsService } from '@gearapps/api/feature-gear';
import { scannerConfig } from '@gearapps/api/core';
import { ScannerCommand, ScannerLogEntry, ScannerSummary } from '@gearapps/shared/domain';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  ApiBadGatewayResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { ScannerClientService } from './scanner-client.service';

/**
 * Scanner routes are keyed by the scanner's database id so the API never
 * proxies to an arbitrary caller-supplied host (SSRF). The legacy un-keyed
 * routes fall back to `SCANNER_DEFAULT_HOST` for backwards compatibility.
 */
@Controller({ path: 'scanner', version: '1' })
@ApiTags('Scanner')
@ApiBearerAuth()
@ApiBadGatewayResponse({ type: ErrorResponseDto, description: 'Scanner or FTP server unreachable' })
export class ScannerController {
  constructor(
    private readonly client: ScannerClientService,
    private readonly scanners: ScannerDetailsService,
    @Inject(scannerConfig.KEY) private readonly cfg: ConfigType<typeof scannerConfig>,
  ) {}

  // ----- by scanner id -----

  @Get(':scannerId/summary')
  @ApiOperation({ summary: 'Scanner status summary (counters, banks, latest reads)' })
  async summary(@Param('scannerId', ParseUUIDPipe) id: string): Promise<ScannerSummary> {
    return this.client.getSummary(await this.hostFor(id));
  }

  @Get(':scannerId/image')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('image/jpeg')
  @ApiOperation({ summary: 'Latest captured image from the scanner' })
  async image(@Param('scannerId', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const buffer = await this.client.getLatestImage(await this.hostFor(id));
    return new StreamableFile(buffer, { type: 'image/jpeg' });
  }

  @Get(':scannerId/log')
  @ApiOperation({ summary: 'Scanner command log' })
  async log(@Param('scannerId', ParseUUIDPipe) id: string): Promise<ScannerLogEntry[]> {
    return this.client.getCommandLog(await this.hostFor(id));
  }

  @Post(':scannerId/command')
  @ApiOperation({ summary: 'Send an op code to the scanner (e.g. OUTON,1 / TUNE01 / LON01)' })
  @ApiOkResponse({ type: ScannerCommandDto })
  async command(
    @Param('scannerId', ParseUUIDPipe) id: string,
    @Body() body: ScannerCommandDto,
  ): Promise<ScannerCommand> {
    return this.client.sendCommand(await this.hostFor(id), body);
  }

  // ----- legacy routes (default host) -----

  @Get()
  @ApiOperation({ summary: 'Legacy: summary from the default scanner', deprecated: true })
  legacySummary(): Promise<ScannerSummary> {
    return this.client.getSummary(this.defaultHost());
  }

  @Get('getFile')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('image/jpeg')
  @ApiOperation({ summary: 'Legacy: latest image from the default scanner', deprecated: true })
  async legacyImage(): Promise<StreamableFile> {
    return new StreamableFile(await this.client.getLatestImage(this.defaultHost()), {
      type: 'image/jpeg',
    });
  }

  @Get('log')
  @ApiOperation({ summary: 'Legacy: command log from the default scanner', deprecated: true })
  legacyLog(): Promise<ScannerLogEntry[]> {
    return this.client.getCommandLog(this.defaultHost());
  }

  @Post('op')
  @ApiOperation({ summary: 'Legacy: send a command to the default scanner', deprecated: true })
  legacyCommand(@Body() body: ScannerCommandDto): Promise<ScannerCommand> {
    return this.client.sendCommand(this.defaultHost(), body);
  }

  private async hostFor(scannerId: string): Promise<string> {
    const scanner = await this.scanners.findOne(scannerId);
    if (!scanner.ip)
      throw new BadRequestException(`Scanner ${scannerId} has no IP address configured`);
    return scanner.ip;
  }

  private defaultHost(): string {
    if (!this.cfg.defaultHost)
      throw new BadRequestException('SCANNER_DEFAULT_HOST is not configured');
    return this.cfg.defaultHost;
  }
}
