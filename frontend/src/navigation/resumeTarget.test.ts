import { isActiveStatus, mayResumeOnLaunch, resumeScreenFor, screenForStatus } from './resumeTarget';

describe('screenForStatus', () => {
  it('maps every active status to its live screen', () => {
    expect(screenForStatus('requested')).toBe('FindingDriver');
    expect(screenForStatus('matched')).toBe('YouGotTheRide');
    expect(screenForStatus('driver_en_route')).toBe('DriverEnRoute');
    expect(screenForStatus('in_progress')).toBe('TripProgress');
  });
});

describe('isActiveStatus', () => {
  it('is true only for in-flight statuses', () => {
    for (const s of ['requested', 'matched', 'driver_en_route', 'in_progress']) {
      expect(isActiveStatus(s)).toBe(true);
    }
    for (const s of ['completed', 'cancelled', '', undefined]) {
      expect(isActiveStatus(s)).toBe(false);
    }
  });
});

describe('resumeScreenFor (cold-start resume decision)', () => {
  it('reopens an active ride on its live screen', () => {
    expect(resumeScreenFor({ status: 'requested' })).toBe('FindingDriver');
    expect(resumeScreenFor({ status: 'matched' })).toBe('YouGotTheRide');
    expect(resumeScreenFor({ status: 'driver_en_route' })).toBe('DriverEnRoute');
    expect(resumeScreenFor({ status: 'in_progress' })).toBe('TripProgress');
  });

  it('reopens a finished, never-rated trip on the review screen', () => {
    expect(resumeScreenFor({ status: 'completed', rating: null })).toBe('ReviewRide');
    expect(resumeScreenFor({ status: 'completed' })).toBe('ReviewRide');
  });

  it('does nothing for a rated trip, a cancelled ride, or no ride', () => {
    expect(resumeScreenFor({ status: 'completed', rating: 5 })).toBeNull();
    expect(resumeScreenFor({ status: 'cancelled' })).toBeNull();
    expect(resumeScreenFor(null)).toBeNull();
    expect(resumeScreenFor(undefined)).toBeNull();
  });
});

describe('mayResumeOnLaunch', () => {
  it('allows a resume when the store is empty or holds only a restored ride', () => {
    expect(mayResumeOnLaunch(null)).toBe(true);
    expect(mayResumeOnLaunch(undefined)).toBe(true);
    expect(mayResumeOnLaunch({ source: 'rider-restore' })).toBe(true);
  });

  it("blocks a resume when the rider started their own booking this session", () => {
    expect(mayResumeOnLaunch({})).toBe(false);
    expect(mayResumeOnLaunch({ source: undefined })).toBe(false);
  });
});
