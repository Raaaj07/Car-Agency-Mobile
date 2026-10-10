import { IsOptional, IsString, MaxLength } from 'class-validator';

// LEGACY, IGNORED: older app builds also send `role` with social sign-in.
// Declared only so forbidNonWhitelisted does not reject them; the server never
// reads it (new users are always riders, admin comes from ADMIN_PHONES).

// SEC-2: tokens are only verified, never stored raw — the caps just reject
// absurd payloads early (a JWT stays far below 4 KB). fullName IS stored as
// the display name, so it carries the profile-name cap.
export class GoogleSignInDto {
  @IsString()
  @MaxLength(4096)
  idToken!: string;
  @IsOptional() @IsString() role?: string;
}

export class AppleSignInDto {
  @IsString()
  @MaxLength(4096)
  identityToken!: string;
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;
  @IsOptional() @IsString() role?: string;
}

export class RefreshTokenDto {
  @IsString()
  @MaxLength(4096)
  refreshToken!: string;
}
