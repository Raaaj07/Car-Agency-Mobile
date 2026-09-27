import { IsIn, IsOptional, IsString } from 'class-validator';

export class GoogleSignInDto {
  @IsString() idToken!: string;
  @IsOptional() @IsIn(['rider', 'driver']) role?: 'rider' | 'driver';
}

export class AppleSignInDto {
  @IsString() identityToken!: string;
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsIn(['rider', 'driver']) role?: 'rider' | 'driver';
}   