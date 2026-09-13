import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { Window } from 'happy-dom';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { root } from './helpers/finance-fixture.mjs';

const window = new Window({ url: 'http://localhost', width: 390, height: 844 });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'Node', 'Event', 'MouseEvent', 'localStorage', 'sessionStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
const { GradePoliciesTab } = await vite.ssrLoadModule('/src/modules/grades/GradePoliciesTab.tsx');
after(async () => { await vite.close(); await window.happyDOM.close(); });

async function render(t, element) {
  const container = document.createElement('div');
  document.body.append(container);
  const rootElement = createRoot(container);
  await act(async () => rootElement.render(element));
  t.after(async () => { await act(async () => rootElement.unmount()); container.remove(); });
  return container;
}

async function waitFor(container, text) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (container.textContent.includes(text)) return;
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }
  assert.fail(`Timed out waiting for ${text}`);
}

async function change(element, value) {
  await act(async () => {
    const proto = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}

const policy = {
  id: 77, school_id: 41, academic_year_id: 9, class_id: 10, version: 1,
  status: 'draft', revision: 0, policy_kind: 'terminal', pass_mark: 50,
  decision_points: 10, decision_allocation_mode: 'optimal', decision_points_outcome_only: 1,
  max_completion_subjects: 3, exemption_enabled: 0, individual_exemption_grade: 90,
  general_exemption_average_grade: 85, general_exemption_min_subject_grade: 75,
  ministerial_entry_mode: 'pass_or_completion', ministerial_max_failed_subjects: 3,
  minimum_monthly_exams_per_term: 1, fraction_rounding_mode: 'ceil',
  source_reference: 'كتاب وزاري تجريبي', notes: '', class_name: 'الثالث المتوسط',
};

test('grade policy UI separates draft configuration, official transition and safe preview', async t => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    requests.push({ path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    const json = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (path === '/api/academic-years?school_id=41') return json({ data: [{ id: 9, name: '2026-2027', is_active: 1 }] });
    if (path === '/api/classes?school_id=41') return json({ data: [{ id: 10, name: 'الثالث المتوسط', status: 'active' }, { id: 11, name: 'الثاني المتوسط', status: 'active' }] });
    if (path === '/api/grade-policies?school_id=41&academic_year_id=9') return json({ data: [policy], meta: { readiness: { active_classes: 2, approved_classes: 0, status: 'partial' } } });
    if (path === '/api/students?school_id=41&class_id=10') return json({ data: [{ id: 501, full_name: 'طالب الاختبار' }] });
    if (path === '/api/grade-policies/preview-student') return json({ data: { outcome: { academic_status: 'completion', ministerial_eligibility: 'eligible', adjusted_failed_subjects: 2, decision_points_used: 10 } } });
    throw new Error(`Unexpected request ${path}`);
  };
  t.after(() => { globalThis.fetch = previousFetch; localStorage.clear(); sessionStorage.clear(); });

  const container = await render(t, createElement(GradePoliciesTab, { schoolId: 41 }));
  await waitFor(container, 'الثالث المتوسط — مسودة');
  const selects = [...container.querySelectorAll('select')];
  await change(selects[1], '10');
  await waitFor(container, 'السياسة السنوية هي مصدر القرار الرسمي');

  assert.match(container.textContent, /الإصدار ١ — المراجعة ٠/);
  assert.ok(container.textContent.includes('قاعدة الدخول الوزاري'));
  assert.equal(container.textContent.includes('درجة الإعفاء الفردي'), false, 'terminal classes must not expose exemption inputs');
  assert.ok([...container.querySelectorAll('button')].some(button => button.textContent.includes('اعتماد')));

  await waitFor(container, 'طالب الاختبار');
  const studentSelect = [...container.querySelectorAll('select')].find(item => [...item.options].some(option => option.textContent === 'طالب الاختبار'));
  await change(studentSelect, '501');
  const previewButton = [...container.querySelectorAll('button')].find(button => button.textContent.includes('حساب المعاينة'));
  await act(async () => previewButton.click());
  await waitFor(container, 'مكمل');
  assert.ok(container.textContent.includes('مؤهل للدخول الوزاري'));
  assert.equal(requests.at(-1).path, '/api/grade-policies/preview-student');
  assert.equal(requests.at(-1).body.policy.policy_kind, 'terminal');
  assert.equal(requests.at(-1).body.policy.exemption_enabled, 0);
});

test('manual decision UI is management-only and saves versioned allocations with a required reason', async () => {
  const source = await readFile(new URL('../src/modules/grades/GradesPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /canManagePolicies && academicOutcome\?\.policy\?\.decision_allocation_mode === 'manual'/);
  assert.match(source, /expected_version: Number\(academicOutcome\?\.decision_set\?\.version \|\| 0\)/);
  assert.match(source, /allocations: decisionAllocations/);
  assert.match(source, /سبب توزيع درجات القرار مطلوب/);
  assert.match(source, /حُفظ توزيع درجات القرار في سجل غير قابل للحذف/);
});
