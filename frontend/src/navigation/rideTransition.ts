/**
 * Pure rules for "the server says the ride is now X - what should this rider
 * screen do?".
 *
 * Every live-ride screen asks the same question from several places: the socket
 * `ride:status` event, the 3 s poll and the resync that runs when the app comes
 * back to the foreground (`useResyncOnForeground`). While the app is in the
 * background the websocket drops and JS timers freeze, so the answer that
 * matters most is the one given right after returning: the ride may have moved
 * several steps, finished, or been cancelled in the meantime.
 *
 * No React / React Native / store imports on purpose, so these decisions run in
 * plain Jest (node). "Fire only once" is still done by each screen's ref guard;
 * this file only decides WHAT should happen.
 */
import type { LiveRideScreen } from './resumeTarget';

/**
 * - none:     stay on this screen
 * - advance:  the ride moved forward; hand over to the next live screen
 * - complete: the trip is finished; go to the review screen
 * - cancel:   the ride was cancelled; go to the outcome screen
 */
export type RideAction = 'none' | 'advance' | 'complete' | 'cancel';

export function nextRideAction(screen: LiveRideScreen, status: string | undefined): RideAction {
  if (!status) return 'none';
  switch (screen) {
    case 'FindingDriver':
      if (status === 'cancelled') return 'cancel';
      // A driver was found. in_progress / completed count too: after a long
      // time in the background the poll can see the ride already past
      // "matched", and it must not stay on "Searching for your driver...".
      if (
        status === 'matched' ||
        status === 'driver_en_route' ||
        status === 'in_progress' ||
        status === 'completed'
      ) {
        return 'advance';
      }
      return 'none';
    case 'YouGotTheRide':
      if (status === 'cancelled') return 'cancel';
      if (status === 'in_progress' || status === 'completed') return 'advance';
      return 'none';
    case 'DriverEnRoute':
      if (status === 'in_progress') return 'advance';
      if (status === 'completed') return 'complete';
      if (status === 'cancelled') return 'cancel';
      return 'none';
    case 'TripProgress':
      if (status === 'completed') return 'complete';
      if (status === 'cancelled') return 'cancel';
      return 'none';
    default:
      return 'none';
  }
}
