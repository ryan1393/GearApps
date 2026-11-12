import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { apiErrorMessage, ScannerApi, ScannerDetailsApi } from '@meshforge/client/core';
import { DialogComponent, SegmentedComponent } from '@meshforge/client/ui';
import { Machine, ScannerDetail, ScannerFtpListing } from '@meshforge/shared/domain';
import { IPV4_PATTERN, SCANNER_TYPES, STATUS_OPTIONS } from './options';

/** Same rules as the API: a folder without '..' or backslashes; a .jpg/.jpeg/.bmp file name. */
const IMAGE_FOLDER = /^(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\p{Cc}]*$/u;
const IMAGE_FILE = /^[^/\\\p{Cc}]+\.(?:jpe?g|bmp)$/iu;

@Component({
  selector: 'gear-scanner-form-dialog',
  imports: [ReactiveFormsModule, DialogComponent, SegmentedComponent, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .scanner-image { display: grid; gap: var(--dana-space-3); margin: 0; padding: var(--dana-space-4); }
    .scanner-image legend { padding: 0 var(--dana-space-2); }
    .scanner-image-fields { display: grid; gap: var(--dana-space-3); grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); }
    .scanner-image-actions, .scanner-ftp-path { display: flex; flex-wrap: wrap; align-items: center; gap: var(--dana-space-2); }
    .scanner-ftp-path code { flex: 1 1 12rem; overflow-wrap: anywhere; }
    .scanner-ftp { display: grid; gap: var(--dana-space-2); }
    .scanner-ftp-list { display: grid; gap: var(--dana-space-1); max-height: 16rem; margin: 0; padding: 0; overflow: auto; list-style: none; }
    .scanner-ftp-item { display: flex; width: 100%; min-height: 44px; align-items: center; gap: var(--dana-space-2); padding: 0 var(--dana-space-3); text-align: left; }
    .scanner-ftp-item small { margin-left: auto; }
    .scanner-preview { max-width: 100%; max-height: 18rem; object-fit: contain; }
  `,
  template: `
    <gear-dialog
      [open]="open()"
      [dismissible]="!busy()"
      (openChange)="open.set($event)"
      [title]="scanner() ? 'Edit scanner ' + (scanner()?.ip ?? '') : 'Add scanner'"
      description="Network address, the lapper it reads parts for, and the serial numbers it last reported."
    >
      <form [formGroup]="form" (ngSubmit)="save()" id="scannerForm" class="gear-form-grid">
        <label class="gear-field">
          IP address
          <input
            class="gear-input"
            formControlName="ip"
            placeholder="10.16.80.68"
            inputmode="decimal"
          />
          @if (invalid('ip')) {
            <small class="gear-field-help" role="alert">Enter a valid IPv4 address.</small>
          }
        </label>
        <label class="gear-field">
          Model
          <input class="gear-input" formControlName="model" placeholder="SR-2000" />
        </label>
        <label class="gear-field">
          Type
          <input
            class="gear-input"
            formControlName="type"
            list="gear-scanner-types"
            placeholder="Barcode"
          />
          <datalist id="gear-scanner-types">
            @for (t of types; track t) {
              <option [value]="t"></option>
            }
          </datalist>
        </label>
        <label class="gear-field">
          Machine
          <select class="gear-select" formControlName="machine_id">
            <option [ngValue]="null">Not assigned</option>
            @for (m of machineOptions(); track m.id) {
              <option [ngValue]="m.id" [disabled]="m.taken">{{ m.label }}</option>
            }
          </select>
          <small class="gear-field-help"
            >A machine has one scanner; unassign the other one first.</small
          >
        </label>
        <label class="gear-field dana-field-full">
          Description
          <input class="gear-input" formControlName="description" placeholder="Cell 1 scanner" />
        </label>
        <label class="gear-field">
          In scanner
          <input class="gear-input" formControlName="sn_scanner" />
        </label>
        <label class="gear-field">
          In queue
          <input class="gear-input" formControlName="sn_queue" />
        </label>
        <label class="gear-field">
          In process
          <input class="gear-input" formControlName="sn_procces" />
          <small class="gear-field-help"
            >Serial numbers are normally written by the scanner collector.</small
          >
        </label>
        <div class="gear-field">
          <span>Status</span>
          <gear-segmented formControlName="status" [options]="statuses" ariaLabel="Status" />
        </div>
        <fieldset class="scanner-image dana-field-full">
          <legend>Image location</legend>
          <p class="gear-field-help">
            Where this scanner's captures are on the FTP drop. Leave both empty to use
            <code>{{ defaultFolder() }}/{{ defaultFile() }}</code>.
          </p>
          <div class="scanner-image-fields">
            <label class="gear-field">
              Image folder
              <input
                class="gear-input"
                formControlName="image_folder"
                [placeholder]="defaultFolder()"
                autocomplete="off"
              />
              @if (invalid('image_folder')) {
                <small class="gear-field-help" role="alert"
                  >Use a folder path without '..' or backslashes.</small
                >
              }
            </label>
            <label class="gear-field">
              Image file
              <input
                class="gear-input"
                formControlName="image_file"
                [placeholder]="defaultFile()"
                autocomplete="off"
              />
              @if (invalid('image_file')) {
                <small class="gear-field-help" role="alert"
                  >Use a .jpg, .jpeg or .bmp file name, without a folder.</small
                >
              }
            </label>
          </div>
          <div class="scanner-image-actions">
            <button
              type="button"
              class="gear-btn gear-btn-secondary"
              (click)="browsing() ? closeBrowser() : browse(form.controls.image_folder.value || null)"
              [attr.aria-expanded]="browsing()"
              aria-controls="scanner-ftp-browser"
            >
              {{ browsing() ? 'Close FTP browser' : 'Browse FTP…' }}
            </button>
            @if (scanner()) {
              <button type="button" class="gear-btn gear-btn-secondary" (click)="preview()" [disabled]="previewing()">
                {{ previewing() ? 'Loading image…' : 'Preview saved image' }}
              </button>
            }
          </div>
          @if (browsing()) {
            <div id="scanner-ftp-browser" class="scanner-ftp" aria-live="polite">
              <div class="scanner-ftp-path">
                <button type="button" class="gear-btn gear-btn-secondary" (click)="up()" [disabled]="!listing() || !parent()">
                  Up one folder
                </button>
                <code>{{ listing()?.path === '.' ? 'FTP home' : (listing()?.path ?? '…') }}</code>
                @if (listing(); as l) {
                  <button type="button" class="gear-btn gear-btn-secondary" (click)="useFolder(l.path)" [disabled]="l.path === '.'">
                    Use this folder
                  </button>
                }
              </div>
              @if (browseError()) {
                <p class="gear-alert gear-alert-danger" role="alert">{{ browseError() }}</p>
              } @else if (!listing()) {
                <p class="gear-field-help">Reading the FTP drop…</p>
              } @else {
                @if (!listing()!.folders.length && !listing()!.images.length) {
                  <p class="gear-field-help">This folder has no sub-folders or JPEG/BMP captures.</p>
                }
                <ul class="scanner-ftp-list">
                  @for (f of listing()!.folders; track f) {
                    <li>
                      <button type="button" class="scanner-ftp-item" (click)="browse(join(listing()!.path, f))">
                        <span aria-hidden="true">📁</span> {{ f }}
                      </button>
                    </li>
                  }
                  @for (img of listing()!.images; track img.name) {
                    <li>
                      <button
                        type="button"
                        class="scanner-ftp-item"
                        (click)="useImage(listing()!.path, img.name)"
                        [attr.aria-label]="'Use ' + img.name"
                      >
                        <span aria-hidden="true">🖼️</span> {{ img.name }}
                        <small>{{ img.modifiedAt ? (img.modifiedAt | date: 'short') : '' }}</small>
                      </button>
                    </li>
                  }
                </ul>
              }
            </div>
          }
          @if (previewError()) {
            <p class="gear-alert gear-alert-danger" role="alert">{{ previewError() }}</p>
          }
          @if (previewUrl(); as url) {
            <img class="scanner-preview" [src]="url" alt="Latest capture from this scanner (saved settings)" />
          }
        </fieldset>
        @if (error()) {
          <p class="gear-alert gear-alert-danger dana-field-full" role="alert">{{ error() }}</p>
        }
      </form>
      <ng-container dialogActions>
        <button type="button" class="gear-btn gear-btn-secondary" (click)="open.set(false)" [disabled]="busy()">
          Cancel
        </button>
        <button
          type="submit"
          form="scannerForm"
          class="gear-btn gear-btn-primary"
          [disabled]="form.invalid || busy()"
        >
          {{ busy() ? 'Saving…' : scanner() ? 'Save changes' : 'Add scanner' }}
        </button>
      </ng-container>
    </gear-dialog>
  `,
})
export class ScannerFormDialogComponent {
  private readonly api = inject(ScannerDetailsApi);
  private readonly scannerApi = inject(ScannerApi);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly scanner = input<ScannerDetail | null>(null);
  readonly machines = input<Machine[]>([]);
  readonly scanners = input<ScannerDetail[]>([]);
  readonly saved = output<ScannerDetail>();

  protected readonly busy = signal(false);
  protected readonly browsing = signal(false);
  protected readonly listing = signal<ScannerFtpListing | null>(null);
  protected readonly browseError = signal<string | null>(null);
  protected readonly previewing = signal(false);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly previewError = signal<string | null>(null);
  private browseRequest?: Subscription;
  /** The FTP root and image file name the API uses when a scanner sets none (learned on browse). */
  private readonly ftpDefaults = signal<{ root: string; file: string } | null>(null);
  private readonly ip = signal<string | null>(null);
  protected readonly defaultFolder = computed(
    () => `${this.ftpDefaults()?.root.replace(/\/+$/, '') ?? '<FTP root>'}/${this.ip() || '<scanner IP>'}`,
  );
  protected readonly defaultFile = computed(() => this.ftpDefaults()?.file ?? 'scanner-current.jpg');
  /** The folder above the listed one: its parent, `/`, or the FTP account's home folder (`.`). */
  protected readonly parent = computed(() => {
    const path = (this.listing()?.path ?? '').replace(/\/+$/, '');
    if (!path || path === '.' || path === '/') return null;
    const cut = path.lastIndexOf('/');
    return cut > 0 ? path.slice(0, cut) : cut === 0 ? '/' : '.';
  });
  protected readonly error = signal<string | null>(null);
  protected readonly types = SCANNER_TYPES;
  protected readonly statuses = STATUS_OPTIONS;

  /** Machines; ones another scanner already reads for can't be chosen (the API allows one each). */
  protected readonly machineOptions = computed(() => {
    const self = this.scanner()?.id;
    return [...this.machines()]
      .sort((a, b) => (a.number ?? a.ip).localeCompare(b.number ?? b.ip))
      .map((m) => {
        const other = this.scanners().find((s) => s.machine_id === m.id && s.id !== self);
        const name = `${m.number ?? m.ip}${m.cell ? ` · Cell ${m.cell}` : ''}`;
        return {
          id: m.id,
          taken: !!other,
          label: other ? `${name} — read by ${other.ip ?? 'another scanner'}` : name,
        };
      });
  });

  protected readonly form = new FormGroup({
    ip: new FormControl<string | null>(null, [
      Validators.required,
      Validators.pattern(IPV4_PATTERN),
    ]),
    model: new FormControl<string | null>(null),
    type: new FormControl<string | null>(null),
    description: new FormControl<string | null>(null),
    machine_id: new FormControl<string | null>(null),
    sn_scanner: new FormControl<string | null>(null),
    sn_queue: new FormControl<string | null>(null),
    sn_procces: new FormControl<string | null>(null),
    status: new FormControl('Active', { nonNullable: true, validators: [Validators.required] }),
    image_folder: new FormControl<string | null>(null, [Validators.maxLength(255), Validators.pattern(IMAGE_FOLDER)]),
    image_file: new FormControl<string | null>(null, [Validators.maxLength(128), Validators.pattern(IMAGE_FILE)]),
  });

  constructor() {
    effect(() => {
      const s = this.scanner();
      const isOpen = this.open();
      untracked(() => {
        this.error.set(null);
        if (!isOpen) return;
        this.form.reset({ status: 'Active' });
        if (s) this.form.patchValue(s);
        this.ip.set(this.form.controls.ip.value);
        this.closeBrowser();
        this.clearPreview();
      });
    });
    this.form.controls.ip.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ip) => this.ip.set(ip));
    this.destroyRef.onDestroy(() => {
      this.browseRequest?.unsubscribe();
      this.clearPreview();
    });
  }

  /** Lists one folder of the FTP drop; no path lists the configured root. */
  protected browse(path: string | null) {
    this.browsing.set(true);
    this.browseError.set(null);
    this.listing.set(null);
    this.browseRequest?.unsubscribe();
    this.browseRequest = this.scannerApi.browseFtp(path?.trim() || undefined).subscribe({
      next: (l) => {
        this.listing.set(l);
        this.ftpDefaults.set({ root: l.root, file: l.defaultImageFile });
      },
      error: (err) => this.browseError.set(apiErrorMessage(err)),
    });
  }

  protected closeBrowser() {
    this.browseRequest?.unsubscribe();
    this.browsing.set(false);
    this.listing.set(null);
    this.browseError.set(null);
  }

  protected up() {
    const parent = this.parent();
    if (parent) this.browse(parent);
  }

  protected join(folder: string, name: string) {
    return folder === '.' ? name : `${folder.replace(/\/+$/, '')}/${name}`;
  }

  protected useFolder(path: string) {
    this.form.controls.image_folder.setValue(path);
    this.form.controls.image_folder.markAsDirty();
    this.closeBrowser();
  }

  protected useImage(folder: string, file: string) {
    this.form.patchValue({ image_folder: folder, image_file: file });
    this.form.controls.image_folder.markAsDirty();
    this.form.controls.image_file.markAsDirty();
    this.closeBrowser();
  }

  /** Shows the latest capture for the saved scanner (its saved image folder and file). */
  protected preview() {
    const s = this.scanner();
    if (!s) return;
    this.previewing.set(true);
    this.previewError.set(null);
    this.scannerApi.image(s.id).subscribe({
      next: (blob) => {
        this.clearPreview();
        this.previewUrl.set(URL.createObjectURL(blob));
        this.previewing.set(false);
      },
      error: () => {
        this.previewing.set(false);
        this.previewError.set('No image could be read from the saved image location. Check the folder and file, save, then try again.');
      },
    });
  }

  private clearPreview() {
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
    this.previewUrl.set(null);
    this.previewError.set(null);
  }

  protected invalid(name: keyof typeof this.form.controls) {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  protected save() {
    if (this.busy()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    const blank = (x: string | null) => (x?.trim() ? x.trim() : null);
    const body = {
      ...v,
      model: blank(v.model),
      type: blank(v.type),
      description: blank(v.description),
      sn_scanner: blank(v.sn_scanner),
      sn_queue: blank(v.sn_queue),
      sn_procces: blank(v.sn_procces),
      image_folder: blank(v.image_folder)?.replace(/\/+$/, '') || null,
      image_file: blank(v.image_file),
    };
    const existing = this.scanner();
    const req = existing ? this.api.update(existing.id, body) : this.api.create(body);
    req.subscribe({
      next: (s) => {
        this.busy.set(false);
        this.saved.emit(s);
        this.open.set(false);
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(err));
      },
    });
  }
}
