import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedPlaceEntity } from './entities/saved-place.entity';
import { RideEntity } from '../rides/entities/ride.entity';
import { PlacesController } from './places.controller';
import { PlacesPhotoController } from './places-photo.controller';
import { PlacesService } from './places.service';
import { GooglePlacesService } from './google-places.service';
import { WikimediaService } from './wikimedia.service';
import { WikipediaPlacesService } from './wikipedia-places.service';
import { PlaceImageService } from './place-image.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SavedPlaceEntity, RideEntity]),
    // Pass-4 (task 10): the photo proxy optionally verifies the access token
    // (REQUIRE_AUTH_FOR_PHOTOS) with the SAME secret the rest of the app uses.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m' },
      }),
    }),
  ],
  controllers: [PlacesController, PlacesPhotoController],
  providers: [PlacesService, GooglePlacesService, WikimediaService, WikipediaPlacesService, PlaceImageService],
  exports: [PlacesService],
})
export class PlacesModule {}