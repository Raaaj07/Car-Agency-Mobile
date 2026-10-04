import { IsBoolean, IsOptional } from 'class-validator';

/**
 * POST /admin/drivers/:id/suspend body.
 * `force: true` cancels an in-flight ride first (A-3); without it the server
 * answers 409 carrying the ride id so the console can ask the admin.
 * (Phase 2 adds the audited `reason` field.)
 */
export class SuspendDriverDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
