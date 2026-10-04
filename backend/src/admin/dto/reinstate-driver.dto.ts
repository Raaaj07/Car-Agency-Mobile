import { IsOptional, IsString, Length } from 'class-validator';

/**
 * POST /admin/drivers/:id/reinstate body. `reason` is optional but audited
 * when present (the reinstate itself is already an audited action).
 */
export class ReinstateDriverDto {
  @IsOptional()
  @IsString()
  @Length(5, 300)
  reason?: string;
}
