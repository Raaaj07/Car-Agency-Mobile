import { cancellationReasonText } from './cancellation';

describe('cancellationReasonText', () => {
  it('returns null for a missing or blank reason (never invents one)', () => {
    expect(cancellationReasonText(undefined)).toBeNull();
    expect(cancellationReasonText(null)).toBeNull();
    expect(cancellationReasonText('')).toBeNull();
    expect(cancellationReasonText('   ')).toBeNull();
  });

  it('keeps a sentence the rider or an admin wrote as it is', () => {
    expect(cancellationReasonText('Changed my mind / No longer needed')).toBe('Changed my mind / No longer needed');
    expect(cancellationReasonText('  Driver asked me to cancel the trip ')).toBe('Driver asked me to cancel the trip');
  });

  it('turns the known system code into plain words', () => {
    expect(cancellationReasonText('no_drivers_available')).toBe('No drivers were available nearby');
  });

  it('humanises any other machine code', () => {
    expect(cancellationReasonText('stale_ride')).toBe('Stale ride');
    expect(cancellationReasonText('admin_cancelled')).toBe('Admin cancelled');
  });

  it('does not treat a one-word sentence with capitals as a code', () => {
    expect(cancellationReasonText('Emergency')).toBe('Emergency');
  });
});
