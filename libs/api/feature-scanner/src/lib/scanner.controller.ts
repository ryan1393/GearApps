import { ErrorResponseDto, ScannerCommandDto } from '@meshforge/api/data-access';
import { ScannerDetailsService } from '@meshforge/api/feature-gear';
import { LapperWritePolicy, ReqUser, RequestUser, scannerConfig } from '@meshforge/api/core';
import { ScannerCommand, ScannerFtpListing, ScannerLogEntry, ScannerSummary } from '@meshforge/shared/domain';
import {
  UseInterceptors,
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  ApiBadGatewayResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ScannerClientService } from './scanner-client.service';

/**
 * Scanner routes are keyed by the scanner's database id so the API never
 * proxies to an arbitrary caller-supplied host (SSRF). The legacy un-keyed
 * routes fall back to `SCANNER_DEFAULT_HOST` for backwards compatibility.
 */
@UseInterceptors(LapperWritePolicy)
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

  // ----- FTP drop (admin) -----

  @Get('ftp/browse')
  @ApiOperation({ summary: 'List a folder of the scanner FTP drop, to choose a scanner\'s image folder and file (administrators)' })
  @ApiQuery({ name: 'path', required: false, description: 'Folder to list; defaults to SCANNER_FTP_ROOT' })
  browseFtp(@ReqUser() user: RequestUser, @Query('path') path?: string): Promise<ScannerFtpListing> {
    // Collector tokens act as non-admin users, so a token can never browse the FTP drop.
    if (user?.role !== 'admin' || 'collectorTokenId' in (user ?? {}))
      throw new ForbiddenException('Only MeshForge administrators can browse the scanner FTP drop');
    return this.client.listFtpFolder(path);
  }

  // ----- by scanner id -----

  @Get(':scannerId/summary')
  @ApiOperation({ summary: 'Scanner status summary (counters, banks, latest reads)' })
  async summary(@Param('scannerId', ParseUUIDPipe) id: string): Promise<ScannerSummary> {
    return this.client.getSummary(await this.hostFor(id));
  }

  @Get(':scannerId/image')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('image/jpeg', 'image/bmp')
  @ApiOperation({ summary: 'Latest captured image from the scanner' })
  async image(@Param('scannerId', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const scanner = await this.scanners.findOne(id);
    if (!scanner.ip && !scanner.image_folder?.trim())
      throw new BadRequestException(`Scanner ${id} has no IP address or image folder configured`);
    const { data, contentType } = await this.client.getLatestImage(
      scanner.ip,
      { folder: scanner.image_folder, file: scanner.image_file },
      scanner.ip ?? id,
    );
    return new StreamableFile(data, { type: contentType });
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
  @ApiProduces('image/jpeg', 'image/bmp')
  @ApiOperation({ summary: 'Legacy: latest image from the default scanner', deprecated: true })
  async legacyImage(): Promise<StreamableFile> {
    const { data, contentType } = await this.client.getLatestImage(this.defaultHost());
    return new StreamableFile(data, { type: contentType });
  }

  @Get('log')
  @ApiOperation({ summary: 'Legacy: command log from the default scanner', deprecated: true })
  legacyLog(): Promise<ScannerLogEntry[]> {
    return this.client.getCommandLog(this.defaultHost());
  }

  @Post('op')
  @ApiOperation({ summary: 'Legacy: send a command to the default scanner', deprecated: true })
  legacyCommand(@Body() body: ScannerCommandDto): Promise<ScannerCommand> {
    return this.client.sendWebCommand(this.defaultHost(), body);
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
