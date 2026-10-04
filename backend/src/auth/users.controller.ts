import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';

// Legacy local-disk avatar streaming (Cloudinary avatars are plain https
// URLs and never hit this route). Deliberately public: profile pictures are
// shown cross-user (rider sees the driver's photo, the driver sees the
// rider's) and React Native <Image> cannot attach an Authorization header.
// The uuid-keyed path is unguessable, and the payload is only a photo.
@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get(':id/avatar')
  async getAvatar(@Param('id') id: string, @Res() res: Response) {
    const doc = await this.auth.readAvatar(id);
    res.setHeader('Content-Type', doc.mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(doc.buffer);
  }
}
