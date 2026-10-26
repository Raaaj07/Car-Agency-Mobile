import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Phase-1.4: an inline TS type gives the global ValidationPipe no metatype, so
 * nothing validated the body and a non-string `refreshToken` reached
 * `createHash()` as a 500. This DTO turns that into a normal 400.
 */
export class LogoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  refreshToken?: string;
}
