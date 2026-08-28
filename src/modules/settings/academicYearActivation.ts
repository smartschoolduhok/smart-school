export const ACADEMIC_YEAR_ROLLOVER_WARNING = [
  'سيتم تفعيل هذه السنة الدراسية وجعل تسجيلاتها هي المصدر الحالي لمواقع الطلاب.',
  'أي طالب لا يملك تسجيلًا في هذه السنة سيظهر بلا صف أو شعبة.',
  'تأكد من إكمال تسجيل/ترفيع الطلاب قبل المتابعة إذا لم يكن هذا مقصودًا.',
  'هل تريد المتابعة؟',
].join('\n');

export function confirmAcademicYearRollover(
  confirmAction: (message: string) => boolean,
): boolean {
  return confirmAction(ACADEMIC_YEAR_ROLLOVER_WARNING);
}
