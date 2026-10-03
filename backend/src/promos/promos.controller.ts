import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PromosService } from './promos.service';
import { ValidatePromoDto } from './dto/validate-promo.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('rider')
@Controller('promos')
export class PromosController {
  constructor(private readonly service: PromosService) {}

  @Get('active')
  async getActive(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getActivePromos(user.userId);
  }

  @Post('validate')
  validate(@CurrentUser() user: AuthenticatedUser, @Body() dto: ValidatePromoDto) {
    return this.service.validate(dto.code, user.userId);
  }
}
