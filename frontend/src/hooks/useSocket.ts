import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
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

/**
 * Run `resync` the moment the app returns to the foreground and whenever the
 * realtime socket (re)connects. While the app is backgrounded the OS freezes
 * JS timers and drops the websocket, so a `ride:status` event (e.g. the driver
 * finished the ride) is missed and the 3 s polls stop; without this the rider
 * stays on the old screen until the next poll tick (or forever if the socket
 * never delivers). `resync` should fetch the ride and navigate on change.
 */
export function useResyncOnForeground(resync: () => void): void {
  const resyncRef = useRef(resync);
  useEffect(() => {
    resyncRef.current = resync;
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') resyncRef.current();
    });
    return () => sub.remove();
  }, []);

  const socket = useSocket();
  useEffect(() => {
    if (!socket) return;
    const onConnect = () => resyncRef.current();
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
    };
  }, [socket]);
}

export interface DriverLocationEvent {
  rideId: string;
  lat: number;
  lng: number;
  /** Driver's direction of travel in degrees (0 = north, clockwise). Optional — older servers/drivers omit it. */
  heading?: number;
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
  // Synced in an effect: writing .current during render trips react-hooks/refs,
  // and socket events are async so they can never observe the one-commit lag.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

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