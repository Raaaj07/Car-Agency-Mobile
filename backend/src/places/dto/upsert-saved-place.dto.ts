import { IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertSavedPlaceDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsString()
  @MaxLength(300)
  address!: string;

  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;

  @IsOptional()
  @IsString()
  @IsIn(['home', 'work'])
  label?: 'home' | 'work';
}
