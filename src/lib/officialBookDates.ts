import { formatOfficialBookDate } from './officialBookLayout';

export interface OfficialBookDateRecord {
  created_at: string | number;
  document_date?: string | null;
  settings_snapshot_json?: string | null;
}

export function validateOfficialBookIssueDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) {
    return 'اختر تاريخًا صحيحًا للكتاب';
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? null
    : 'اختر تاريخًا صحيحًا للكتاب';
}

export function todayOfficialBookDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (name: string) => parts.find(value => value.type === name)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatOfficialBookIssueDate(value: string, locale = 'ar-IQ'): string {
  if (validateOfficialBookIssueDate(value)) return '—';
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString(locale, { timeZone: 'UTC' });
}

export function getOfficialBookIssueDate(book: Pick<OfficialBookDateRecord, 'document_date' | 'settings_snapshot_json'>): string | null {
  let snapshotDate: unknown;
  try {
    snapshotDate = JSON.parse(book.settings_snapshot_json || '{}')?.document_date;
  } catch { /* Legacy records may not have a readable snapshot. */ }
  if (typeof snapshotDate === 'string' && !validateOfficialBookIssueDate(snapshotDate)) return snapshotDate;
  if (typeof book.document_date === 'string' && !validateOfficialBookIssueDate(book.document_date)) return book.document_date;
  return null;
}

export function formatOfficialBookDisplayDate(book: OfficialBookDateRecord, locale = 'ar-IQ'): string {
  const issueDate = getOfficialBookIssueDate(book);
  return issueDate ? formatOfficialBookIssueDate(issueDate, locale) : formatOfficialBookDate(book.created_at, locale);
}
