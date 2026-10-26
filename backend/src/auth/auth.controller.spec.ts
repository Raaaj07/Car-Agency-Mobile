/// <reference types="jest" />
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LogoutDto } from './dto/logout.dto';
import { AuthenticatedUser } from './strategies/jwt.strategy';

/**
 * Phase-1.4: the logout body used to be an inline TS type, so the global
 * ValidationPipe never ran and a non-string refreshToken reached createHash()
 * as a 500. The DTO must turn that into a 400.
 */
describe('AuthController logout DTO (Phase 1.4)', () => {
  // Same options as main.ts.
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });

  const validate = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: LogoutDto }) as Promise<LogoutDto>;

  it('rejects an object refreshToken with 400', async () => {
    await expect(validate({ refreshToken: { nested: true } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a numeric refreshToken with 400', async () => {
    await expect(validate({ refreshToken: 123 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a missing or string refreshToken', async () => {
    await expect(validate({})).resolves.toBeInstanceOf(LogoutDto);
    const dto = await validate({ refreshToken: 'refresh-token-value' });
    expect(dto.refreshToken).toBe('refresh-token-value');
  });

  it('forwards the validated body and the session id to AuthService', async () => {
    const logout = jest.fn().mockResolvedValue({ ok: true });
    const controller = new AuthController({ logout } as unknown as AuthService);
    const user = {
      userId: 'u-1',
      phone: '',
      role: 'rider',
      sessionId: 'sess-9',
    } as AuthenticatedUser;

    await expect(controller.logout(user, await validate({ refreshToken: 'r' }))).resolves.toEqual({
      ok: true,
    });
    expect(logout).toHaveBeenCalledWith('u-1', 'r', 'sess-9');
  });
});
