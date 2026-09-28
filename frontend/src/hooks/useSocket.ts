import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { subscribeSocket } from '../lib/socket';

/** Returns the live singleton socket, or null while disconnected. */
export function useSocket(): Socket | null {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeSocket((s) => setSocket(s));
    return unsubscribe;
  }, []);

  return socket;
}

export interface DriverLocationEvent {
  rideId: string;
  lat: number;
  lng: number;
  at: string;
}

export interface RideStatusEvent {
  rideId: string;
  status: string;
  driverId: string | null;
  pickupOtp?: string;
  fareBreakdown: unknown;
  cancellationReason?: string | null;
}

interface RideSocketHandlers {
  onDriverLocation?: (event: DriverLocationEvent) => void;
  onStatus?: (event: RideStatusEvent) => void;
}

/**
 * Scopes the shared socket to one ride: joins/leaves the backend's
 * `ride:<id>` room (see rides.gateway.ts) and forwards that ride's
 * `driver:location` / `ride:status` events to the given handlers.
 * Used by TripProgressScreen for the live tracking map.
 *
 * Because the socket is a module-level singleton, re-joining on
 * reconnect is handled here: whenever a new non-null socket arrives
 * from subscribeSocket we emit `ride:join` again automatically.
 */
export function useRideSocket(rideId: string | undefined, handlers: RideSocketHandlers): Socket | null {
  const socket = useSocket();

  // Keep the latest handlers available without re-subscribing on every render.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!socket || !rideId) return;

    // Always re-join on mount or when a new socket instance arrives
    // (which happens after every reconnect via subscribeSocket).
    socket.emit('ride:join', { rideId });

    const handleDriverLocation = (event: DriverLocationEvent) => {
      if (event.rideId !== rideId) return;
      handlersRef.current.onDriverLocation?.(event);
    };
    const handleStatus = (event: RideStatusEvent) => {
      if (event.rideId !== rideId) return;
      handlersRef.current.onStatus?.(event);
    };

    socket.on('driver:location', handleDriverLocation);
    socket.on('ride:status', handleStatus);

    return () => {
      socket.off('driver:location', handleDriverLocation);
      socket.off('ride:status', handleStatus);
      socket.emit('ride:leave', { rideId });
    };
  }, [socket, rideId]);

  return socket;
}