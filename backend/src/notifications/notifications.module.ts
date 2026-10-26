import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../auth/entities/user.entity';
import { DeviceTokenEntity } from './device-token.entity';
import { NotificationsController } from './notifications.controller';
import { PushService } from './push.service';

@Module({
  imports: [TypeOrmModule.forFeature([DeviceTokenEntity, UserEntity])],
  controllers: [NotificationsController],
  providers: [PushService],
  exports: [PushService],
})
export class NotificationsModule {}
