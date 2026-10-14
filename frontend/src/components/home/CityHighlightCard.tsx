import React, { memo } from 'react';
import { PlaceCard } from './PlaceCard';
import { PlaceItem } from '../../api/places';

interface Props {
  highlight: PlaceItem;
  onPress: (place: PlaceItem) => void;
  cardWidth?: number;
}

/** "Explore your city" card — the landscape photo card (see PlaceCard). */
export const CityHighlightCard: React.FC<Props> = memo(({ highlight, onPress, cardWidth }) => (
  <PlaceCard place={highlight} onPress={onPress} variant="wide" width={cardWidth} />
));

CityHighlightCard.displayName = 'CityHighlightCard';
