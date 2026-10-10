/// <reference types="jest" />
import { RidesGateway } from './rides.gateway';

const RIDE_ID = '11111111-2222-3333-4444-555555555555';

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
      { register: jest.fn(), createRideEvent: jest.fn() } as never,
      rides as never,
      drivers as never,
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
