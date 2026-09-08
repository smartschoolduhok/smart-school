export const BUSINESS_TIME_ZONE = 'Asia/Baghdad';
export const BUSINESS_TIME_ZONE_LABEL = 'توقيت بغداد (UTC+3)';

export function businessDate(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function businessMonth(value: Date = new Date()): string {
  return businessDate(value).slice(0, 7);
}
