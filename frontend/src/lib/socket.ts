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
  // Pass-4 (task 11): match only real auth failures. The old pattern matched
  // the bare substring "token", so an unrelated server message like
  // "tokens busy" (or "no token in cache") forced a spurious logout.
  // Phase-3.2: the server also rejects a revoked refresh session
  // ("Session ended"); treat it exactly like an expired JWT.
  socket.on('connect_error', (err: any) => {
    const msg = String(err?.message ?? '');
    if (/\bjwt\b|unauthorized|401|expired|session ended|revoked/i.test(msg)) {
      socket.disconnect();
      tokenManager.handleUnauthorized();
    }
  });

  // Task 7: server emitted session:expired (token expired or user deactivated).
  // Attempt silent refresh first, then reconnect; if refresh fails (401/403),
  // handleUnauthorized logs out.
  socket.on('session:expired', async () => {
    const refreshToken = tokenManager.getRefreshToken();
    if (!refreshToken) {
      socket.disconnect();
      tokenManager.handleUnauthorized();
      return;
    }
    try {
      const axios = (await import('axios')).default;
      const res = await axios.post(`${API_URL}/auth/refresh`, { refreshToken }, { timeout: 10_000 });
      const { accessToken: next, refreshToken: nextRefresh } = res.data ?? {};
      if (next) {
        tokenManager.setTokens({ accessToken: next, ...(nextRefresh ? { refreshToken: nextRefresh } : {}) });
        socket.connect();
        return;
      }
    } catch (e: any) {
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        socket.disconnect();
        tokenManager.handleUnauthorized();
        return;
      }
    }
    // If refresh failed due to network, don't force logout; socket will retry when network returns
    socket.connect();
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
