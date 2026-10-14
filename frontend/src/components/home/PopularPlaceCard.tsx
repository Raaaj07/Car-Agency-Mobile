import React, { memo } from 'react';
import { PlaceCard } from './PlaceCard';
import { PlaceItem } from '../../api/places';

interface Props {
  place: PlaceItem;
  onPress: (place: PlaceItem) => void;
  cardWidth?: number;
}

/** Near You / Popular card — the portrait photo card (see PlaceCard). */
export const PopularPlaceCard: React.FC<Props> = memo(({ place, onPress, cardWidth }) => (
  <PlaceCard place={place} onPress={onPress} variant="tall" width={cardWidth} />
));

PopularPlaceCard.displayName = 'PopularPlaceCard';
