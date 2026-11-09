import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route (or whole controller) as not requiring a JWT. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
