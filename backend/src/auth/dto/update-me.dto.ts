import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  /**
   * LEGACY, IGNORED. Older app builds send `role` when completing the profile;
   * see VerifyOtpDto. AuthService.updateMe only reads name/email, so a client
   * can never change its own role through this endpoint.
   */
  @IsOptional()
  @IsString()
  role?: string;
}
