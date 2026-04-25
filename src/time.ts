type TimeParts = {
    year: string;
    month: string;
    day: string;
    hour: string;
    minute: string;
    second: string;
};

export function getCurrentTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function formatLocalDate(date: Date = new Date(), timeZone: string = getCurrentTimeZone()): string {
    const parts = getTimeParts(date, timeZone);
    return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatLocalTime(date: Date = new Date(), timeZone: string = getCurrentTimeZone()): string {
    const parts = getTimeParts(date, timeZone);
    return `${parts.hour}:${parts.minute}:${parts.second}`;
}

export function formatLocalDateTime(date: Date = new Date(), timeZone: string = getCurrentTimeZone()): string {
    return `${formatLocalDate(date, timeZone)} ${formatLocalTime(date, timeZone)}`;
}

export function formatLocalTimeForFilename(date: Date = new Date(), timeZone: string = getCurrentTimeZone()): string {
    const parts = getTimeParts(date, timeZone);
    return `${parts.hour}-${parts.minute}-${parts.second}`;
}

export function formatLocalMinuteStamp(date: Date = new Date(), timeZone: string = getCurrentTimeZone()): string {
    const parts = getTimeParts(date, timeZone);
    return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}-${parts.minute}`;
}

export function formatLocalSecondStampCompact(date: Date = new Date(), timeZone: string = getCurrentTimeZone()): string {
    const parts = getTimeParts(date, timeZone);
    return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

export function formatLocalIsoTimestamp(date: Date = new Date(), timeZone: string = getCurrentTimeZone()): string {
    const parts = getTimeParts(date, timeZone);
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
    const offsetMinutes = getOffsetMinutes(date, parts);
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteMinutes = Math.abs(offsetMinutes);
    const offsetHours = String(Math.floor(absoluteMinutes / 60)).padStart(2, '0');
    const offsetRemainderMinutes = String(absoluteMinutes % 60).padStart(2, '0');

    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${milliseconds}${sign}${offsetHours}:${offsetRemainderMinutes}`;
}

export function formatTimestampForDisplay(timestamp?: string | null, timeZone: string = getCurrentTimeZone()): string {
    if (!timestamp) return '-';

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;
    return formatLocalDateTime(date, timeZone);
}

function getTimeParts(date: Date, timeZone: string): TimeParts {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });

    const values = formatter
        .formatToParts(date)
        .filter(part => part.type !== 'literal')
        .reduce<Partial<TimeParts>>((acc, part) => {
            acc[part.type as keyof TimeParts] = part.value;
            return acc;
        }, {});

    return {
        year: values.year ?? '0000',
        month: values.month ?? '00',
        day: values.day ?? '00',
        hour: values.hour ?? '00',
        minute: values.minute ?? '00',
        second: values.second ?? '00',
    };
}

function getOffsetMinutes(date: Date, parts: TimeParts): number {
    const zonedTimeAsUtc = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
        date.getMilliseconds(),
    );
    return Math.round((zonedTimeAsUtc - date.getTime()) / 60_000);
}
