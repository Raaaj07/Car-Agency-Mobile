import { io, Socket } from 'socket.io-client';
import { API_URL } from '../api/client';
import { tokenManager } from './tokenManager';

// NOTE: no static imports of stores or api modules here — authStore imports
// this file, so importing them back creates a require cycle. Anything needed
// from stores/api is loaded via dynamic import() inside handlers.

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

export function connectSocket(token: string, role?: 'rider' | 'driver' | 'admin' | null): Socket {
  if (socketInstance && socketInstance.connected) {
    return socketInstance;
  }

  if (socketInstance) {
    socketInstance.removeAllListeners();
    socketInstance.disconnect();
    socketInstance = null;
  }

  // API_URL is .../api/v1 — strip only that suffix; fall back to raw URL.
  const baseUrl = API_URL.endsWith('/api/v1') ? API_URL.slice(0, -'/api/v1'.length) : API_URL;
  const socket = io(`${baseUrl}/realtime`, {
    // AU-3: auth is a callback, so EVERY (re)connection attempt reads the
    // live access token from tokenManager instead of the value captured at
    // first connect — a silent HTTP refresh keeps realtime alive past the
    // 15-minute access-token expiry instead of failing the handshake on the
    // next network blip and forcing a logout. `token` is the bootstrap value.
    auth: (cb) => cb({ token: tokenManager.getAccessToken() ?? token }),
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  // Expired/revoked JWT: stop infinite reconnect loop and force re-login.
  // Uses tokenManager (not authStore) to avoid a require cycle.
  socket.on('connect_error', (err: any) => {
    const msg = String(err?.message ?? '');
    if (/jwt|unauthorized|401|token/i.test(msg)) {
      socket.disconnect();
      tokenManager.handleUnauthorized();
    }
  });

  socket.on('connect', async () => {
    socketInstance = socket;
    notifyListeners();

    try {
      const [{ useRideStore }, { ridesApi }, { useAuthStore }] = await Promise.all([
        import('../store/rideStore'),
        import('../api/rides'),
        import('../store/authStore'),
      ]);
      // Read role fresh (not the captured login-time value) — user may have
      // become a driver after connecting.
      const freshRole = role ?? useAuthStore.getState().user?.role ?? null;
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
      if (freshRole === 'driver') {
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
    } catch {
      // Dynamic imports failed — socket stays connected, state refresh skipped.
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
    socketInstance.removeAllListeners();
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

/**
 * AU-3: called by authStore whenever tokenManager lands new tokens (silent
 * HTTP refresh). A healthy connection keeps its handshake — the auth callback
 * above covers its next reconnect — but a dormant socket (network drop while
 * tokens rotated) is nudged to retry immediately with the fresh token.
 */
export function refreshSocketAuth(): void {
  if (socketInstance && !socketInstance.connected) {
    socketInstance.connect();
  }
}
