import React from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import { Pill } from '../primitives/Pill';

type PillVariant = 'primary' | 'accent' | 'success' | 'danger' | 'warning' | 'muted' | 'outline';

interface StatusPillProps {
  kind: 'application' | 'ride' | 'payment';
  value: string;
  style?: ViewStyle;
}

interface PillMap {
  label: string;
  variant: PillVariant;
}

/**
 * The single place status → colour/label is decided (spec §3.3): application,
 * ride and payment states never drift between screens.
 */
const MAP: Record<string, PillMap> = {
  // Driver applications
  pending: { label: 'Pending', variant: 'warning' },
  approved: { label: 'Approved', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'danger' },
  suspended: { label: 'Suspended', variant: 'primary' },
  // Rides
  requested: { label: 'Searching', variant: 'warning' },
  matched: { label: 'Matched', variant: 'primary' },
  driver_en_route: { label: 'En route', variant: 'primary' },
  in_progress: { label: 'In trip', variant: 'accent' },
  completed: { label: 'Completed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'danger' },
  // Payments (P-1)
  rider_claimed: { label: 'Rider claimed', variant: 'accent' },
  paid: { label: 'Paid', variant: 'success' },
  disputed: { label: 'Disputed', variant: 'danger' },
  failed: { label: 'Failed', variant: 'danger' },
};

export const StatusPill: React.FC<StatusPillProps> = ({ kind, value, style }) => {
  const entry = MAP[value];
  const mapped: PillMap = entry
    ? { label: entry.label, variant: entry.variant }
    : { label: value ? value.replace(/_/g, ' ') : kind, variant: 'muted' };

  // `payment: pending` and `application: pending` collide in MAP by design
  // (same wording "Pending"); only payment rows ever ask kind='payment' for
  // 'pending', and applications use the identical amber anyway.
  return (
    <Pill
      label={mapped.label}
      variant={mapped.variant}
      style={[styles.pill, style]}
    />
  );
};

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
  },
});
