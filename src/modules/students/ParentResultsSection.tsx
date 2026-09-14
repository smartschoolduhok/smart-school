import { useEffect, useState } from 'react';
import { AlertTriangle, Award, ExternalLink, FileCheck2 } from 'lucide-react';
import { getParentStudentResultCards } from '../../lib/api';

function displayValue(value: unknown): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function formatPublishedAt(value: unknown): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  return new Date(seconds * 1000).toLocaleDateString('ar-IQ');
}

function resultClasses(value: unknown): string {
  const status = String(value || '');
  if (status.includes('ناجح') || status.includes('معف')) return 'bg-emerald-100 text-emerald-800';
  if (status.includes('مكمل')) return 'bg-amber-100 text-amber-800';
  if (status.includes('راسب')) return 'bg-red-100 text-red-800';
  return 'bg-slate-100 text-slate-700';
}

function academicStatus(value: unknown): string {
  const status = String(value || '');
  return ({
    pass: 'ناجح',
    completion: 'مكمل',
    fail: 'راسب',
    incomplete: 'غير مكتمل',
    exempt_individual: 'معفى فرديًا',
    exempt_general: 'معفى عامًا',
  } as Record<string, string>)[status] || displayValue(value);
}

function exemptionStatus(value: unknown): string {
  const status = String(value || '');
  return ({
    not_applicable: 'غير مطبق',
    none: 'لا يوجد إعفاء',
    individual: 'إعفاء فردي',
    general: 'إعفاء عام',
  } as Record<string, string>)[status] || displayValue(value);
}

export default function ParentResultsSection({ studentId }: { studentId: number }) {
  const [cards, setCards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setCards([]);
    void getParentStudentResultCards(studentId).then((response) => {
      if (!active) return;
      if (response.error) setError(response.error);
      else setCards(Array.isArray(response.data?.cards) ? response.data.cards : []);
      setLoading(false);
    });
    return () => { active = false; };
  }, [studentId]);

  if (loading) {
    return <section className="rounded-xl border border-blue-200 bg-white p-6" aria-label="النتائج المرسلة"><p className="text-center text-sm text-gray-500">جاري تحميل النتائج المرسلة...</p></section>;
  }
  if (error) {
    return <section className="rounded-xl border border-red-200 bg-red-50 p-5" aria-label="النتائج المرسلة"><div className="flex items-center gap-2 text-red-700"><AlertTriangle size={19} /><span>{error}</span></div></section>;
  }

  return (
    <section className="overflow-hidden rounded-xl border border-blue-200 bg-white" aria-label="النتائج المرسلة">
      <div className="flex items-center gap-3 border-b border-blue-100 bg-blue-50 px-6 py-4">
        <div className="rounded-xl bg-blue-100 p-2 text-blue-700"><Award size={22} /></div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">النتائج المرسلة من المدرسة</h2>
          <p className="text-xs text-gray-600">تظهر هنا فقط النتائج التي أرسلتها المدرسة إلى حساب ولي الأمر</p>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="p-8 text-center">
          <FileCheck2 className="mx-auto mb-2 text-gray-300" size={34} />
          <p className="text-sm font-medium text-gray-700">لم ترسل المدرسة نتيجة لهذا الطالب حاليًا.</p>
          <p className="mt-1 text-xs text-gray-500">الكارت المطبوع للطالب لا يظهر هنا حتى ترسله المدرسة إلى هذا الحساب.</p>
        </div>
      ) : (
        <div className="space-y-5 p-5 sm:p-6">
          {cards.map((result) => {
            const summary = result.card?.summary || {};
            const subjects = Array.isArray(result.card?.subjects) ? result.card.subjects : [];
            const overall = summary.academic_status || summary.overall_result_status || result.overall_result_status;
            return (
              <article key={result.id} className="overflow-hidden rounded-xl border border-gray-200">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-gray-50 px-4 py-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-gray-900">{displayValue(result.academic_year)}</h3>
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${resultClasses(overall)}`}>{displayValue(overall)}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{displayValue(result.class_name)}{result.section_name ? ` / ${result.section_name}` : ''} · أُرسلت {formatPublishedAt(result.published_at)}</p>
                  </div>
                  <a href={`/verify/result-card/${result.verification_token}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">
                    تحقق من النتيجة <ExternalLink size={14} />
                  </a>
                </div>

                <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">النتيجة</p><p className="mt-1 font-bold text-gray-900">{displayValue(overall)}</p></div>
                  <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">الدخول الوزاري</p><p className="mt-1 font-bold text-gray-900">{displayValue(summary.ministerial_eligibility)}</p></div>
                  <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">الإعفاء</p><p className="mt-1 font-bold text-gray-900">{result.general_exemption_status ? 'إعفاء عام' : exemptionStatus(summary.exemption_status)}</p></div>
                  <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">الدور</p><p className="mt-1 font-bold text-gray-900">{displayValue(result.card?.exam_round)}</p></div>
                  {Number(summary.decision_points_used || 0) > 0 && <div className="rounded-lg bg-amber-50 p-3"><p className="text-xs text-amber-700">درجات القرار المستخدمة</p><p className="mt-1 font-bold text-gray-900">{displayValue(summary.decision_points_used)}</p></div>}
                </div>

                {summary.ministerial_reason && summary.ministerial_eligibility_code !== 'not_applicable' && (
                  <div className="mx-4 mb-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-6 text-blue-900">
                    <span className="font-bold">سبب قرار الدخول الوزاري: </span>{summary.ministerial_reason}
                  </div>
                )}
                {(summary.completion_subject_names || []).length > 0 && (
                  <div className="mx-4 mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span className="font-bold">مواد الإكمال: </span>{summary.completion_subject_names.join('، ')}</div>
                )}
                {(summary.failed_subject_names || []).length > 0 && (
                  <div className="mx-4 mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"><span className="font-bold">مواد الرسوب: </span>{summary.failed_subject_names.join('، ')}</div>
                )}

                {subjects.length > 0 && (
                  <div className="overflow-x-auto border-t border-gray-100">
                    <table className="w-full min-w-[620px] text-sm">
                      <thead className="bg-blue-50/60 text-gray-600"><tr><th className="p-3 text-right">المادة</th><th className="p-3 text-center">الدرجة</th><th className="p-3 text-center">درجات القرار</th><th className="p-3 text-center">بعد القرار</th><th className="p-3 text-center">الحالة</th></tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {subjects.map((subject: any, index: number) => (
                          <tr key={`${subject.subject_id ?? index}`}>
                            <td className="p-3 font-semibold text-gray-900">{displayValue(subject.subject_name)}</td>
                            <td className="p-3 text-center">{displayValue(subject.policy_source_grade ?? subject.effective_grade ?? subject.final_grade)}</td>
                            <td className="p-3 text-center">{displayValue(subject.decision_points ?? 0)}</td>
                            <td className="p-3 text-center font-bold">{displayValue(subject.adjusted_grade ?? subject.effective_grade ?? subject.final_grade)}</td>
                            <td className="p-3 text-center">{academicStatus(subject.academic_status ?? subject.result_status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
