import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { CoaterAvailableContainer, CoaterPackingSlip, CoaterShipment, CoaterShipmentList } from '@meshforge/manufacturing/shared/util-types';

@Injectable({ providedIn: 'root' })
export class CoaterShipmentsApiService {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/v1/coater-shipments';
  list(tab: string, q: string, page: number) { return this.http.get<CoaterShipmentList>(this.url,{params:{tab,q,page}}); }
  available(id: string,q = '') { return this.http.get<CoaterAvailableContainer[]>(`${this.url}/${id}/available-containers`,{params:{q}}); }
  get(id: string) { return this.http.get<CoaterShipment>(`${this.url}/${id}`); }
  create(request_id: string,destination: string,notes: string) { return this.http.post<CoaterShipment>(this.url,{request_id,destination,notes}); }
  update(s: CoaterShipment,destination: string,notes: string) { return this.http.post<CoaterShipment>(`${this.url}/${s.id}/details`,{revision:s.revision,destination,notes}); }
  add(s: CoaterShipment,serial: string) { return this.http.post<CoaterShipment>(`${this.url}/${s.id}/containers`,{revision:s.revision,serial}); }
  remove(s: CoaterShipment,id: string) { return this.http.post<CoaterShipment>(`${this.url}/${s.id}/containers/${id}/remove`,{revision:s.revision}); }
  review(s: CoaterShipment) { return this.http.post<CoaterShipment>(`${this.url}/${s.id}/review`,{revision:s.revision}); }
  print(s: CoaterShipment) { return this.http.post<CoaterPackingSlip>(`${this.url}/${s.id}/print`,{revision:s.revision}); }
  labels(s: CoaterShipment) { return this.http.post<CoaterPackingSlip>(`${this.url}/${s.id}/labels`,{revision:s.revision}); }
  prepareRpa(s: CoaterShipment, po: string) { return this.http.post<CoaterShipment>(`${this.url}/${s.id}/rpa`,{revision:s.revision,po:po.trim() || undefined}); }
  rpaWorkbook(s: CoaterShipment) { return this.http.get(`${this.url}/${s.id}/rpa/${s.revision}/workbook`,{responseType:'blob'}); }
  emailRpa(s: CoaterShipment) { return this.http.post<CoaterShipment>(`${this.url}/${s.id}/rpa/email`,{revision:s.revision}); }
  dispatch(s: CoaterShipment) { return this.http.post<CoaterShipment>(`${this.url}/${s.id}/dispatch`,{revision:s.revision,printed_and_checked:true}); }
  cancel(s: CoaterShipment,reason: string) { return this.http.post<CoaterShipment>(`${this.url}/${s.id}/cancel`,{revision:s.revision,reason}); }
}
