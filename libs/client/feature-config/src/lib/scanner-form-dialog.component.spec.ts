import { TestBed } from '@angular/core/testing';
import { ScannerApi, ScannerDetailsApi } from '@meshforge/client/core';
import { ScannerDetail, ScannerFtpListing } from '@meshforge/shared/domain';
import { of } from 'rxjs';

import { ScannerFormDialogComponent } from './scanner-form-dialog.component';

interface Dialog {
  form: ScannerFormDialogComponent['form' & keyof ScannerFormDialogComponent] & {
    controls: Record<string, { value: unknown; setValue(v: unknown): void; markAsTouched(): void }>;
    invalid: boolean;
  };
  listing(): ScannerFtpListing | null;
  defaultFolder(): string;
  defaultFile(): string;
  browse(path: string | null): void;
  useImage(folder: string, file: string): void;
  save(): void;
}

const listing: ScannerFtpListing = {
  path: '181-lapper-scanners/10.16.82.253',
  root: '181-lapper-scanners',
  defaultImageFile: 'scanner-current.jpg',
  folders: ['archive'],
  images: [{ name: 'scanner-current.jpg', size: 4189, modifiedAt: '2026-11-12T18:00:00.000Z' }],
};

const scanner: ScannerDetail = {
  id: '22222222-3333-4444-8555-666666666666',
  ip: '10.16.82.253',
  model: 'SR-X300',
  type: null,
  description: null,
  sn_procces: null,
  sn_queue: null,
  sn_scanner: null,
  status: 'Active',
  machine_id: null,
  image_folder: null,
  image_file: null,
};

describe('Scanner form: image location', () => {
  beforeAll(() => {
    // jsdom has no modal dialog support.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });

  function setup() {
    const details = { create: jest.fn((b) => of({ ...scanner, ...b })), update: jest.fn((_id, b) => of({ ...scanner, ...b })) };
    const live = { browseFtp: jest.fn(() => of(listing)), image: jest.fn() };
    TestBed.configureTestingModule({
      imports: [ScannerFormDialogComponent],
      providers: [
        { provide: ScannerDetailsApi, useValue: details },
        { provide: ScannerApi, useValue: live },
      ],
    });
    const fixture = TestBed.createComponent(ScannerFormDialogComponent);
    fixture.componentRef.setInput('scanner', scanner);
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    return { dialog: fixture.componentInstance as unknown as Dialog, details, live };
  }

  it('lists the FTP drop and learns the default folder and file', () => {
    const { dialog, live } = setup();
    expect(dialog.defaultFolder()).toBe('<FTP root>/10.16.82.253');
    dialog.browse(null);
    expect(live.browseFtp).toHaveBeenCalledWith(undefined);
    expect(dialog.listing()).toEqual(listing);
    expect(dialog.defaultFolder()).toBe('181-lapper-scanners/10.16.82.253');
    expect(dialog.defaultFile()).toBe('scanner-current.jpg');
  });

  it('goes up from the root folder to the FTP home and back down', () => {
    const { dialog, live } = setup();
    dialog.browse(null);
    (dialog as unknown as { up(): void }).up();
    expect(live.browseFtp).toHaveBeenLastCalledWith('181-lapper-scanners');
    live.browseFtp.mockReturnValueOnce(of({ ...listing, path: '181-lapper-scanners' }));
    dialog.browse('181-lapper-scanners');
    (dialog as unknown as { up(): void }).up();
    expect(live.browseFtp).toHaveBeenLastCalledWith('.');
    expect((dialog as unknown as { join(f: string, n: string): string }).join('.', 'cell-4')).toBe('cell-4');
  });

  it('fills the folder and file from a chosen capture and saves them', () => {
    const { dialog, details } = setup();
    dialog.browse(null);
    dialog.useImage('cell-4/scanner-b', 'live.BMP');
    dialog.save();
    expect(details.update).toHaveBeenCalledWith(
      scanner.id,
      expect.objectContaining({ image_folder: 'cell-4/scanner-b', image_file: 'live.BMP' }),
    );
  });

  it('sends empty fields as null so the defaults apply', () => {
    const { dialog, details } = setup();
    dialog.form.controls['image_folder'].setValue('  ');
    dialog.form.controls['image_file'].setValue('');
    dialog.save();
    expect(details.update).toHaveBeenCalledWith(
      scanner.id,
      expect.objectContaining({ image_folder: null, image_file: null }),
    );
  });

  it("refuses a file that is not a JPEG or BMP and a folder with '..'", () => {
    const { dialog, details } = setup();
    dialog.form.controls['image_file'].setValue('notes.txt');
    expect(dialog.form.invalid).toBe(true);
    dialog.form.controls['image_file'].setValue('ok.jpg');
    dialog.form.controls['image_folder'].setValue('a/../b');
    expect(dialog.form.invalid).toBe(true);
    dialog.save();
    expect(details.update).not.toHaveBeenCalled();
  });
});
