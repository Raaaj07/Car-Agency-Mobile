import React from 'react';
import { View, Text, StyleSheet, Image, ViewStyle } from 'react-native';
import { Star } from 'lucide-react-native';
import { colors, radii, typography } from '../../theme/theme';

interface AvatarProps {
  name: string;
  uri?: string;
  size?: number;
  rating?: number;
  online?: boolean;
  style?: ViewStyle;
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  uri,
  size = 48,
  rating,
  online,
  style,
}) => {
  const getInitials = (n: string) => {
    const parts = n.trim().split(' ');
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return n.slice(0, 2).toUpperCase();
  };

  return (
    <View style={[styles.wrapper, style]}>
      <View
        style={[
          styles.container,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      >
        {uri ? (
          <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
        ) : (
          <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
            <Text style={[styles.initials, { fontSize: size * 0.4 }]}>{getInitials(name)}</Text>
          </View>
        )}
        {online !== undefined && (
          <View
            style={[
              styles.statusDot,
              { backgroundColor: online ? colors.success : colors.textMuted },
            ]}
          />
        )}
      </View>
      {rating !== undefined && (
        <View style={styles.ratingBadge}>
          <Star size={10} color="#E08A34" fill="#E08A34" />
          <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  container: {
    position: 'relative',
    backgroundColor: '#E2E8F0',
    overflow: 'visible',
  },
  fallback: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  statusDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginTop: -8,
  },
  ratingText: {
    ...typography.metaBold,
    fontSize: 10,
    marginLeft: 2,
    color: colors.textPrimary,
  },
});
