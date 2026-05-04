// ===========================================
// Arabic-Indic Digit Converter
// Converts Western digits 0123456789 to Arabic-Indic digits ٠١٢٣٤٥٦٧٨٩
// ===========================================

const DIGIT_MAP: Record<string, string> = {
  '0': '٠',
  '1': '١',
  '2': '٢',
  '3': '٣',
  '4': '٤',
  '5': '٥',
  '6': '٦',
  '7': '٧',
  '8': '٨',
  '9': '٩',
};

/**
 * Convert Western digits in a string to Arabic-Indic digits
 * Example: toArabicDigits("1234") => "١٢٣٤"
 */
export function toArabicDigits(input: string | number): string {
  const str = String(input);
  return str.replace(/[0-9]/g, (digit) => DIGIT_MAP[digit] || digit);
}

/**
 * Format a number with Arabic-Indic digits and optional comma separators
 * Example: formatArabicNumber(1234) => "١٬٢٣٤"
 */
export function formatArabicNumber(num: number): string {
  const formatted = new Intl.NumberFormat('ar-SA').format(num);
  return formatted.replace(/[0-9]/g, (digit) => DIGIT_MAP[digit] || digit);
}

/**
 * Convert a date string to Arabic-Indic digits
 */
export function toArabicDate(dateStr: string): string {
  return toArabicDigits(dateStr);
}
