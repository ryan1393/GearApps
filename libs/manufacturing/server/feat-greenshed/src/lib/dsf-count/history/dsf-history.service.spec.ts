import { BadRequestException, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DsfHistoryService } from './dsf-history.service';
import { DsfHistoryStore } from './dsf-history-store';

describe('DSF history service lifecycle',()=>{
  const environment={...process.env};
  afterEach(()=>{process.env={...environment};jest.restoreAllMocks();});

  it('supports disabled collection without constructing a source client or creating tables',async()=>{
    process.env['DSF_HISTORY_ENABLED']='false';
    const ensure=jest.spyOn(DsfHistoryStore.prototype,'ensure').mockResolvedValue();
    jest.spyOn(DsfHistoryStore.prototype,'available').mockResolvedValue(true);
    jest.spyOn(DsfHistoryStore.prototype,'sources').mockResolvedValue([]);
    const query=jest.fn();
    const service=new DsfHistoryService({options:{type:'postgres'},query} as unknown as DataSource);
    await service.onModuleInit();
    expect(ensure).not.toHaveBeenCalled();
    expect(await service.preparePlan('2026-11-12T20:00:00Z','a'.repeat(64))).toBeNull();
    expect((await service.sources(true)).available).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps non-PostgreSQL development databases untouched',async()=>{
    Object.assign(process.env,{DSF_HISTORY_ENABLED:'true',DSF_COUNT_ENABLED:'true'});
    const query=jest.fn();
    const service=new DsfHistoryService({options:{type:'better-sqlite3'},query} as unknown as DataSource);
    await service.onModuleInit();
    expect((await service.status()).available).toBe(false);
    expect((await service.sources()).sources).toEqual([]);
    expect((await service.report({from:'2026-11-12',to:'2026-11-12',group:'day',include_inactive:false})).totals.count).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('forwards a bounded plan only when history and the shared reader are enabled',async()=>{
    Object.assign(process.env,{DSF_HISTORY_ENABLED:'true',DSF_COUNT_ENABLED:'true',DSF_HISTORY_LOOKBACK_DAYS:'7'});
    jest.spyOn(DsfHistoryStore.prototype,'ensure').mockResolvedValue();
    jest.spyOn(DsfHistoryStore.prototype,'available').mockResolvedValue(true);
    const expected={system_key:'a'.repeat(64),backfill_start:'2026-11-05T20:00:00Z',backfill_hour:'2026-11-05T20:00:00Z',hours:['2026-11-12T20:00:00Z']};
    const plan=jest.spyOn(DsfHistoryStore.prototype,'plan').mockResolvedValue(expected);
    const service=new DsfHistoryService({options:{type:'postgres'}} as unknown as DataSource);
    await service.onModuleInit();
    expect(await service.preparePlan('2026-11-12T20:30:00Z','a'.repeat(64))).toEqual(expected);
    expect(plan).toHaveBeenCalledWith('2026-11-12T20:30:00Z','a'.repeat(64),7);
  });

  it('never exposes raw failure text through status or logs',async()=>{
    Object.assign(process.env,{DSF_HISTORY_ENABLED:'true',DSF_COUNT_ENABLED:'true'});
    jest.spyOn(DsfHistoryStore.prototype,'ensure').mockResolvedValue();
    jest.spyOn(DsfHistoryStore.prototype,'available').mockResolvedValue(true);
    jest.spyOn(DsfHistoryStore.prototype,'status').mockResolvedValue(null);
    const warn=jest.spyOn(Logger.prototype,'warn').mockImplementation(()=>undefined);
    const service=new DsfHistoryService({options:{type:'postgres'}} as unknown as DataSource);
    await service.onModuleInit();
    await service.noteFailure('password=PRIVATE_VALUE host=PRIVATE_HOST');
    const status=await service.status();
    expect(status.last_failure_code).toBe('HISTORY_CAPTURE_UNAVAILABLE');
    expect(JSON.stringify(status)).not.toContain('PRIVATE_');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_');
  });

  it('validates report input even when no history has been stored',async()=>{
    const service=new DsfHistoryService({options:{type:'better-sqlite3'}} as unknown as DataSource);
    await expect(service.report({from:'2026-02-30',to:'2026-03-01',group:'day',include_inactive:false})).rejects.toThrow(BadRequestException);
  });

  it('shows known first-capture issues before the generic waiting message',async()=>{
    Object.assign(process.env,{DSF_HISTORY_ENABLED:'true',DSF_COUNT_ENABLED:'true'});
    jest.spyOn(DsfHistoryStore.prototype,'available').mockResolvedValue(true);
    jest.spyOn(DsfHistoryStore.prototype,'status').mockResolvedValue({system_key:'a'.repeat(64),last_success_at:null,last_failure_at:null,
      last_failure_code:null,backfill_start:'2026-11-05T20:00:00Z',next_backfill_hour:'2026-11-05T20:00:00Z',
      source_count:5,active_source_count:5,issue_count:3,earliest_hour:null,latest_covered_to:null});
    const service=new DsfHistoryService({options:{type:'postgres'}} as unknown as DataSource);
    expect((await service.status()).note).toContain('3 source/time windows require review');
  });
});
