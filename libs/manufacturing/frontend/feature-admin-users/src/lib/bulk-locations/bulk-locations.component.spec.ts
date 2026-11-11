import { HttpClientModule } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AdminApiService, AssetTagPrintResult } from '../admin-api.service';

import { BulkLocationsComponent } from './bulk-locations.component';

describe('BulkLocationsComponent', () => {
  let component: BulkLocationsComponent;
  let fixture: ComponentFixture<BulkLocationsComponent>;
  let api: AdminApiService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [BulkLocationsComponent, HttpClientModule] }).compileComponents();
    fixture = TestBed.createComponent(BulkLocationsComponent);
    component = fixture.componentInstance;
    api = TestBed.inject(AdminApiService);
    fixture.detectChanges();
  });

  it('previews every bin of the chosen layers', () => {
    component.prefix = 'CGFP';
    component.shelf = 'B';
    component.layers = new Set([3, 1]);
    component.bins = 2;

    expect(component.serials).toEqual(['CGFP-B1A', 'CGFP-B1B', 'CGFP-B3A', 'CGFP-B3B']);
    expect(component.preview.map(line => `${line.first}..${line.last}`)).toEqual(['CGFP-B1A..CGFP-B1B', 'CGFP-B3A..CGFP-B3B']);
    expect(component.binRange).toBe('bins A to B');
  });

  it('needs a layer and 1 to 26 bins', () => {
    component.layers = new Set();
    expect(component.problem).toBe('Choose at least one layer.');
    component.toggleLayer(4);
    component.bins = 27;
    expect(component.problem).toContain('1 to 26');
    component.bins = 26;
    expect(component.problem).toBe('');
  });

  it('sends the choice in one request and lists what happened to each bin', async () => {
    const bulk = jest.spyOn(api, 'bulkCreateShelfLocations').mockReturnValue(of({
      created: 1, existing: 1,
      locations: [
        { id: '1', serial_number: 'CGDR-A2A', state: 'existing', enabled: true },
        { id: '2', serial_number: 'CGDR-A2B', state: 'created', enabled: true },
      ],
    }));
    const print = jest.spyOn(api, 'printAssetTag');
    const reload = jest.fn();
    component.created.subscribe(reload);
    component.layers = new Set([2]);
    component.bins = 2;

    await component.create();

    expect(bulk).toHaveBeenCalledWith({ prefix: 'CGDR', shelf: 'A', layers: [2], bins: 2 });
    expect(component.results.map(row => row.state)).toEqual(['existing', 'created']);
    expect(reload).toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
  });

  it('prints a tag for each bin when asked', async () => {
    jest.spyOn(api, 'bulkCreateShelfLocations').mockReturnValue(of({
      created: 1, existing: 0, locations: [{ id: '9', serial_number: 'CGDR-A1A', state: 'created', enabled: true }],
    }));
    const print = jest.spyOn(api, 'printAssetTag').mockReturnValue(of({ printed: true } as AssetTagPrintResult));
    component.bins = 1;
    component.printTags = true;

    await component.create();

    expect(print).toHaveBeenCalledWith('LOCATION', '9');
    expect(component.results[0].tag).toBe('Printed');
  });
});
