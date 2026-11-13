import { AfterInsert, AfterLoad, AfterUpdate, Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { VisitDocument } from './visit-document.entity';
import { VisitEvent } from './visit-event.entity';
import { formatVisitReference, type TruckDirection, type VisitStatus } from '@truck-log/shared/contracts';
@Entity({ name: 'truck_visits' })
export class TruckVisit {
    @PrimaryGeneratedColumn({ type: 'int' })
    id!: number;
    visitReference!: string;
    @Column({ name: 'visit_number', type: 'varchar', length: 80, unique: true })
    visitNumber!: string;
    @AfterLoad()
    @AfterInsert()
    @AfterUpdate()
    private hydrateVisitReference() {
        this.visitReference = formatVisitReference(this.id);
    }
    @Column({ name: 'load_number', type: 'varchar', length: 120 })
    loadNumber!: string;
    @Column({ type: 'varchar', length: 20 })
    direction!: TruckDirection;
    @Column({ name: 'carrier_id', type: 'int', nullable: true })
    carrierId!: number | null;
    @Column({ name: 'carrier_name', type: 'varchar', length: 200 })
    carrierName!: string;
    @Column({ name: 'driver_id', type: 'int', nullable: true })
    driverId!: number | null;
    @Column({ name: 'driver_name', type: 'varchar', length: 200 })
    driverName!: string;
    @Column({ name: 'driver_phone', type: 'varchar', length: 50, nullable: true })
    driverPhone!: string | null;
    @Column({ name: 'tractor_id', type: 'varchar', length: 100, nullable: true })
    tractorId!: string | null;
    @Column({ name: 'trailer_id', type: 'varchar', length: 100 })
    trailerId!: string;
    @Column({ name: 'is_drop_trailer', type: 'boolean', default: false })
    isDropTrailer!: boolean;
    @Column({ name: 'origin_location_id', type: 'int', nullable: true })
    originLocationId!: number | null;
    @Column({ name: 'origin_name', type: 'varchar', length: 250, nullable: true })
    originName!: string | null;
    @Column({ name: 'destination_location_id', type: 'int', nullable: true })
    destinationLocationId!: number | null;
    @Column({ name: 'destination_name', type: 'varchar', length: 250, nullable: true })
    destinationName!: string | null;
    @Column({ name: 'dock_code', type: 'varchar', length: 50 })
    dockCode!: string;
    @Column({ type: 'text', nullable: true })
    notes!: string | null;
    @Column({ type: 'varchar', length: 40 })
    status!: VisitStatus;
    @Column({ name: 'document_folder_key', type: 'varchar', length: 500 })
    documentFolderKey!: string;
    @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
    scheduledAt!: Date | null;
    @Column({ name: 'rxo_site_key', type: 'varchar', length: 80, nullable: true })
    rxoSiteKey!: string | null;
    @Column({ name: 'rxo_shipment_id', type: 'varchar', length: 120, nullable: true })
    rxoShipmentId!: string | null;
    @Column({ name: 'rxo_direction', type: 'varchar', length: 20, nullable: true })
    rxoDirection!: TruckDirection | null;
    @Column({ name: 'client_request_id', type: 'uuid', nullable: true, select: false })
    clientRequestId!: string | null;
    @Column({ name: 'manual_printing', type: 'boolean', default: false })
    manualPrinting!: boolean;
    @Column({ name: 'guard_check_in_at', type: 'timestamptz' })
    guardCheckInAt!: Date;
    @Column({ name: 'dock_assigned_at', type: 'timestamptz', nullable: true })
    dockAssignedAt!: Date | null;
    @Column({ name: 'dock_completed_at', type: 'timestamptz', nullable: true })
    dockCompletedAt!: Date | null;
    @Column({ name: 'guard_check_out_at', type: 'timestamptz', nullable: true })
    guardCheckOutAt!: Date | null;
    @Column({ name: 'created_by', type: 'varchar', length: 120, nullable: true })
    createdBy!: string | null;
    @Column({ name: 'updated_by', type: 'varchar', length: 120, nullable: true })
    updatedBy!: string | null;
    @Column({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;
    @Column({ name: 'updated_at', type: 'timestamptz' })
    updatedAt!: Date;
    @OneToMany(() => VisitDocument, (document) => document.visit)
    documents!: VisitDocument[];
    @OneToMany(() => VisitEvent, (event) => event.visit)
    events!: VisitEvent[];
    /** Response projection from visit_events; deliberately not a database column. */
    scannedDeliveryNumbers?: string[];
    /** Response projection counted from visit_documents; deliberately not a database column. */
    documentCount?: number;
}
