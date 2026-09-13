import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
const { ResultCardDocument } = await vite.ssrLoadModule('/src/components/resultCards/ResultCardDocument.tsx');
after(() => vite.close());

const card = {
  id: 77,
  status: 'active',
  card_number: 'RC-2026-00077',
  generated_at: 1789290000,
  verification_token: 'qa-result-card-v6',
};

function render(data) {
  return renderToStaticMarkup(React.createElement(ResultCardDocument, {
    card,
    data,
    verificationUrl: 'https://school.example/verify/result-card/qa-result-card-v6',
  }));
}

function baseData(kind) {
  return {
    schema_version: 6,
    template_kind: kind,
    card_mode: 'complete',
    school: {
      name: 'مدرسة دهوك البريطانية الدولية',
      name_en: 'Duhok British International School',
      phone: '0750 000 0000',
    },
    student: {
      name: 'أحمد لقمان فاضل',
      student_number: 'G11-695',
      gender: 'ذكر',
      photo_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
    },
    class: { name: kind === 'terminal' ? 'الثالث المتوسط' : 'الرابع العلمي' },
    section: { name: 'أ' },
    academic_year: { name: '2026-2027' },
    exam_round: 'الدور الأول',
    academic_policy: { policy_kind: kind, version: 1 },
    document_settings: {
      result_card_display_settings: {
        show_student_number: true,
        show_gender: true,
        show_school_logo: false,
        show_qr_code: true,
        show_verification_code_text: true,
        show_signatures_block: true,
        show_school_stamp_placeholder: true,
      },
      result_card_footer_text: 'وثيقة مدرسية رسمية',
    },
  };
}

test('terminal v6 card renders the ministerial decision trail in a compact bilingual document', () => {
  const html = render({
    ...baseData('terminal'),
    visible_columns: [
      { key: 'subject_name', label: 'المادة', label_en: 'Subject' },
      { key: 'policy_source_grade', label: 'الدرجة المعتمدة', label_en: 'Policy grade' },
      { key: 'decision_points', label: 'درجات القرار', label_en: 'Decision points' },
      { key: 'adjusted_grade', label: 'بعد القرار', label_en: 'Adjusted grade' },
      { key: 'academic_status', label: 'الحالة', label_en: 'Status' },
    ],
    subjects: [
      { subject_id: 1, subject_name: 'اللغة العربية', policy_source_grade: 44, decision_points: 6, adjusted_grade: 50, academic_status: 'pass' },
      { subject_id: 2, subject_name: 'اللغة الإنكليزية', policy_source_grade: 35, decision_points: 0, adjusted_grade: 35, academic_status: 'fail' },
    ],
    summary: {
      academic_status: 'مكمل',
      academic_status_code: 'completion',
      overall_result_status: 'مكتمل',
      ministerial_eligibility: 'مؤهل للدخول الوزاري',
      ministerial_eligibility_code: 'eligible',
      ministerial_reason: 'مكمل في مادتين بعد توزيع 10 درجات قرار',
      exemption_status: 'not_applicable',
      decision_points_used: 10,
      pass_count: 1,
      completion_count: 1,
      fail_count: 0,
      completion_subject_names: ['اللغة الإنكليزية', 'الرياضيات'],
    },
  });
  for (const expected of [
    'RESULT CARD',
    'Terminal grade',
    'Student name',
    'Policy grade',
    'Decision points',
    'مكمل / Supplementary',
    'مواد الإكمال / Supplementary subjects',
    'اللغة الإنكليزية، الرياضيات',
    'سبب قرار الدخول الوزاري / Ministerial-entry basis',
    'مكمل في مادتين بعد توزيع 10 درجات قرار',
    'الصورة / Photo',
    'Official stamp',
  ]) assert.match(html, new RegExp(expected));
  assert.doesNotMatch(html, /Month 1|Month 2/);
});

test('non-terminal v6 card makes individual exemption and its subjects explicit', () => {
  const html = render({
    ...baseData('non_terminal'),
    visible_columns: [
      { key: 'subject_name', label: 'المادة', label_en: 'Subject' },
      { key: 'annual_effort', label: 'السعي السنوي', label_en: 'Annual effort' },
      { key: 'decision_points', label: 'درجات القرار', label_en: 'Decision points' },
      { key: 'adjusted_grade', label: 'بعد القرار', label_en: 'Adjusted grade' },
      { key: 'academic_status', label: 'الحالة', label_en: 'Status' },
      { key: 'exemption_detail', label: 'الإعفاء', label_en: 'Exemption' },
    ],
    subjects: [
      { subject_id: 1, subject_name: 'اللغة العربية', annual_effort: 96, decision_points: 0, adjusted_grade: 96, academic_status: 'exempt_individual', exemption_status: 1 },
      { subject_id: 2, subject_name: 'الفيزياء', annual_effort: 45, decision_points: 0, adjusted_grade: 45, academic_status: 'fail', exemption_status: 0 },
    ],
    summary: {
      academic_status: 'مكمل',
      academic_status_code: 'completion',
      overall_result_status: 'مكتمل',
      exemption_status: 'individual',
      decision_points_used: 0,
      pass_count: 0,
      completion_count: 1,
      fail_count: 0,
      exempt_count: 1,
      completion_subject_names: ['الفيزياء'],
      exempt_subject_names: ['اللغة العربية'],
    },
  });
  for (const expected of [
    'Non-terminal grade',
    'إعفاء فردي',
    'يوجد إعفاء فردي / Applied',
    'مواد الإعفاء / Exempt subjects',
    'معفى فرديًا / Individually exempt',
    'الفيزياء',
  ]) assert.match(html, new RegExp(expected));
});
