import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './auth.service';

// Authenticated avatar streaming. Any logged-in user may view any avatar;
// files live under uploads/avatars/ and are never served as public static.
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get(':id/avatar')
  async getAvatar(@Param('id') id: string, @Res() res: Response) {
    const doc = await this.auth.readAvatar(id);
    res.setHeader('Content-Type', doc.mime);
    res.send(doc.buffer);
  }
}
