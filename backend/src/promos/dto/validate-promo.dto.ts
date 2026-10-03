import { IsString, MaxLength } from 'class-validator';

export class ValidatePromoDto {
  @IsString()
  @MaxLength(30)
  code!: string;
}
