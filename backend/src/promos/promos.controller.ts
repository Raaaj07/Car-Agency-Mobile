import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PromosService } from './promos.service';
import { ValidatePromoDto } from './dto/validate-promo.dto';

// Authentication is global (SEC-1 default-deny); only the role check stays.
@UseGuards(RolesGuard)
@Roles('rider')
@Controller('promos')
export class PromosController {
  constructor(private readonly service: PromosService) {}

  @Get('active')
  async getActive(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getActivePromos(user.userId);
  }

  // Route throttle: 10/min — codes are short and valuable, so guessing one
  // must not be a volume game (the global 300/min is far too generous here).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('validate')
  validate(@CurrentUser() user: AuthenticatedUser, @Body() dto: ValidatePromoDto) {
    return this.service.validate(dto.code, user.userId);
  }
}
