import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Matches ReviewRideScreen: star rating, optional compliment tags, optional tip.
export class SubmitReviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  // SEC-2: compliment tags are stored with the review — each tag is a short
  // preset label, so 50 chars/tag is already generous.
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  compliments?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  // Upper bound: the tip feeds the payment amount check and driver earnings, so
  // an absurd value (typo or abuse) must be rejected, not recorded.
  @Max(5000)
  tipAmount?: number;
}
