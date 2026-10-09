import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

/**
 * SEC-1: registered as a global APP_GUARD (after ThrottlerGuard) so every
 * route requires authentication unless explicitly marked @Public(). Reading
 * the metadata here means a new controller added later is protected without
 * anyone remembering to add a decorator — the failure mode flips from
 * "forgot the guard = open to the world" to "forgot @Public = 401".
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return Promise.resolve(true);
    return super.canActivate(context) as Promise<boolean>;
  }
}
