import { useEffect, useRef } from 'react';
import { useRideStore } from '../store/rideStore';
import { announceOnce } from '../lib/announcer';
import { detectRideAnnouncement, RideSnapshot, snapshotRide } from '../utils/announcements';

/**
 * Speaks ride updates by watching the ride in the store, which every socket
 * event and poll already keeps up to date (so no screen needs its own code):
 * rider = driver found / trip started / trip finished / cancelled;
 * driver = a new ride request.
 *
 * Mounted once, in MainTabNavigator. What is said, and when, is decided by the
 * pure rules in utils/announcements.ts; announceOnce() makes sure the same
 * change is spoken only once even though several places update the store.
 */
export function useRideAnnouncements(role: 'rider' | 'driver'): void {
  const activeRide = useRideStore((state) => state.activeRide);
  const previous = useRef<RideSnapshot | null>(null);
  const previousRole = useRef(role);

  useEffect(() => {
    // Switching rider <-> driver mode starts fresh: nothing from the other
    // mode's ride may be announced.
    if (previousRole.current !== role) {
      previousRole.current = role;
      previous.current = null;
    }
    const next = snapshotRide(activeRide);
    const found = detectRideAnnouncement(previous.current, next, role);
    previous.current = next;
    if (!found) return;
    announceOnce(`${found.event}:${found.rideId}`, found.event, found.params);
  }, [activeRide, role]);
}
