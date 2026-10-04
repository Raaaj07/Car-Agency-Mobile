import { IsString, Length } from 'class-validator';

/** POST /admin/rides/:id/cancel body — every admin cancel is audited. */
export class CancelRideDto {
  @IsString()
  @Length(5, 300)
  reason!: string;
}
