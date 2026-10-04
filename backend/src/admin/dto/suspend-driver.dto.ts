import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

/**
 * POST /admin/drivers/:id/suspend body.
 * `reason` (5–300) is mandatory — every suspension is audited (A-12).
 * `force: true` cancels an in-flight ride first (A-3); without it the server
 * answers 409 carrying the ride id so the console can ask the admin.
 */
export class SuspendDriverDto {
  @IsString()
  @Length(5, 300)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
