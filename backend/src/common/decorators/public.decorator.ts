import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * SEC-1: routes are private by default — the global JwtAuthGuard (app.module
 * APP_GUARD) rejects every request without a valid bearer token unless the
 * handler or its controller opts out with @Public(). Auth flows (OTP, token
 * refresh, social sign-in) and header-less asset streams (React Native
 * <Image> cannot send Authorization) are the only legitimate public surface.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
