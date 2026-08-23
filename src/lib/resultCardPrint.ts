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
): boolean {
  return status === 'active' && hasPrintPermission;
}
