import { displayIndividualExemptionDetail } from './gradePresentation.ts';

export type ExemptionStatus = 0 | 1;

export function formatExemptionStatus(
  status: ExemptionStatus,
  kind: 'individual' | 'general',
): string {
  if (kind === 'individual') return displayIndividualExemptionDetail(status);
  if (status !== 1) return 'غير معفى';
  return 'معفى عام';
}

export function unixSecondsToDate(
  timestamp: number | string | null | undefined,
): Date | null {
  if (timestamp === null || timestamp === undefined || timestamp === '') return null;
  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp)) return null;
  return new Date(Number(timestamp) * 1000);
}

export function formatUnixSecondsDate(
  timestamp: number | string | null | undefined,
  locale = 'ar-SA',
): string {
  return unixSecondsToDate(timestamp)?.toLocaleDateString(locale) ?? '-';
}

export function shouldRegisterResultCardPrint(
  status: string,
  hasPrintPermission: boolean,
  publicationStatus: string = 'published',
): boolean {
  return status === 'active' && publicationStatus === 'published' && hasPrintPermission;
}

export function isResultCardPrintable(
  status: string | null | undefined,
  publicationStatus: string | null | undefined,
): boolean {
  return status === 'active' && (publicationStatus === 'draft' || publicationStatus === 'published');
}

export const RESULT_CARD_BATCH_PRINT_LIMIT = 100;

export function parseResultCardBatchIds(value: string | null | undefined): number[] {
  if (!value) return [];
  const ids = value.split(',').flatMap((part) => {
    const normalized = part.trim();
    if (!/^\d+$/.test(normalized)) return [];
    const id = Number(normalized);
    return Number.isSafeInteger(id) && id > 0 ? [id] : [];
  });
  return [...new Set(ids)].slice(0, RESULT_CARD_BATCH_PRINT_LIMIT);
}
