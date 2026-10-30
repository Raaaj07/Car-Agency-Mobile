import {
  ANNOUNCEMENT_LANGUAGES,
  DEFAULT_ANNOUNCEMENT_PREFS,
  parseAnnouncementPrefs,
  serializeAnnouncementPrefs,
} from './announcementPrefs';

describe('announcement preferences', () => {
  it('returns the defaults when nothing is stored or the text is not JSON', () => {
    expect(parseAnnouncementPrefs(null)).toEqual(DEFAULT_ANNOUNCEMENT_PREFS);
    expect(parseAnnouncementPrefs(undefined)).toEqual(DEFAULT_ANNOUNCEMENT_PREFS);
    expect(parseAnnouncementPrefs('')).toEqual(DEFAULT_ANNOUNCEMENT_PREFS);
    expect(parseAnnouncementPrefs('not json')).toEqual(DEFAULT_ANNOUNCEMENT_PREFS);
    expect(parseAnnouncementPrefs('42')).toEqual(DEFAULT_ANNOUNCEMENT_PREFS);
    expect(parseAnnouncementPrefs('null')).toEqual(DEFAULT_ANNOUNCEMENT_PREFS);
  });

  it('round-trips what was saved', () => {
    const saved = {
      voiceAlerts: false,
      arrivalChime: true,
      speedAlerts: true,
      voiceLang: ANNOUNCEMENT_LANGUAGES[1],
      volume: 'Loud' as const,
    };
    expect(parseAnnouncementPrefs(serializeAnnouncementPrefs(saved))).toEqual(saved);
  });

  it('keeps valid fields and defaults only the invalid ones', () => {
    const parsed = parseAnnouncementPrefs(
      JSON.stringify({ voiceAlerts: false, arrivalChime: 'yes', voiceLang: 'Klingon', volume: 'Loud' }),
    );
    expect(parsed.voiceAlerts).toBe(false);
    expect(parsed.arrivalChime).toBe(DEFAULT_ANNOUNCEMENT_PREFS.arrivalChime);
    expect(parsed.voiceLang).toBe(DEFAULT_ANNOUNCEMENT_PREFS.voiceLang);
    expect(parsed.volume).toBe('Loud');
  });
});
