import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { AdminService } from './admin.service';
import { ReviewApplicationDto } from './dto/review-application.dto';
import { SuspendDriverDto } from './dto/suspend-driver.dto';
import { ReinstateDriverDto } from './dto/reinstate-driver.dto';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { ResolvePaymentDto } from './dto/resolve-payment.dto';
import { ListApplicationsQueryDto } from './dto/list-applications-query.dto';
import { ListRidesQueryDto } from './dto/list-rides-query.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { AuditQueryDto } from './dto/audit-query.dto';

// Authentication is global (SEC-1 default-deny); only the admin-role check
// stays.
@UseGuards(RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // Dashboard (day boundaries in APP_TIMEZONE, attention lists, activity).
  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  // Task 9: user management list (name/phone/email search, role filter).
  @Get('users')
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.admin.listUsers({
      q: query.q,
      role: query.role,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('driver-applications')
  list(@Query() query: ListApplicationsQueryDto) {
    return this.admin.listApplications(query.status, query.page, query.limit, {
      q: query.q,
      sort: query.sort,
    });
  }

  // Declared before ':id' so "counts" never becomes an application id.
  @Get('driver-applications/counts')
  counts() {
    return this.admin.listApplicationCounts();
  }

  @Get('driver-applications/:id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getApplication(id);
  }

  // Full driver console detail: application + stats + last rides + history.
  @Get('drivers/:id')
  driverDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getDriverDetail(id);
  }

  // Admin console "Rides" tab: filters (status/payment/date/search) + paging.
  @Get('rides')
  listRides(@Query() query: ListRidesQueryDto) {
    return this.admin.listRides({
      status: query.status,
      paymentStatus: query.paymentStatus,
      from: query.from,
      to: query.to,
      q: query.q,
      driverId: query.driverId,
      riderId: query.riderId,
      page: query.page,
      limit: query.limit,
    });
  }

  // Task 9: CSV export of the same filtered set as GET /admin/rides.
  // Declared before ':id' so "export.csv" never becomes a ride id (same
  // trick as driver-applications/counts above).
  @Get('rides/export.csv')
  exportRidesCsv(
    @Query() query: ListRidesQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.admin
      .exportRidesCsv({
        status: query.status,
        paymentStatus: query.paymentStatus,
        from: query.from,
        to: query.to,
        q: query.q,
        driverId: query.driverId,
        riderId: query.riderId,
      })
      .then(({ filename, csv, truncated }) => {
        res.set({
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          // true when the 5 000-row cap cut the result short: narrow the filters.
          'X-Export-Truncated': String(truncated),
        });
        return csv;
      });
  }

  // Ride timeline + fare + payment rows + audited admin actions.
  @Get('rides/:id')
  rideDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getRideDetail(id);
  }

  @Post('rides/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelRide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelRideDto,
  ) {
    return this.admin.adminCancelRide(id, user.userId, dto.reason);
  }

  @Post('rides/:id/payment')
  @HttpCode(HttpStatus.OK)
  resolvePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolvePaymentDto,
  ) {
    return this.admin.resolvePayment(id, user.userId, dto.status, dto.note);
  }

  // Paginated audit trail (overview "recent activity" can use it too).
  @Get('audit')
  audit(@Query() query: AuditQueryDto) {
    return this.admin.auditList(query);
  }

  @Post('driver-applications/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.approve(id, user.userId);
  }

  @Post('driver-applications/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewApplicationDto) {
    return this.admin.reject(id, user.userId, dto.reason);
  }

  @Post('drivers/:id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SuspendDriverDto) {
    return this.admin.suspend(id, user.userId, { reason: dto.reason, force: dto?.force === true });
  }

  @Post('drivers/:id/reinstate')
  @HttpCode(HttpStatus.OK)
  reinstate(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReinstateDriverDto) {
    return this.admin.reinstate(id, user.userId, { reason: dto?.reason });
  }

  // All documents of one application with fresh, short-lived signed URLs.
  // This is the endpoint a web admin dashboard should call.
  @Get('driver-applications/:id/documents')
  documents(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.admin.listDocuments(id);
  }

  // Single document (admins only). Cloudinary-hosted docs return a short-lived
  // signed URL: { mime, url, expiresAt }. Legacy local files still return
  // { mime, base64 }. ?raw=1 -> 302 to the signed URL (or raw bytes for legacy).
  @Get('files/:applicationId/:kind')
  async getFile(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('kind') kind: string,
    @Query('raw') raw: string | undefined,
    @Res() res: Response,
  ) {
    const doc = await this.admin.getDocument(applicationId, kind);
    res.setHeader('Cache-Control', 'no-store');
    if (doc.type === 'url') {
      if (raw === '1') {
        res.redirect(doc.url);
        return;
      }
      res.json({ mime: doc.mime, url: doc.url, expiresAt: doc.expiresAt || null });
      return;
    }
    if (raw === '1') {
      res.setHeader('Content-Type', doc.mime);
      res.send(doc.buffer);
      return;
    }
    res.json({ mime: doc.mime, base64: doc.buffer.toString('base64') });
  }
}
