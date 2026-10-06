import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { RideEntity } from '../rides/entities/ride.entity';
import { PromoEntity } from './entities/promo.entity';
import { PromoRedemptionEntity } from './entities/promo-redemption.entity';
import { PromoAdminDto } from './dto/promo-admin.dto';

/**
 * Rider-facing card shape — identical to the old PROMOS_CONFIG objects so the
 * frontend `Promo` interface (PromoCarousel, rideStore) stays unchanged.
 */
export interface PromoCard {
  code: string;
  title: string;
  subtitle: string;
  cta: string;
  discountAmount: number;
  firstRideOnly: boolean;
}

/** Postgres unique-violation (SQLSTATE 23505) from concurrent admin saves. */
function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; driverError?: { code?: string } };
  return err?.code === '23505' || err?.driverError?.code === '23505';
}

/**
 * PR-1 (Task 8): promos are DB rows (admin CRUD) instead of PROMOS_CONFIG.
 *  - `discountFor` is async now (honours the code persisted on the ride even
 *    if the promo was deactivated since; a deleted promo yields 0).
 *  - `resolveDiscount` enforces active/window/cap/first-ride at booking.
 *  - `recordRedemption` runs inside the completion's ride-lock transaction so
 *    the discount, the redemption row and the cap counter move together.
 */
@Injectable()
export class PromosService {
  constructor(
    @InjectRepository(RideEntity)
    private readonly rides: Repository<RideEntity>,
    @InjectRepository(PromoEntity)
    private readonly promos: Repository<PromoEntity>,
  ) {}

  private normalize(code: string): string {
    return code.trim().toUpperCase();
  }

  /** Active flag + validity window + redemption cap (no rider-specific checks). */
  isRedeemable(promo: PromoEntity, now = new Date()): boolean {
    if (!promo.active) return false;
    if (promo.validFrom && now < promo.validFrom) return false;
    if (promo.validTo && now > promo.validTo) return false;
    if (promo.maxRedemptions != null && promo.redemptionCount >= promo.maxRedemptions) return false;
    return true;
  }

  /** Card copy with a composed default when the admin left fields empty. */
  private toCard(promo: PromoEntity): PromoCard {
    return {
      code: promo.code,
      title: promo.title ?? `Rs ${promo.discountAmount} off your ride`,
      subtitle: promo.subtitle ?? `Tap to apply code ${promo.code}`,
      cta: promo.cta ?? 'Apply',
      discountAmount: promo.discountAmount,
      firstRideOnly: promo.firstRideOnly,
    };
  }

  private assertWindow(validFrom: Date | null, validTo: Date | null): void {
    if (validFrom && validTo && validFrom.getTime() >= validTo.getTime()) {
      throw new BadRequestException('validFrom must be before validTo');
    }
  }

  private async saveGuarded(promo: PromoEntity): Promise<PromoEntity> {
    try {
      return await this.promos.save(promo);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(`Promo code "${promo.code}" already exists.`);
      }
      throw e;
    }
  }

  /**
   * Discount for a code already persisted on the ride (completion path).
   * No eligibility re-check: what was promised at booking is honoured even if
   * the promo has since been deactivated; a deleted promo yields 0.
   */
  async discountFor(code: string): Promise<number> {
    const promo = await this.promos.findOne({ where: { code: this.normalize(code) } });
    return promo?.discountAmount ?? 0;
  }

  /**
   * Validates eligibility and returns the discount amount.
   * Throws BadRequestException for unknown or ineligible codes.
   */
  async resolveDiscount(code: string, riderId: string): Promise<number> {
    const promo = await this.promos.findOne({ where: { code: this.normalize(code) } });
    if (!promo) {
      throw new BadRequestException(`Promo code "${code}" is not valid.`);
    }
    const now = new Date();
    if (promo.validFrom && now < promo.validFrom) {
      throw new BadRequestException(`Promo code "${code}" is not active yet.`);
    }
    if (!promo.active) {
      throw new BadRequestException(`Promo code "${code}" is no longer active.`);
    }
    if (promo.validTo && now > promo.validTo) {
      throw new BadRequestException(`Promo code "${code}" has expired.`);
    }
    if (promo.maxRedemptions != null && promo.redemptionCount >= promo.maxRedemptions) {
      throw new BadRequestException(`Promo code "${code}" has reached its redemption limit.`);
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

  async getActivePromos(riderId: string): Promise<PromoCard[]> {
    const [promos, completedCount] = await Promise.all([
      this.promos.find({ order: { createdAt: 'ASC' } }),
      this.rides.count({ where: { riderId, status: 'completed' } }),
    ]);
    return promos
      .filter((p) => {
        if (!this.isRedeemable(p)) return false;
        if (p.firstRideOnly && completedCount > 0) return false;
        return true;
      })
      .map((p) => this.toCard(p));
  }

  async validate(
    code: string,
    riderId: string,
  ): Promise<{ valid: boolean; discountAmount: number; message: string }> {
    try {
      const amount = await this.resolveDiscount(code, riderId);
      return { valid: true, discountAmount: amount, message: `Code applied! You save Rs ${amount}.` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid promo code.';
      return { valid: false, discountAmount: 0, message: msg };
    }
  }

  /**
   * Records the redemption atomically with ride completion — pass the
   * completion's transaction `manager` so the row insert and the cap counter
   * commit (or roll back) together with the fare write. Best-effort by
   * contract: a promo deleted since booking just isn't counted.
   */
  async recordRedemption(
    code: string,
    rideId: string,
    riderId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const em = manager ?? this.promos.manager;
    const promo = await em.findOne(PromoEntity, { where: { code: this.normalize(code) } });
    if (!promo) return;
    await em.insert(PromoRedemptionEntity, {
      promoId: promo.id,
      code: promo.code,
      rideId,
      riderId,
      discountAmount: promo.discountAmount,
    });
    await em.increment(PromoEntity, { id: promo.id }, 'redemptionCount', 1);
  }

  // ── Admin CRUD (AdminPromosController) ──

  async listAdmin(): Promise<PromoEntity[]> {
    return this.promos.find({ order: { createdAt: 'DESC' } });
  }

  async createPromo(dto: PromoAdminDto): Promise<PromoEntity> {
    const code = this.normalize(dto.code);
    const clash = await this.promos.findOne({ where: { code } });
    if (clash) throw new ConflictException(`Promo code "${code}" already exists.`);
    const validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    const validTo = dto.validTo ? new Date(dto.validTo) : null;
    this.assertWindow(validFrom, validTo);
    const promo = this.promos.create({
      code,
      title: dto.title ?? null,
      subtitle: dto.subtitle ?? null,
      cta: dto.cta ?? null,
      discountAmount: dto.discountAmount,
      firstRideOnly: dto.firstRideOnly ?? false,
      active: dto.active ?? true,
      validFrom,
      validTo,
      maxRedemptions: dto.maxRedemptions ?? null,
    });
    return this.saveGuarded(promo);
  }

  /**
   * PATCH semantics: `code`/`discountAmount` are always sent by the edit
   * form; optional fields are only touched when present (null clears copy or
   * a validity date).
   */
  async updatePromo(id: string, dto: PromoAdminDto): Promise<PromoEntity> {
    const promo = await this.promos.findOne({ where: { id } });
    if (!promo) throw new NotFoundException(`Promo "${id}" not found`);
    const code = this.normalize(dto.code);
    if (code !== promo.code) {
      const clash = await this.promos.findOne({ where: { code } });
      if (clash) throw new ConflictException(`Promo code "${code}" already exists.`);
      promo.code = code;
    }
    promo.discountAmount = dto.discountAmount;
    if (dto.title !== undefined) promo.title = dto.title ?? null;
    if (dto.subtitle !== undefined) promo.subtitle = dto.subtitle ?? null;
    if (dto.cta !== undefined) promo.cta = dto.cta ?? null;
    if (dto.firstRideOnly !== undefined) promo.firstRideOnly = dto.firstRideOnly;
    if (dto.active !== undefined) promo.active = dto.active;
    if (dto.validFrom !== undefined) promo.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    if (dto.validTo !== undefined) promo.validTo = dto.validTo ? new Date(dto.validTo) : null;
    if (dto.maxRedemptions !== undefined) promo.maxRedemptions = dto.maxRedemptions ?? null;
    this.assertWindow(promo.validFrom, promo.validTo);
    return this.saveGuarded(promo);
  }

  async removePromo(id: string): Promise<{ id: string }> {
    const { affected } = await this.promos.delete({ id });
    if (!affected) throw new NotFoundException(`Promo "${id}" not found`);
    // promo_redemptions.promoId is SET NULL and the code is denormalised
    // there, so redemption history survives the delete.
    return { id };
  }
}
