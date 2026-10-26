import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { PromosService } from './promos.service';
import { PromoAdminDto } from './dto/promo-admin.dto';

/**
 * PR-1 (Task 8): admin CRUD for promo codes, mounted under /admin/promos and
 * guarded like the rest of the admin console (JWT + admin role). The admin
 * promo screen (Account → Promo codes) drives these. Authentication itself is
 * now global (SEC-1 default-deny); only the admin-role check stays here.
 * Task 12: Every mutating admin endpoint writes an audit row to admin_audit_logs.
 */
@UseGuards(RolesGuard)
@Roles('admin')
@Controller('admin/promos')
export class AdminPromosController {
  constructor(private readonly service: PromosService) {}

  /** GET /admin/promos — every promo (active or not), newest first. */
  @Get()
  list() {
    return this.service.listAdmin();
  }

  /** POST /admin/promos — create (409 on a duplicate code). Writes audit row. */
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: PromoAdminDto) {
    return this.service.createPromo(dto, user.userId);
  }

  /** PATCH /admin/promos/:id — edit; null clears copy/validity fields. Writes audit row. */
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PromoAdminDto,
  ) {
    return this.service.updatePromo(id, dto, user.userId);
  }

  /** DELETE /admin/promos/:id — redemption history survives (SET NULL). Writes audit row. */
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.removePromo(id, user.userId);
  }
}
