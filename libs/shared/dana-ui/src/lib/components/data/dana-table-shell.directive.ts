import { Directive, HostBinding } from '@angular/core';

@Directive({
  selector: '[danaTableShell]',
  standalone: true,
})
export class DanaTableShellDirective {
  @HostBinding('class.dana-table-shell') readonly hostClass = true;
}
