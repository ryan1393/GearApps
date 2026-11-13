import { BadRequestException, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DsfHistoryCollectorStatus, DsfHistoryReport, DsfHistorySourceSnapshot } from '@meshforge/shared/domain';
import { DataSource } from 'typeorm';
import type { HistoryCapture, HistoryPlan, HistoryReportQuery } from './dsf-history-model';
import { DsfHistoryStore, HISTORY_ROW_LIMIT, validateHistoryReportQuery, HistoryStoredStatus } from './dsf-history-store';

/** No timer or DSF connection: the existing serialized reader supplies staged captures. */
@Injectable()
export class DsfHistoryService implements OnModuleInit {
  readonly enabled = process.env['DSF_HISTORY_ENABLED']==='true';
  private readonly readerEnabled = process.env['DSF_COUNT_ENABLED']==='true';
  private readonly configuredDays = Number(process.env['DSF_HISTORY_LOOKBACK_DAYS']||'7');
  private readonly settingsValid = Number.isInteger(this.configuredDays) && this.configuredDays>=1 && this.configuredDays<=31;
  private readonly lookbackDays = this.settingsValid?this.configuredDays:7;
  private readonly interval = Number(process.env['DSF_COUNT_INTERVAL_SECONDS']||'60');
  private readonly store: DsfHistoryStore;
  private readonly logger = new Logger('DsfHistory');
  private schemaReady = false;
  private systemKey: string | undefined;
  private lastFailure: { at:string;code:string } | null = null;

  constructor(@InjectDataSource() private readonly db: DataSource) { this.store=new DsfHistoryStore(db); }

  async onModuleInit():Promise<void> {
    if (this.db.options.type!=='postgres') return;
    try {
      if (this.enabled && this.settingsValid) await this.store.ensure();
      this.schemaReady=await this.store.available();
    } catch {
      this.lastFailure={at:new Date().toISOString(),code:'HISTORY_SCHEMA_UNAVAILABLE'};
      this.logger.warn('DSF count history storage could not be prepared. Existing records were left unchanged.');
    }
  }

  async preparePlan(at:string,systemKey:string):Promise<HistoryPlan|null> {
    this.systemKey=systemKey;
    if (!this.enabled || !this.readerEnabled || !this.settingsValid || !this.schemaReady) return null;
    return this.store.plan(at,systemKey,this.lookbackDays);
  }

  /** Called only after the validated DSF read-only session has closed. */
  async commitCapture(capture:HistoryCapture):Promise<void> {
    if (!this.enabled || !this.schemaReady) return;
    await this.store.commit(capture);
    this.systemKey=capture.system_key;
    this.lastFailure=null;
  }

  /** Logs and persists only fixed failure codes, never raw database diagnostics. */
  async noteFailure(code:string):Promise<void> {
    const safe=/^[A-Z0-9_]{2,80}$/.test(code)?code:'HISTORY_CAPTURE_UNAVAILABLE';
    const at=new Date().toISOString();
    if (this.lastFailure?.code!==safe) this.logger.warn('DSF count history refresh is delayed ('+safe+').');
    this.lastFailure={at,code:safe};
    if (this.schemaReady && this.systemKey) {
      try { await this.store.failure(this.systemKey,safe,at); }
      catch { /* Retain the in-memory failure without exposing driver diagnostics. */ }
    }
  }

  private async storageAvailable():Promise<boolean> {
    if (this.db.options.type!=='postgres') return false;
    try { this.schemaReady=await this.store.available(); return this.schemaReady; }
    catch { return false; }
  }

  async status():Promise<DsfHistoryCollectorStatus> {
    const available=await this.storageAvailable();
    let stored:HistoryStoredStatus|null=null;
    if (available) {
      try { stored=await this.store.status(this.systemKey); }
      catch { return this.statusValue(false,null); }
    }
    return this.statusValue(available,stored);
  }

  private statusValue(available:boolean,stored:HistoryStoredStatus|null):DsfHistoryCollectorStatus {
    const failure=this.lastFailure && (!stored?.last_failure_at || this.lastFailure.at>=stored.last_failure_at)
      ? this.lastFailure : stored?.last_failure_at?{at:stored.last_failure_at,code:stored.last_failure_code}:null;
    let note='Hourly and dated-shift RUN counts are retained in MeshForge. Backfill scan progress does not prove complete coverage.';
    if (!this.settingsValid) note='History lookback must be a whole number from 1 to 31 days. Collection is not running.';
    else if (!this.enabled) note='History collection is disabled. Previously recorded history remains available.';
    else if (!this.readerEnabled) note='The DSF reader is disabled. Previously recorded history remains available.';
    else if (!available) note='DSF history storage is unavailable. Existing records were not overwritten.';
    else if (failure) note='History capture is delayed. Stored counts retain their last successful source time.';
    else if (stored?.issue_count) note=String(stored.issue_count)+' source/time windows require review. Backfill scan progress does not prove complete coverage.';
    else if (!stored?.last_success_at) note='Waiting for the first validated DSF history capture.';
    return {format:'DSFHISTORYSTATUS1',enabled:this.enabled,available,source_reader_enabled:this.readerEnabled,
      interval_seconds:Number.isInteger(this.interval)&&this.interval>=30&&this.interval<=3600?this.interval:60,
      lookback_days:this.lookbackDays,retention:'indefinite',last_success_at:stored?.last_success_at??null,
      last_failure_at:failure?.at??null,last_failure_code:failure?.code??null,
      next_backfill_hour:stored?.next_backfill_hour??null,backfill_start:stored?.backfill_start??null,
      source_count:stored?.source_count??0,active_source_count:stored?.active_source_count??0,
      earliest_hour:stored?.earliest_hour??null,latest_covered_to:stored?.latest_covered_to??null,note};
  }

  async sources(includeInactive=false):Promise<DsfHistorySourceSnapshot> {
    const available=await this.storageAvailable();
    if (!available) return {format:'DSFHISTORYSOURCES1',available:false,served_at:new Date().toISOString(),sources:[]};
    try { return {format:'DSFHISTORYSOURCES1',available:true,served_at:new Date().toISOString(),sources:await this.store.sources(includeInactive,this.systemKey)}; }
    catch (error) {
      if (error instanceof Error && error.message==='HISTORY_SOURCE_LIMIT') throw new BadRequestException('The source catalog exceeds its display limit. Hide inactive sources and retry.');
      throw new ServiceUnavailableException('Stored DSF source history is temporarily unavailable.');
    }
  }

  async report(query:HistoryReportQuery):Promise<DsfHistoryReport> {
    validateHistoryReportQuery(query);
    if (!await this.storageAvailable()) return {format:'DSFHISTORY1',available:false,served_at:new Date().toISOString(),
      timezone:'America/Indiana/Indianapolis',from:query.from,to:query.to,group:query.group,rows:[],truncated:false,row_limit:HISTORY_ROW_LIMIT,
      totals:{count:null,known_subtotal:0,complete_records:0,partial_records:0,unknown_records:0,review_records:0,excluded_duplicate_sources:0},
      note:'No stored DSF history is available yet. Enable history collection using the existing DSF reader connection.'};
    try { return await this.store.report(query,this.systemKey); }
    catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException('Stored DSF count history is temporarily unavailable; narrow the date or source filters if the request is large.');
    }
  }
}
