import { IsOptional, IsString } from 'class-validator';

export class GoogleSignInDto {
  @IsString() idToken!: string;
}

export class AppleSignInDto {
  @IsString() identityToken!: string;
  @IsOptional() @IsString() fullName?: string;
}

export class RefreshTokenDto {
  @IsString() refreshToken!: string;
}   