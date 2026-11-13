import { BadRequestException } from '@nestjs/common';
import type { DsfHistoryRecord } from '@meshforge/shared/domain';
import { DataSource } from 'typeorm';
import { timestampUs } from '../dsf-core';
import type { HistoryCapture, HistorySource } from './dsf-history-model';
import { DsfHistoryStore, historyHourStart, historyReportTotals, validateHistoryCapture, validateHistoryReportQuery } from './dsf-history-store';
import { ensureDsfHistorySchema, HistorySchemaManager } from './dsf-history-schema';

const uuid=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const source:HistorySource={source_key:'a'.repeat(64),system_key:'b'.repeat(64),mapping_id:uuid(1),whiteboard_id:uuid(2),
  op_id:uuid(3),line_id:uuid(4),department_id:uuid(5),source_name:'Cutter Grind fixture',line_name:'Fixture line',
  department_name:'CUTTER GRIND',asset_number:'Fixture asset',active:true,duplicate_operation:false,review_reason:null};
const capture=():HistoryCapture=>({system_key:source.system_key,source_as_of:'2026-11-12T21:00:00.000000Z',sources:[{...source}],
  backfill_start:'2026-11-12T20:00:00.000000Z',next_backfill_hour:'2026-11-12T21:00:00.000000Z',issues:[],hours:[{
    source_key:source.source_key,hour_start:'2026-11-12T20:00:00.000000Z',covered_to:'2026-11-12T21:00:00.000000Z',
    count:7,source_rows:9,last_production_at:'2026-11-12T20:59:59.000100Z',slices:[{
      source_key:source.source_key,hour_start:'2026-11-12T20:00:00.000000Z',slice_start:'2026-11-12T20:00:00.000000Z',
      slice_end:'2026-11-12T21:00:00.000000Z',shift_id:null,shift_number:null,shift_date:null,shift_start:null,shift_end:null,count:7,
    }],
  }]});
const record=(changes:Partial<DsfHistoryRecord>={}):DsfHistoryRecord=>({source_key:source.source_key,source_name:source.source_name,
  department_id:source.department_id,department_name:source.department_name,machine_number:null,asset_number:source.asset_number,
  duplicate_operation:false,review_reason:null,period_start:'2026-11-12T20:00:00Z',period_end:'2026-11-12T21:00:00Z',count:7,
  completeness:'COMPLETE',covered_seconds:3600,expected_seconds:3600,observed_at:'2026-11-12T21:00:00Z',shift_id:null,shift_number:null,shift_date:null,...changes});

describe('durable DSF history input invariants',()=>{
  it('accepts a validated zero and exact sub-hour shift boundaries without rounding timestamps',()=>{
    const input=capture();
    const first={...input.hours[0].slices[0],slice_end:'2026-11-12T20:30:00.000100Z',count:2,
      shift_id:'101',shift_number:2,shift_date:'2026-11-12',shift_start:'2026-11-12T20:00:00Z',shift_end:'2026-11-12T20:30:00.000100Z'};
    const second={...first,slice_start:first.slice_end,slice_end:input.hours[0].covered_to,count:5,
      shift_id:'102',shift_number:3,shift_start:first.slice_end,shift_end:input.hours[0].covered_to};
    input.hours[0].slices=[first,second];
    expect(()=>validateHistoryCapture(input)).not.toThrow();
    input.hours[0].count=0;input.hours[0].source_rows=0;input.hours[0].last_production_at=null;
    input.hours[0].slices.forEach(slice=>slice.count=0);
    expect(()=>validateHistoryCapture(input)).not.toThrow();
  });

  it.each([
    (input:HistoryCapture)=>{input.hours[0].count=-1;},
    (input:HistoryCapture)=>{input.hours[0].count=Number.MAX_SAFE_INTEGER+1;},
    (input:HistoryCapture)=>{input.hours[0].slices[0].slice_start='2026-11-12T20:00:00.000001Z';},
    (input:HistoryCapture)=>{input.hours[0].slices[0].slice_end='2026-11-12T20:59:59.999999Z';},
    (input:HistoryCapture)=>{input.hours[0].slices[0].count=6;},
    (input:HistoryCapture)=>{input.hours[0].slices[0].shift_number=2;},
    (input:HistoryCapture)=>{input.hours[0].last_production_at=input.hours[0].covered_to;},
    (input:HistoryCapture)=>{input.hours.push(input.hours[0]);},
    (input:HistoryCapture)=>{input.hours[0].source_key='c'.repeat(64);},
    (input:HistoryCapture)=>{input.source_as_of='2026-11-12T20:59:59Z';},
    (input:HistoryCapture)=>{input.sources.push(input.sources[0]);},
    (input:HistoryCapture)=>{input.issues.push({source_key:null,hour_start:input.backfill_start,code:'raw error with credentials'});},
  ])('refuses invalid or incomplete staged evidence before any local write %#',mutate=>{
    const input=capture();mutate(input);
    expect(()=>validateHistoryCapture(input)).toThrow();
  });

  it('does not start a local write transaction for malformed evidence',async()=>{
    const transaction=jest.fn();
    const store=new DsfHistoryStore({transaction} as unknown as DataSource);
    const input=capture();input.hours[0].count=-7;
    await expect(store.commit(input)).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('resumes a persisted outage gap instead of clamping it to the rolling lookback',async()=>{
    const query=jest.fn().mockResolvedValue([{backfill_start:'2026-10-01T00:00:00.000000Z',next_backfill_hour:'2026-10-02T00:00:00.000000Z'}]);
    const store=new DsfHistoryStore({query} as unknown as DataSource);
    const plan=await store.plan('2026-11-12T21:37:00.123400Z',source.system_key,7);
    expect(timestampUs(plan.backfill_hour)).toBe(timestampUs('2026-10-02T00:00:00Z'));
    expect(plan.hours.map(timestampUs)).toEqual([
      timestampUs('2026-11-12T21:00:00Z'),timestampUs('2026-11-12T20:00:00Z'),timestampUs('2026-10-02T00:00:00Z'),
    ]);
  });

  it('starts a bounded rolling reconciliation cycle after scan progress catches up',async()=>{
    const query=jest.fn().mockResolvedValue([{backfill_start:'2026-10-01T00:00:00Z',next_backfill_hour:'2026-11-12T21:00:00Z'}]);
    const plan=await new DsfHistoryStore({query} as unknown as DataSource).plan('2026-11-12T21:37:00Z',source.system_key,7);
    expect(timestampUs(plan.backfill_hour)).toBe(timestampUs('2026-11-05T21:00:00Z'));
    expect(timestampUs(historyHourStart('2026-11-12T21:37:00.999999Z'))).toBe(timestampUs('2026-11-12T21:00:00Z'));
  });

  it('refuses schema creation against a DSF source',async()=>{
    const manager={query:jest.fn().mockResolvedValue([{is_meshforge:false}])};
    const database={transaction:async<T>(work:(value:HistorySchemaManager)=>Promise<T>)=>work(manager)};
    await expect(ensureDsfHistorySchema(database)).rejects.toThrow('MeshForge application database');
    expect(manager.query.mock.calls.some(([sql])=>/CREATE TABLE/i.test(sql))).toBe(false);
  });
});

describe('history report completeness and totals',()=>{
  it('keeps unknown separate from verified zero and rejects partial totals',()=>{
    expect(historyReportTotals([record({count:0})],[0],false).count).toBe(0);
    expect(historyReportTotals([],[],false).count).toBeNull();
    const totals=historyReportTotals([record(),record({source_key:'c'.repeat(64),count:null,completeness:'UNKNOWN'})],[7,3],false);
    expect(totals.count).toBeNull();
    expect(totals.known_subtotal).toBe(10);
    expect(totals.unknown_records).toBe(1);
    expect(historyReportTotals([record({completeness:'PARTIAL'})],[7],false).count).toBeNull();
    expect(historyReportTotals([record()],[7],true).count).toBeNull();
  });

  it('retains duplicate-operation records while excluding ambiguous rollups',()=>{
    const duplicate=record({source_key:'c'.repeat(64),duplicate_operation:true,completeness:'REVIEW'});
    const totals=historyReportTotals([record(),duplicate],[7,100],false);
    expect(totals.count).toBeNull();
    expect(totals.known_subtotal).toBe(7);
    expect(totals.excluded_duplicate_sources).toBe(1);
  });

  it('rejects an unsafe aggregate instead of rounding a count',()=>{
    expect(()=>historyReportTotals([record(),record()],[Number.MAX_SAFE_INTEGER,1],false)).toThrow(BadRequestException);
  });

  it('validates date bounds before executing parameterized report queries',()=>{
    expect(()=>validateHistoryReportQuery({from:'2026-11-01',to:'2026-11-01',group:'day',include_inactive:false})).not.toThrow();
    expect(()=>validateHistoryReportQuery({from:'2026-02-30',to:'2026-03-01',group:'day',include_inactive:false})).toThrow(BadRequestException);
    expect(()=>validateHistoryReportQuery({from:'2026-01-01',to:'2026-02-01',group:'day',include_inactive:false})).toThrow(BadRequestException);
  });
});
