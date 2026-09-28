import { io, Socket } from 'socket.io-client';
import { API_URL } from '../api/client';
import { useRideStore } from '../store/rideStore';
import { useAuthStore } from '../store/authStore';
import { ridesApi } from '../api/rides';

let socketInstance: Socket | null = null;
const listeners = new Set<(socket: Socket | null) => void>();

function notifyListeners() {
  for (const listener of listeners) {
    listener(socketInstance);
  }
}

export function getSocket(): Socket | null {
  return socketInstance;
}

export function connectSocket(token: string): Socket {
  if (socketInstance && socketInstance.connected) {
    return socketInstance;
  }

  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }

  const baseUrl = API_URL.replace(/\/api\/v1$/, '');
  const socket = io(`${baseUrl}/realtime`, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on('connect', async () => {
    socketInstance = socket;
    notifyListeners();

    // Re-join active ride room on reconnect
    const activeRide = useRideStore.getState().activeRide;
    if (activeRide?.id) {
      socket.emit('ride:join', { rideId: activeRide.id });
      // Refresh ride state
      try {
        const refreshed = await ridesApi.get(activeRide.id);
        useRideStore.getState().setActiveRide(refreshed);
      } catch {
        // Ignored
      }
    }

    // If driver, check for pending offers on reconnect
    const role = useAuthStore.getState().role;
    if (role === 'driver') {
      try {
        const pending = await ridesApi.getPendingOffer();
        if (pending?.ride) {
          useRideStore.getState().setActiveRide({
            ...pending.ride,
            expiresInSeconds: pending.remainingSeconds,
          });
        }
      } catch {
        // Ignored
      }
    }
  });

  socket.on('disconnect', () => {
    notifyListeners();
  });

  socketInstance = socket;
  notifyListeners();
  return socket;
}

export function disconnectSocket(): void {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
    notifyListeners();
  }
}

export function subscribeSocket(listener: (socket: Socket | null) => void): () => void {
  listeners.add(listener);
  listener(socketInstance);
  return () => {
    listeners.delete(listener);
  };
}
