/// <reference types="jest" />
import { Logger } from '@nestjs/common';
import { JWT_AUD, JWT_ISS } from '../../auth/tokens.service';
import { RidesGateway } from './rides.gateway';

const RIDE_ID = '11111111-2222-3333-4444-555555555555';
const SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

interface TestClient {
  id: string;
  data: { userId?: string; role?: 'rider' | 'driver' | 'admin' | null };
  join: jest.Mock;
  leave: jest.Mock;
  disconnect: jest.Mock;
}

/**
 * SEC: ride:join must never subscribe a socket to someone else's trip, both
 * handlers must reject malformed ids / unauthenticated sockets, and a client
 * looping join/leave gets disconnected after 20 events per minute.
 */
describe('RidesGateway room guards (SEC)', () => {
  let gateway: RidesGateway;
  let rides: { findOne: jest.Mock };
  let drivers: { findOne: jest.Mock };
  let client: TestClient;

  const repoStub = () => ({ findOne: jest.fn(), save: jest.fn(), update: jest.fn(), delete: jest.fn() });

  const joinSocket = () => client as unknown as Parameters<RidesGateway['onJoinRide']>[0];
  const leaveSocket = () => client as unknown as Parameters<RidesGateway['onLeaveRide']>[0];

  beforeEach(() => {
    rides = { findOne: jest.fn() };
    drivers = { findOne: jest.fn() };
    gateway = new RidesGateway(
      { verifyAsync: jest.fn() } as never,
      { get: jest.fn() } as never,
      { register: jest.fn(), registerSessionRevoked: jest.fn(), createRideEvent: jest.fn() } as never,
      rides as never,
      drivers as never,
      repoStub() as never,
      repoStub() as never,
    );
    client = {
      id: 'socket-1',
      data: { userId: 'user-1', role: null },
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
    };
  });

  it('refuses to let a bystander join someone else\'s ride', async () => {
    rides.findOne.mockResolvedValue({ id: RIDE_ID, riderId: 'someone-else', driverId: null });
    drivers.findOne.mockResolvedValue(null);

    const ack = await gateway.onJoinRide(joinSocket(), { rideId: RIDE_ID });

    expect(ack).toEqual({ ok: false, error: 'not_a_participant' });
    expect(client.join).not.toHaveBeenCalled();
  });

  it('lets the ride\'s rider join', async () => {
    rides.findOne.mockResolvedValue({ id: RIDE_ID, riderId: 'user-1', driverId: null });

    const ack = await gateway.onJoinRide(joinSocket(), { rideId: RIDE_ID });

    expect(ack).toEqual({ ok: true });
    expect(client.join).toHaveBeenCalledTimes(1);
    expect(String(client.join.mock.calls[0][0])).toContain(RIDE_ID);
  });

  it('lets the assigned driver join (driver row resolved via userId)', async () => {
    rides.findOne.mockResolvedValue({ id: RIDE_ID, riderId: 'someone-else', driverId: 'driver-9' });
    drivers.findOne.mockResolvedValue({ id: 'driver-9', userId: 'user-1', status: 'approved' });

    const ack = await gateway.onJoinRide(joinSocket(), { rideId: RIDE_ID });

    expect(ack).toEqual({ ok: true });
    expect(client.join).toHaveBeenCalledTimes(1);
  });

  it('lets an admin join (support can watch a live trip)', async () => {
    client.data.role = 'admin';
    rides.findOne.mockResolvedValue({ id: RIDE_ID, riderId: 'someone-else', driverId: null });

    const ack = await gateway.onJoinRide(joinSocket(), { rideId: RIDE_ID });

    expect(ack).toEqual({ ok: true });
    expect(client.join).toHaveBeenCalledTimes(1);
  });

  it('rejects an unauthenticated socket before touching the database', async () => {
    client.data = {};

    const ack = await gateway.onJoinRide(joinSocket(), { rideId: RIDE_ID });

    expect(ack).toEqual({ ok: false, error: 'unauthenticated' });
    expect(rides.findOne).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID ride id before touching the database', async () => {
    const ack = await gateway.onJoinRide(joinSocket(), { rideId: 'not-a-uuid; DROP TABLE rides' });

    expect(ack).toEqual({ ok: false, error: 'invalid_ride_id' });
    expect(rides.findOne).not.toHaveBeenCalled();
  });

  it('acks ride_not_found for an unknown ride', async () => {
    rides.findOne.mockResolvedValue(null);

    const ack = await gateway.onJoinRide(joinSocket(), { rideId: RIDE_ID });

    expect(ack).toEqual({ ok: false, error: 'ride_not_found' });
    expect(client.join).not.toHaveBeenCalled();
  });

  it('ride:leave requires an authenticated socket and a valid UUID', async () => {
    client.data = {};
    expect(gateway.onLeaveRide(leaveSocket(), { rideId: RIDE_ID })).toEqual({
      ok: false,
      error: 'unauthenticated',
    });
    client.data = { userId: 'user-1', role: null };
    expect(gateway.onLeaveRide(leaveSocket(), { rideId: 'zzz' })).toEqual({
      ok: false,
      error: 'invalid_ride_id',
    });
    expect(client.leave).not.toHaveBeenCalled();

    expect(gateway.onLeaveRide(leaveSocket(), { rideId: RIDE_ID })).toEqual({ ok: true });
    expect(client.leave).toHaveBeenCalledTimes(1);
  });

  it('disconnects a socket that exceeds 20 join/leave events per minute', async () => {
    rides.findOne.mockResolvedValue({ id: RIDE_ID, riderId: 'user-1', driverId: null });

    for (let i = 0; i < 20; i++) {
      expect(await gateway.onJoinRide(joinSocket(), { rideId: RIDE_ID })).toEqual({ ok: true });
    }
    expect(client.disconnect).not.toHaveBeenCalled();

    const ack = await gateway.onJoinRide(joinSocket(), { rideId: RIDE_ID });
    expect(ack).toEqual({ ok: false, error: 'rate_limited' });
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('resets the join/leave budget once the window passes', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      rides.findOne.mockResolvedValue({ id: RIDE_ID, riderId: 'user-1', driverId: null });
      for (let i = 0; i < 20; i++) await gateway.onJoinRide(joinSocket(), { rideId: RIDE_ID });

      nowSpy.mockReturnValue(1_000_000 + 61_000);
      expect(await gateway.onJoinRide(joinSocket(), { rideId: RIDE_ID })).toEqual({ ok: true });
      expect(client.disconnect).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });
});

/**
 * Pass-4 (task 7): driver:location relays only while the trip is live, and
 * ride:request:ack accepts only an authenticated socket carrying a UUID —
 * the log line never sees attacker-controlled input.
 */
describe('RidesGateway trip-live relay + ack validation (pass-4 task-7)', () => {
  let gateway: RidesGateway;
  let rides: { findOne: jest.Mock };
  let drivers: { findOne: jest.Mock };
  let client: TestClient & { to: jest.Mock };
  let roomEmit: jest.Mock;

  const locSocket = () => client as unknown as Parameters<RidesGateway['onDriverLocation']>[0];

  beforeEach(() => {
    rides = { findOne: jest.fn() };
    drivers = { findOne: jest.fn() };
    gateway = new RidesGateway(
      { verifyAsync: jest.fn() } as never,
      { get: jest.fn() } as never,
      { register: jest.fn(), registerSessionRevoked: jest.fn(), createRideEvent: jest.fn() } as never,
      rides as never,
      drivers as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
    );
    roomEmit = jest.fn();
    client = {
      id: 'socket-1',
      data: { userId: 'user-1', role: null },
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
      to: jest.fn(() => ({ emit: roomEmit })),
    };
  });

  const armTrip = (status: string) => {
    drivers.findOne.mockResolvedValue({ id: 'driver-9', userId: 'user-1', status: 'approved' });
    rides.findOne.mockResolvedValue({
      id: RIDE_ID,
      riderId: 'rider-1',
      driverId: 'driver-9',
      status,
    });
  };

  it('relays driver:location while the trip is live', async () => {
    armTrip('in_progress');

    await gateway.onDriverLocation(locSocket(), { rideId: RIDE_ID, lat: 12.9, lng: 77.6 });

    expect(client.to).toHaveBeenCalledWith(expect.stringContaining(RIDE_ID));
    expect(roomEmit).toHaveBeenCalledWith(
      'driver:location',
      expect.objectContaining({ rideId: RIDE_ID, lat: 12.9, lng: 77.6 }),
    );
  });

  it('refuses the relay for a completed ride', async () => {
    armTrip('completed');

    await gateway.onDriverLocation(locSocket(), { rideId: RIDE_ID, lat: 12.9, lng: 77.6 });

    expect(client.to).not.toHaveBeenCalled();
    expect(roomEmit).not.toHaveBeenCalled();
  });

  it('refuses the relay for a cancelled ride too', async () => {
    armTrip('cancelled');

    await gateway.onDriverLocation(locSocket(), { rideId: RIDE_ID, lat: 12.9, lng: 77.6 });

    expect(roomEmit).not.toHaveBeenCalled();
  });

  describe('ride:request:ack', () => {
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
      logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => logSpy.mockRestore());

    it('ignores an object payload instead of logging attacker input', () => {
      gateway.onRideRequestAck(
        locSocket(),
        { rideId: { evil: 'payload' } } as unknown as { rideId: string },
      );

      expect(logSpy).not.toHaveBeenCalled();
    });

    it('ignores an unauthenticated socket', () => {
      client.data = {};

      gateway.onRideRequestAck(locSocket(), { rideId: RIDE_ID });

      expect(logSpy).not.toHaveBeenCalled();
    });

    it('logs only the validated UUID from an authenticated socket', () => {
      gateway.onRideRequestAck(locSocket(), { rideId: RIDE_ID });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(RIDE_ID));
    });
  });
});

/**
 * Phase-1.1: the socket handshake now enforces the same rule as HTTP
 * JwtStrategy.validate() — a token whose refresh session is revoked (logout,
 * replay detection, account deletion) must not keep a live socket. Legacy
 * tokens without a `sid` stay accepted.
 */
describe('RidesGateway socket handshake session check (Phase 1.1)', () => {
  interface HandshakeClient {
    id: string;
    data: { userId?: string; role?: string | null; sessionId?: string };
    handshake: { auth: { token?: string } };
    join: jest.Mock;
    emit: jest.Mock;
    disconnect: jest.Mock;
  }

  let gateway: RidesGateway;
  let verify: jest.Mock;
  let users: { findOne: jest.Mock };
  let sessions: { findOne: jest.Mock };
  let warnSpy: jest.SpyInstance;

  const repoStub = () => ({ findOne: jest.fn(), save: jest.fn(), update: jest.fn(), delete: jest.fn() });

  const client = (token?: string): HandshakeClient => ({
    id: 'socket-hs',
    data: {},
    handshake: { auth: { token } },
    join: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    disconnect: jest.fn(),
  });

  const connect = (c: HandshakeClient) =>
    gateway.handleConnection(
      c as unknown as Parameters<RidesGateway['handleConnection']>[0],
    );

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    verify = jest.fn();
    users = {
      findOne: jest.fn().mockResolvedValue({ id: 'user-1', role: 'rider', isActive: true }),
    };
    sessions = {
      findOne: jest.fn().mockResolvedValue({ id: SESSION_ID, revokedAt: null }),
    };
    gateway = new RidesGateway(
      { verify } as never,
      { get: jest.fn().mockReturnValue('jwt_secret_test_fake') } as never,
      { register: jest.fn(), registerSessionRevoked: jest.fn() } as never,
      repoStub() as never,
      repoStub() as never,
      users as never,
      sessions as never,
    );
  });

  afterEach(() => warnSpy.mockRestore());

  it('accepts a live session and records the sid on the socket', async () => {
    verify.mockReturnValue({ sub: 'user-1', role: 'rider', sid: SESSION_ID, iss: JWT_ISS, aud: JWT_AUD });
    const c = client('good-token');

    await connect(c);

    expect(c.disconnect).not.toHaveBeenCalled();
    expect(c.data.userId).toBe('user-1');
    expect(c.data.sessionId).toBe(SESSION_ID);
    expect(c.join).toHaveBeenCalledWith('user:user-1');
    expect(sessions.findOne).toHaveBeenCalledWith({
      where: { id: SESSION_ID },
      select: { id: true, revokedAt: true },
    });
  });

  it('rejects a token whose sid was revoked (logout)', async () => {
    verify.mockReturnValue({ sub: 'user-1', role: 'rider', sid: SESSION_ID, iss: JWT_ISS, aud: JWT_AUD });
    sessions.findOne.mockResolvedValue({ id: SESSION_ID, revokedAt: new Date() });
    const c = client('logged-out-token');

    await connect(c);

    expect(c.disconnect).toHaveBeenCalledWith(true);
    expect(c.join).not.toHaveBeenCalled();
    expect(c.data.userId).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Session ended'));
  });

  it('rejects a sid whose session row no longer exists', async () => {
    verify.mockReturnValue({ sub: 'user-1', role: 'rider', sid: SESSION_ID, iss: JWT_ISS, aud: JWT_AUD });
    sessions.findOne.mockResolvedValue(null);
    const c = client('stale-token');

    await connect(c);

    expect(c.disconnect).toHaveBeenCalledWith(true);
    expect(c.join).not.toHaveBeenCalled();
  });

  it('accepts a legacy token without a sid (no session lookup)', async () => {
    verify.mockReturnValue({ sub: 'user-1', role: 'rider', iss: JWT_ISS, aud: JWT_AUD });
    const c = client('legacy-token');

    await connect(c);

    expect(c.disconnect).not.toHaveBeenCalled();
    expect(c.data.userId).toBe('user-1');
    expect(c.data.sessionId).toBeUndefined();
    expect(sessions.findOne).not.toHaveBeenCalled();
  });

  it('rejects a missing token before any DB work', async () => {
    const c = client();

    await connect(c);

    expect(c.disconnect).toHaveBeenCalledWith(true);
    expect(users.findOne).not.toHaveBeenCalled();
  });
});

/**
 * Phase-1.1: AuthService announces a revocation through the events bridge;
 * the gateway closes exactly the matching sockets (session-scoped logout, or
 * every socket for logout-everywhere / account deletion).
 */
describe('RidesGateway revocation disconnects (Phase 1.1)', () => {
  interface FakeSocket {
    data: { userId?: string; sessionId?: string };
    emit: jest.Mock;
    disconnect: jest.Mock;
  }

  let gateway: RidesGateway;
  let sockets: Map<string, FakeSocket>;
  let registered: (payload: { userId: string; sessionId?: string; reason: string }) => void =
    () => undefined;

  const fakeSocket = (userId: string, sessionId?: string): FakeSocket => ({
    data: { userId, ...(sessionId ? { sessionId } : {}) },
    emit: jest.fn(),
    disconnect: jest.fn(),
  });

  const repoStub = () => ({ findOne: jest.fn(), save: jest.fn(), update: jest.fn(), delete: jest.fn() });

  beforeEach(() => {
    sockets = new Map();
    gateway = new RidesGateway(
      { verifyAsync: jest.fn() } as never,
      { get: jest.fn() } as never,
      {
        register: jest.fn(),
        registerSessionRevoked: jest.fn((cb: typeof registered) => {
          registered = cb;
        }),
      } as never,
      repoStub() as never,
      repoStub() as never,
      repoStub() as never,
      repoStub() as never,
    );
    gateway.server = { sockets: { sockets } } as never;
  });

  it('disconnects ONLY the sockets of the revoked session', () => {
    const mine = fakeSocket('user-1', SESSION_ID);
    const otherDevice = fakeSocket('user-1', 'other-session');
    sockets.set('s1', mine);
    sockets.set('s2', otherDevice);

    registered({ userId: 'user-1', sessionId: SESSION_ID, reason: 'session_revoked' });

    expect(mine.emit).toHaveBeenCalledWith('session:expired', { reason: 'session_revoked' });
    expect(mine.disconnect).toHaveBeenCalledWith(true);
    expect(otherDevice.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects every socket of the user for a user-wide revocation', () => {
    const a = fakeSocket('user-1', SESSION_ID);
    const b = fakeSocket('user-1', 'other-session');
    const stranger = fakeSocket('user-2', SESSION_ID);
    sockets.set('s1', a);
    sockets.set('s2', b);
    sockets.set('s3', stranger);

    registered({ userId: 'user-1', reason: 'account_deleted' });

    expect(a.disconnect).toHaveBeenCalledWith(true);
    expect(b.disconnect).toHaveBeenCalledWith(true);
    expect(stranger.disconnect).not.toHaveBeenCalled();
    expect(a.emit).toHaveBeenCalledWith('session:expired', { reason: 'account_deleted' });
  });
});
