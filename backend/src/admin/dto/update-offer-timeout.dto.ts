import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/**
 * PUT /admin/settings/offer-timeout body. Whole seconds, 10-60: how long each
 * driver has to answer a ride offer before it moves to the next driver. The
 * service re-validates the same bounds.
 */
export class UpdateOfferTimeoutDto {
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(60)
  seconds!: number;
}
