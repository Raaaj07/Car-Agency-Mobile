import { Body, Controller, HttpCode, HttpStatus, Post, RawBodyRequest, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateOrderDto } from './dto/create-order.dto';
import { RazorpayWebhookDto } from './dto/razorpay-webhook.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { PaymentsService } from './payments.service';

// Authentication is global (SEC-1 default-deny). Any authenticated user; the
// service verifies ride ownership (rider side).
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // PaymentFareBreakdownScreen's checkout step.
  // Pass-4 (task 5): payment state changes get the same per-route budget as
  // the other mutations (10/min) — a scripted client cannot hammer checkout.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('create-order')
  @HttpCode(HttpStatus.OK)
  createOrder(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto) {
    return this.payments.createOrder(user.userId, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyPaymentDto) {
    return this.payments.verify(user.userId, dto);
  }

  // Pass-4 (task 5): Razorpay → us. Unauthenticated by design — the HMAC
  // signature over the RAW body (req.rawBody, NestFactory rawBody: true) IS
  // the authentication. Per-IP 60/min so a flood of forged deliveries cannot
  // queue work behind the signature check.
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('webhook/razorpay')
  @HttpCode(HttpStatus.OK)
  razorpayWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() dto: RazorpayWebhookDto,
  ): Promise<{ received: true }> {
    const raw = req.headers['x-razorpay-signature'];
    return this.payments.handleRazorpayWebhook(
      req.rawBody,
      Array.isArray(raw) ? raw[0] : raw,
      dto,
    );
  }
}
