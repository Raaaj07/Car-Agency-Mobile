import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminService } from './admin.service';
import { ReviewApplicationDto } from './dto/review-application.dto';
import { ListApplicationsQueryDto } from './dto/list-applications-query.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('driver-applications')
  list(@Query() query: ListApplicationsQueryDto) {
    return this.admin.listApplications(query.status, query.page, query.limit);
  }

  @Get('driver-applications/:id')
  getOne(@Param('id') id: string) {
    return this.admin.getApplication(id);
  }

  @Post('driver-applications/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.admin.approve(id, user.userId);
  }

  @Post('driver-applications/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReviewApplicationDto) {
    return this.admin.reject(id, user.userId, dto.reason);
  }

  @Post('drivers/:id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.admin.suspend(id, user.userId);
  }

  @Post('drivers/:id/reinstate')
  @HttpCode(HttpStatus.OK)
  reinstate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.admin.reinstate(id, user.userId);
  }

  // Authenticated document access (admins only). Returns JSON base64 so the
  // Expo client can render without custom image headers; set ?raw=1 for bytes.
  @Get('files/:applicationId/:kind')
  async getFile(
    @Param('applicationId') applicationId: string,
    @Param('kind') kind: string,
    @Query('raw') raw: string | undefined,
    @Res() res: Response,
  ) {
    const doc = await this.admin.readDocument(applicationId, kind);
    if (raw === '1') {
      res.setHeader('Content-Type', doc.mime);
      res.send(doc.buffer);
      return;
    }
    res.json({ mime: doc.mime, base64: doc.buffer.toString('base64') });
  }
}
