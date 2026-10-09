import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { PromosService } from './promos.service';
import { PromoAdminDto } from './dto/promo-admin.dto';

/**
 * PR-1 (Task 8): admin CRUD for promo codes, mounted under /admin/promos and
 * guarded like the rest of the admin console (JWT + admin role). The admin
 * promo screen (Account → Promo codes) drives these. Authentication itself is
 * now global (SEC-1 default-deny); only the admin-role check stays here.
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

  /** POST /admin/promos — create (409 on a duplicate code). */
  @Post()
  create(@Body() dto: PromoAdminDto) {
    return this.service.createPromo(dto);
  }

  /** PATCH /admin/promos/:id — edit; null clears copy/validity fields. */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: PromoAdminDto) {
    return this.service.updatePromo(id, dto);
  }

  /** DELETE /admin/promos/:id — redemption history survives (SET NULL). */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.removePromo(id);
  }
}
