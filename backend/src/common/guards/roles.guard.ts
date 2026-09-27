import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Array<'rider' | 'driver'>) => SetMetadata(ROLES_KEY, roles);

// Use after JwtAuthGuard. Matches RoleSelectionScreen's rider/driver split —
// a rider token can't hit driver-only routes and vice versa.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Array<'rider' | 'driver'>>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;
    return !!user?.role && required.includes(user.role);
  }
}
