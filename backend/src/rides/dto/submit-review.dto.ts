import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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
  @IsString({ each: true })
  compliments?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  tipAmount?: number;
}
