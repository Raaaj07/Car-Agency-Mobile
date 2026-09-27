import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_URL } from '../api/client';
import { useAuthStore } from '../store/authStore';

/** Authenticated realtime connection for ride offers, status and driver location. */
export function useSocket(): Socket | null {
  const [socket, setSocket] = useState<Socket | null>(null);
  const token = useAuthStore((state) => state.accessToken);

  useEffect(() => {
    if (!token) return;
    const baseUrl = API_URL.replace(/\/api\/v1$/, '');
    const connection = io(`${baseUrl}/realtime`, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    const handleConnect = () => setSocket(connection);
    connection.on('connect', handleConnect);
    return () => {
      connection.off('connect', handleConnect);
      connection.disconnect();
      setSocket((current) => (current === connection ? null : current));
    };
  }, [token]);

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
 */
export function useRideSocket(rideId: string | undefined, handlers: RideSocketHandlers): Socket | null {
  const socket = useSocket();

  // Keep the latest handlers available to the listeners below without
  // needing to re-subscribe (and re-join the room) on every render.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!socket || !rideId) return;

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