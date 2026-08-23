export function displayGradeStatus(
  resultStatus: string | null | undefined,
  exemptionStatus: number | null | undefined,
): string | null {
  if (exemptionStatus === 1) return 'معفو';
  return resultStatus ?? null;
}
