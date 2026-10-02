import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { DriverEntity } from '../entities/driver.entity';

/**
 * Driver permission comes from the database row (status === 'approved'),
 * never from the JWT role claim (which is stale for up to 15 minutes).
 * Use after JwtAuthGuard on every driver-only endpoint/event.
 */
@Injectable()
export class ApprovedDriverGuard implements CanActivate {
  constructor(@InjectRepository(DriverEntity) private readonly drivers: Repository<DriverEntity>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const type = context.getType<'http' | 'ws'>();
    const user: AuthenticatedUser =
      type === 'ws'
        ? (context.switchToWs().getClient() as any)?.data
        : context.switchToHttp().getRequest()?.user;
    const userId = (user as any)?.userId ?? (user as any)?.sub;
    if (!userId) throw new ForbiddenException('Not authenticated');
    const driver = await this.drivers.findOne({ where: { userId } }).catch(() => null);
    if (!driver || (driver as any).status !== 'approved') {
      throw new ForbiddenException('Driver access requires an approved application');
    }
    return true;
  }
}
