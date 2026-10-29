import { Controller, Get } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DriverStatsService } from './driver-stats.service';

// Lives in the rides module (it needs ride history); the path is under
// /drivers so the app keeps one namespace. Not guarded by ApprovedDriverGuard
// on purpose: a suspended/pending driver should still see WHY they are offline.
@Controller('drivers/me')
export class DriverStatsController {
  constructor(private readonly stats: DriverStatsService) {}

  @Get('stats')
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.stats.forUser(user.userId);
  }
}
