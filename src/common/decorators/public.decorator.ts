import { SetMetadata } from '@nestjs/common';

/** Tandai endpoint publik agar JwtAuthGuard global melewatkannya. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
