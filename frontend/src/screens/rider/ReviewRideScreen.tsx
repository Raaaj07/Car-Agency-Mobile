import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Star, Heart, Check, Sparkles } from 'lucide-react-native';
import { colors, radii, typography, shadows } from '../../theme/theme';
import { Button } from '../../components/primitives/Button';
import { Card } from '../../components/primitives/Card';
import { Avatar } from '../../components/primitives/Avatar';
import { Header } from '../../components/primitives/Header';

interface Props {
  onBack: () => void;
  onSubmitReview: (rating: number) => void;
}

const compliments = [
  'Safe Driver 🛡️',
  'Clean Car ✨',
  'Polite & Friendly 😊',
  'Great Music 🎵',
  'On Time ⏱️',
];

const tipOptions = ['₹10', '₹20', '₹50', '₹100'];

export const ReviewRideScreen: React.FC<Props> = ({ onBack, onSubmitReview }) => {
  const [rating, setRating] = useState<number>(5);
  const [selectedCompliments, setSelectedCompliments] = useState<string[]>(['Safe Driver 🛡️']);
  const [selectedTip, setSelectedTip] = useState<string>('₹20');

  const toggleCompliment = (item: string) => {
    if (selectedCompliments.includes(item)) {
      setSelectedCompliments(selectedCompliments.filter((c) => c !== item));
    } else {
      setSelectedCompliments([...selectedCompliments, item]);
    }
  };

  return (
    <View style={styles.container}>
      <Header title="Rate Your Ride" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.driverSection}>
          <Avatar name="Rajesh Kumar" size={72} />
          <Text style={styles.driverName}>Rajesh Kumar</Text>
          <Text style={styles.vehicleInfo}>Comfort Sedan • KA 05 MN 4821</Text>
        </View>

        {/* 5 Star Selection */}
        <Card style={styles.ratingCard}>
          <Text style={styles.cardHeaderTitle}>How was your ride?</Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <TouchableOpacity key={star} onPress={() => setRating(star)} activeOpacity={0.7}>
                <Star
                  size={36}
                  color="#E08A34"
                  fill={star <= rating ? '#E08A34' : 'transparent'}
                />
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        {/* Compliments Badges */}
        <Card style={styles.sectionCard}>
          <Text style={styles.cardHeaderTitle}>Give a Compliment</Text>
          <View style={styles.tagsWrap}>
            {compliments.map((comp) => {
              const isSelected = selectedCompliments.includes(comp);
              return (
                <TouchableOpacity
                  key={comp}
                  style={[styles.tagPill, isSelected && styles.tagPillActive]}
                  onPress={() => toggleCompliment(comp)}
                >
                  <Text style={[styles.tagText, isSelected && styles.tagTextActive]}>{comp}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        {/* Driver Tip Row */}
        <Card style={styles.sectionCard}>
          <View style={styles.tipTitleRow}>
            <Sparkles size={18} color={colors.accent} />
            <Text style={styles.cardHeaderTitle}>Add Driver Tip (Optional)</Text>
          </View>
          <View style={styles.tipsRow}>
            {tipOptions.map((tip) => {
              const isSelected = selectedTip === tip;
              return (
                <TouchableOpacity
                  key={tip}
                  style={[styles.tipChip, isSelected && styles.tipChipActive]}
                  onPress={() => setSelectedTip(tip)}
                >
                  <Text style={[styles.tipText, isSelected && styles.tipTextActive]}>{tip}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title="Submit Rating & Feedback"
          onPress={() => onSubmitReview(rating)}
          variant="primary"
          size="large"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 110,
    gap: 16,
  },
  driverSection: {
    alignItems: 'center',
    marginVertical: 10,
  },
  driverName: {
    ...typography.subheading,
    marginTop: 10,
  },
  vehicleInfo: {
    ...typography.meta,
    fontSize: 13,
  },
  ratingCard: {
    padding: 20,
    alignItems: 'center',
  },
  cardHeaderTitle: {
    ...typography.cardTitle,
    fontSize: 16,
    marginBottom: 12,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  sectionCard: {
    padding: 16,
  },
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  tagPillActive: {
    backgroundColor: colors.accentLight,
    borderColor: colors.accent,
  },
  tagText: {
    ...typography.bodyBold,
    fontSize: 12,
    color: colors.textSecondary,
  },
  tagTextActive: {
    color: colors.accent,
  },
  tipTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tipsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  tipChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.button,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  tipChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tipText: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  tipTextActive: {
    color: '#FFFFFF',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    ...shadows.card,
  },
});
