import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedPlaceEntity } from './entities/saved-place.entity';
import { RideEntity } from '../rides/entities/ride.entity';
import { PlacesController } from './places.controller';
import { PlacesPhotoController } from './places-photo.controller';
import { PlacesService } from './places.service';
import { GooglePlacesService } from './google-places.service';
import { WikimediaService } from './wikimedia.service';
import { PlaceImageService } from './place-image.service';

@Module({
  imports: [TypeOrmModule.forFeature([SavedPlaceEntity, RideEntity])],
  controllers: [PlacesController, PlacesPhotoController],
  providers: [PlacesService, GooglePlacesService, WikimediaService, PlaceImageService],
  exports: [PlacesService],
})
export class PlacesModule {}