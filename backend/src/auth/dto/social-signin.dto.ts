import { IsOptional, IsString } from 'class-validator';

// LEGACY, IGNORED: older app builds also send `role` with social sign-in.
// Declared only so forbidNonWhitelisted does not reject them; the server never
// reads it (new users are always riders, admin comes from ADMIN_PHONES).
export class GoogleSignInDto {
  @IsString() idToken!: string;
  @IsOptional() @IsString() role?: string;
}

export class AppleSignInDto {
  @IsString() identityToken!: string;
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() role?: string;
}

export class RefreshTokenDto {
  @IsString() refreshToken!: string;
}
