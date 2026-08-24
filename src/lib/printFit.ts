export const PRINT_FIT_SAFETY_FACTOR = 0.985;

export interface PrintFitDimensions {
  availableWidth: number;
  availableHeight: number;
  contentWidth: number;
  contentHeight: number;
  safetyFactor?: number;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function calculateSinglePagePrintScale({
  availableWidth,
  availableHeight,
  contentWidth,
  contentHeight,
  safetyFactor = PRINT_FIT_SAFETY_FACTOR,
}: PrintFitDimensions): number {
  if (
    !isPositiveFinite(availableWidth) ||
    !isPositiveFinite(availableHeight) ||
    !isPositiveFinite(contentWidth) ||
    !isPositiveFinite(contentHeight)
  ) {
    return 1;
  }

  const fitRatio = Math.min(
    1,
    availableWidth / contentWidth,
    availableHeight / contentHeight,
  );
  if (fitRatio >= 1) return 1;

  const safeFactor = Number.isFinite(safetyFactor)
    ? Math.min(1, Math.max(0, safetyFactor))
    : PRINT_FIT_SAFETY_FACTOR;
  const safeScale = fitRatio * safeFactor;

  // Round down so fractional-pixel print rounding cannot create a second page.
  return Math.floor(safeScale * 10_000) / 10_000;
}
