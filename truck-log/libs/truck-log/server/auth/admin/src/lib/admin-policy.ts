import { SetMetadata } from '@nestjs/common';
export const ADMIN_WRITE_METADATA = 'truck-log-admin-writes';
/** Every unsafe HTTP method in the marked administrative controller requires a Truck Log Admin session. */
export const TruckLogAdminWrites = () => SetMetadata(ADMIN_WRITE_METADATA, true);
