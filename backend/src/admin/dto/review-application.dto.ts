import { IsString, Length } from 'class-validator';

export class ReviewApplicationDto {
  @IsString()
  @Length(5, 300)
  reason!: string;
}
