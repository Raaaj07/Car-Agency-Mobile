import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RideEntity } from '../rides/entities/ride.entity';
import { PROMOS_CONFIG, PromoConfig } from './promos.config';

@Injectable()
export class PromosService {
  constructor(
    @InjectRepository(RideEntity)
    private readonly rides: Repository<RideEntity>,
  ) {}

  private findPromo(code: string): PromoConfig | undefined {
    const normalized = code.trim().toUpperCase();
    return PROMOS_CONFIG.find((p) => p.code === normalized);
  }

  /**
   * Pure helper — looks up the discount amount for a code without eligibility check.
   * Used when completing a ride (the ride.promoCode is already persisted).
   */
  discountFor(code: string): number {
    const promo = this.findPromo(code);
    return promo?.discountAmount ?? 0;
  }

  /**
   * Validates eligibility and returns the discount amount.
   * Throws BadRequestException for unknown or ineligible codes.
   */
  async resolveDiscount(code: string, riderId: string): Promise<number> {
    const promo = this.findPromo(code);
    if (!promo) {
      throw new BadRequestException(`Promo code "${code}" is not valid.`);
    }
    if (promo.firstRideOnly) {
      const completedCount = await this.rides.count({
        where: { riderId, status: 'completed' },
      });
      if (completedCount > 0) {
        throw new BadRequestException(`Promo code "${code}" is only valid for your first ride.`);
      }
    }
    return promo.discountAmount;
  }

  async getActivePromos(riderId: string): Promise<PromoConfig[]> {
    const completedCount = await this.rides.count({
      where: { riderId, status: 'completed' },
    });
    return PROMOS_CONFIG.filter((p) => {
      if (p.firstRideOnly && completedCount > 0) return false;
      return true;
    });
  }

  async validate(code: string, riderId: string): Promise<{ valid: boolean; discountAmount: number; message: string }> {
    try {
      const amount = await this.resolveDiscount(code, riderId);
      return { valid: true, discountAmount: amount, message: `Code applied! You save Rs ${amount}.` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid promo code.';
      return { valid: false, discountAmount: 0, message: msg };
    }
  }
}
