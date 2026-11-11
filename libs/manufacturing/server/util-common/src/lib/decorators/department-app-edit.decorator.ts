import { MeshForgeAppKey } from '@meshforge/manufacturing/shared/util-constants';
import { SetMetadata } from '@nestjs/common';
import { MESHFORGE_APP_EDIT_METADATA_KEY } from '../constants';

/**
 * Marks an operational mutation with the application whose department policy
 * applies. RolesGuard enforces this after JwtAccessTokenGuard has populated
 * request.user, so authentication/authorization ordering is deterministic.
 */
export function DepartmentAppEdit(app: MeshForgeAppKey): MethodDecorator {
  return SetMetadata(MESHFORGE_APP_EDIT_METADATA_KEY, app);
}
