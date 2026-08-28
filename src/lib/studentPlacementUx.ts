export const FINALIZED_STUDENT_PLACEMENT_MESSAGE =
  'تم إغلاق تسجيل هذه السنة الدراسية بعد الترفيع/الإعادة/التخرج، لذلك لا يمكن تعديل الصف أو الشعبة من صفحة الطالب. لتصحيح قرار الانتقال يجب استخدام إجراء مخصص لإدارة الترفيع.';

export function isStudentPlacementFinalized(
  enrollmentStatus: string | null | undefined,
  promotionStatus: string | null | undefined,
): boolean {
  if (enrollmentStatus == null && promotionStatus == null) return false;
  return enrollmentStatus !== 'active' || promotionStatus !== 'pending';
}
