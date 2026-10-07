import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApprovedDriverGuard } from '../drivers/guards/approved-driver.guard';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { CompleteRideDto } from './dto/complete-ride.dto';
import { CreateRideDto } from './dto/create-ride.dto';
import { ListRidesQueryDto } from './dto/list-rides-query.dto';
import { SubmitReviewDto } from './dto/submit-review.dto';
import { VerifyPickupOtpDto } from './dto/verify-pickup-otp.dto';
import { RidesService } from './rides.service';

@UseGuards(JwtAuthGuard)
@Controller('rides')
export class RidesController {
  constructor(private readonly rides: RidesService) {}

  // Vehicle Selection -> Ride Details -> "Book". Any authenticated user; the
  // service rejects double-booking and online-driver booking.
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRideDto) {
    return this.rides.create(user.userId, dto);
  }

  // R-1: "Retry" when the search came back with no drivers — re-runs the
  // match immediately instead of waiting out the server search window.
  @Post(':id/rematch')
  rematch(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.rides.rematch(id, user.userId);
  }

  // My Rides tab. ?as=rider|driver selects the side for unified accounts.
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListRidesQueryDto) {
    return this.rides.list(user.userId, user.role ?? 'rider', query.page, query.limit, query.as);
  }

  // Matches driver reconnect / app opening to fetch active offer (approved only).
  @UseGuards(ApprovedDriverGuard)
  @Get('offers/pending')
  getPendingOffer(@CurrentUser() user: AuthenticatedUser) {
    return this.rides.getPendingOffer(user.userId);
  }

  // Rider's current active ride (for app-restart restore). Declared BEFORE
  // ':id' so 'active' is not treated as an id.
  @Get('active')
  getActive(@CurrentUser() user: AuthenticatedUser) {
    return this.rides.findActiveForRider(user.userId);
  }

  // Driver's in-flight trip (matched / en route / in progress / awaiting
  // payment confirmation) so the driver app can resume it after a restart or
  // back-navigation. Two path segments, so it never collides with ':id'.
  @UseGuards(ApprovedDriverGuard)
  @Get('driver/active')
  getDriverActive(@CurrentUser() user: AuthenticatedUser) {
    return this.rides.findActiveForDriver(user.userId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.rides.findById(id, user.userId);
  }

  // RideRequestNearbyScreen's "Accept Ride" (approved only).
  @UseGuards(ApprovedDriverGuard)
  @Patch(':id/accept')
  accept(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.rides.accept(id, user.userId);
  }

  // RideRequestNearbyScreen's "Decline" / 15s timeout (approved only).
  @UseGuards(ApprovedDriverGuard)
  @Patch(':id/decline')
  decline(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.rides.decline(id, user.userId);
  }

  // TurnByTurnNavigationScreen: driver begins heading to pickup (approved only).
  @UseGuards(ApprovedDriverGuard)
  @Patch(':id/en-route')
  enRoute(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.rides.markEnRoute(id, user.userId);
  }

  // DriverEnRouteScreen's "Driver Arrived (Start)" (approved only).
  @UseGuards(ApprovedDriverGuard)
  @Patch(':id/start')
  start(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.rides.start(id, user.userId);
  }

  // OTP the driver enters from the rider's YouGotTheRideScreen code (approved only).
  @UseGuards(ApprovedDriverGuard)
  @Patch(':id/verify-pickup-otp')
  verifyPickupOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: VerifyPickupOtpDto,
  ) {
    return this.rides.verifyPickupOtp(id, user.userId, dto);
  }

  // Trip end -> PaymentFareBreakdownScreen's numbers (approved only).
  @UseGuards(ApprovedDriverGuard)
  @Patch(':id/complete')
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CompleteRideDto) {
    return this.rides.complete(id, user.userId, dto);
  }

  // DriverPaymentScreen's "Amount Received" after the rider pays the UPI QR
  // (approved driver who owns the ride; ride must be completed).
  @UseGuards(ApprovedDriverGuard)
  @Patch(':id/payment-received')
  paymentReceived(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.rides.markPaymentReceived(id, user.userId);
  }

  // CancelRideConfirmationScreen (either party can cancel).
  @Patch(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CancelRideDto) {
    return this.rides.cancel(id, user.userId, user.role ?? 'rider', dto);
  }

  // ReviewRideScreen's onSubmitReview (ownership checked in service).
  @Patch(':id/review')
  review(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SubmitReviewDto) {
    return this.rides.submitReview(id, user.userId, dto);
  }
}
