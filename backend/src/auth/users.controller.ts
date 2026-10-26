import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';

// Legacy local-disk avatar streaming (Cloudinary avatars are plain https
// URLs and never hit this route). Deliberately public: profile pictures are
// shown cross-user (rider sees the driver's photo, the driver sees the
// rider's) and React Native <Image> cannot attach an Authorization header.
// The uuid-keyed path is unguessable, and the payload is only a photo.
@Public()
@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  // SEC-7: uuid-shaped ids only — anything else is a 400 before the query
  // layer sees it (a non-uuid used to reach Postgres and surface as a 500).
  @Get(':id/avatar')
  async getAvatar(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const doc = await this.auth.readAvatar(id);
    res.setHeader('Content-Type', doc.mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(doc.buffer);
  }
}
