export const ACADEMIC_YEAR_ROLLOVER_WARNING = [
  'سيتم تفعيل هذه السنة الدراسية وجعل تسجيلاتها هي المصدر الحالي لمواقع الطلاب.',
  'أي طالب لا يملك تسجيلًا في هذه السنة سيظهر بلا صف أو شعبة.',
  'تعيينات المواد ودرجات السنة السابقة تُؤرشف وتبقى محفوظة، والسنة الجديدة تبدأ بتعيين مواد ودرجات جديدة.',
  'تأكد من إكمال تسجيل/ترفيع الطلاب قبل المتابعة إذا لم يكن هذا مقصودًا.',
  'هل تريد المتابعة؟',
].join('\n');

export function confirmAcademicYearRollover(confirmAction: (message: string) => boolean): boolean;
export function confirmAcademicYearRollover(confirmAction: (message: string) => Promise<boolean>): Promise<boolean>;
export function confirmAcademicYearRollover(
  confirmAction: (message: string) => boolean | Promise<boolean>,
): boolean | Promise<boolean> {
  return confirmAction(ACADEMIC_YEAR_ROLLOVER_WARNING);
}
