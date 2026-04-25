import { describe, expect, it } from 'vitest';
import {
    formatLocalDate,
    formatLocalDateTime,
    formatLocalIsoTimestamp,
    formatLocalMinuteStamp,
    formatLocalSecondStampCompact,
    formatLocalTime,
    formatLocalTimeForFilename,
    formatTimestampForDisplay,
    getCurrentTimeZone,
} from '../src/time.js';

describe('time helpers', () => {
    it('formats human-readable date and time using the provided timezone', () => {
        const date = new Date('2026-04-21T16:05:06.000Z');

        expect(formatLocalDate(date, 'Asia/Shanghai')).toBe('2026-04-22');
        expect(formatLocalTime(date, 'Asia/Shanghai')).toBe('00:05:06');
        expect(formatLocalDateTime(date, 'Asia/Shanghai')).toBe('2026-04-22 00:05:06');
        expect(formatLocalTimeForFilename(date, 'Asia/Shanghai')).toBe('00-05-06');
        expect(formatLocalMinuteStamp(date, 'Asia/Shanghai')).toBe('2026-04-22-00-05');
        expect(formatLocalSecondStampCompact(date, 'Asia/Shanghai')).toBe('2026-04-22-00-05-06'.replace(/-/g, ''));
        expect(formatLocalIsoTimestamp(date, 'Asia/Shanghai')).toBe('2026-04-22T00:05:06.000+08:00');
        expect(formatLocalIsoTimestamp(date, 'UTC')).toBe('2026-04-21T16:05:06.000+00:00');
        expect(formatTimestampForDisplay('2026-04-21T16:05:06.000Z', 'Asia/Shanghai')).toBe('2026-04-22 00:05:06');
        expect(formatTimestampForDisplay(null, 'Asia/Shanghai')).toBe('-');
    });

    it('uses the current system timezone by default', () => {
        const date = new Date('2026-04-21T16:05:06.000Z');
        const timeZone = getCurrentTimeZone();

        expect(timeZone).toBeTruthy();
        expect(formatLocalDate(date)).toBe(formatLocalDate(date, timeZone));
        expect(formatLocalTime(date)).toBe(formatLocalTime(date, timeZone));
    });
});
