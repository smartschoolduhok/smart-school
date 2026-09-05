import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fixture,root,invalidateAssignedTeacher } from './helpers/teaching-load-matrix-fixture.mjs';
import { loadTeachingLoadMatrix,publicTeachingLoadMatrix } from '../src/lib/teachingLoadMatrixDb.ts';
import { planTeachingLoadMatrix,applyMatrixRow,matrixDraftChanges,matrixCellPresentation } from '../src/lib/teachingLoadMatrix.ts';
const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {TeachingLoadMatrixTab,MatrixPlanSummary,MatrixSummaryDetails}=await vite.ssrLoadModule('/src/modules/timetable/TeachingLoadMatrixTab.tsx');
after(()=>vite.close());
const source=readFileSync(join(root,'src/modules/timetable/TeachingLoadMatrixTab.tsx'),'utf8');
const page=readFileSync(join(root,'src/modules/timetable/TimetablePage.tsx'),'utf8');
test('actual component default render is sorted class cards, not global load editor',()=>{
 const f=fixture();const html=renderToStaticMarkup(React.createElement(TeachingLoadMatrixTab,{
  schoolId:1,academicYearId:1,classes:f.db.prepare('SELECT * FROM classes').all(),
  sections:f.db.prepare('SELECT * FROM sections').all(),subjects:f.db.prepare('SELECT * FROM subjects').all(),
  loads:f.db.prepare('SELECT * FROM timetable_teaching_loads').all(),years:[],dataVersion:0,
  onChanged:async()=>{},onDirtyChange:()=>{},onAdvanced:()=>{},
 }));
 assert.match(html,/dir="rtl"/);assert.match(html,/فتح مصفوفة النصاب/);assert.match(html,/تعديل متقدم/);
 assert.ok(html.indexOf('Class B')<html.indexOf('Class A'));assert.ok(!html.includes('Archived'));assert.match(html,/الصف بالكامل/);
 assert.ok(!html.includes('Secret'));assert.match(html,/2 من 5 نصابًا/);
 assert.ok(!html.includes('<table'));assert.match(page,/tab === 'loads' && !advancedLoads/);
});
test('real preview component displays exact old/new teachers and counts with locked warnings',async()=>{
 const f=fixture();const c=await loadTeachingLoadMatrix(f.d1,1,1,1);
 const plan=planTeachingLoadMatrix(c,[{subject_id:1,section_id:1,employee_id:1,weekly_periods:3,action:'upsert'}]);
 const html=renderToStaticMarkup(React.createElement(MatrixPlanSummary,{plan}));
 assert.match(html,/بدون مدرس/);assert.match(html,/Teacher A/);assert.match(html,/الحصص: 4 ← 3/);assert.match(html,/تحديث: 1/);
 assert.match(source,/preview\.can_apply && <button/);assert.match(source,/confirm_apply: true/);
});
test('all-section controls and per-section overrides exercise the exact UI draft reducer',async()=>{
 const f=fixture();const data=publicTeachingLoadMatrix(await loadTeachingLoadMatrix(f.d1,1,1,1));
 let d=applyMatrixRow(data,{},1,{periods:'3'});
 d=applyMatrixRow(data,d,1,{employeeId:1});
 d['1:2']={...d['1:2'],employeeId:2,periods:'2'};
 const changes=matrixDraftChanges(data,d);
 assert.deepEqual(changes.map(c=>[c.section_id,c.employee_id,c.weekly_periods]),[[1,1,3],[2,2,2]]);
 assert.deepEqual(matrixDraftChanges(data,{}),[]);
});
test('scope/year/class navigation and beforeunload protect dirty drafts',()=>{
 assert.match(page,/selectSchool=.*allowMatrixLeave/);assert.match(page,/if \(allowMatrixLeave\(\)\).*setAcademicYearId/);
 assert.match(page,/key === tab \|\| allowMatrixLeave\(\)/);
 assert.match(source,/allowLeave\(\).*setClassId\(null\)/);
 assert.match(source,/window\.addEventListener\('beforeunload'/);
 assert.match(page,/key=\{\`\$\{schoolId\}:\$\{academicYearId\}\`\}/);
});
test('every async path guards generation; edits immediately discard preview; successful save clears draft and reloads',()=>{
 assert.equal((source.match(/if \(!current\(\)\) return;/g)||[]).length,4);
 const edit=source.slice(source.indexOf('function changeDraft'),source.indexOf('function reset'));
 assert.match(edit,/guard\.invalidate\(\)/);assert.match(edit,/setPreview\(null\)/);
 assert.match(source,/setDraft\(\{\}\); setRowInputs\(\{\}\); setCopy\(null\)/);
 assert.match(source,/await props\.onChanged\(\)/);
 assert.match(page,/onChanged=\{reloadYearData\}/);
});
test('copy dialog only populates draft and then requires normal preview/apply',()=>{
 assert.match(source,/role="dialog".*aria-label="نسخ النصاب من سنة سابقة"/);
 assert.match(source,/value="periods_only"/);assert.match(source,/value="periods_and_teachers"/);
 const accept=source.slice(source.indexOf('function acceptCopy'),source.indexOf('const cards'));
 assert.match(accept,/changeDraft\(next\)/);assert.doesNotMatch(accept,/applyTeachingLoadMatrix|fetch\(/);
 assert.match(source,/تحميل إلى المسودة — دون حفظ/);
});
test('matrix layout keeps accessible applicable cells, sticky RTL subject and bounded horizontal scrolling',()=>{
 for(const label of ['الصف بالكامل','غير منطبق','خاص بالشعبة','إظهار الأنصبة الناقصة فقط','إظهار بدون مدرس فقط','إظهار التغييرات فقط','مختلف حسب الشعبة','تعطيل هذا النصاب','إعادة الصف إلى القيم المحفوظة'])assert.ok(source.includes(label),label);
 assert.match(source,/max-w-full overflow-x-auto/);assert.match(source,/sticky right-0/);assert.match(source,/aria-disabled="true"/);
 assert.match(source,/aria-label=\{\`مدرس/);assert.match(source,/aria-label=\{\`حصص/);
 assert.doesNotMatch(source,/\bfetch\(/);
});

for(const kind of ['archived','nonteacher','other-school','missing'])test(`rendered ${kind} teacher summary agrees on class card, header and projected preview`,async()=>{
 const f=fixture();invalidateAssignedTeacher(f.db,kind);const c=await loadTeachingLoadMatrix(f.d1,1,1,1);const data=publicTeachingLoadMatrix(c);
 const props={schoolId:1,academicYearId:1,classes:[c.class],sections:c.sections,subjects:c.subjects,loads:c.loads,years:[],dataVersion:0,onChanged:async()=>{},onDirtyChange:()=>{},onAdvanced:()=>{}};
 const card=renderToStaticMarkup(React.createElement(TeachingLoadMatrixTab,props));
 const header=renderToStaticMarkup(React.createElement(MatrixSummaryDetails,{summary:data.summary}));
 assert.ok(card.includes(header));assert.match(card,/يحتاج إصلاح تعيين المدرسين/);
 for(const html of [card,header]){assert.match(html,/1 مدرس غير متاح/);assert.match(html,/1 بدون مدرس/);assert.match(html,/الاكتمال: 0%/);assert.match(html,/إجمالي الحصص: 8/);assert.doesNotMatch(html,/Secret/);}
 const plan=planTeachingLoadMatrix(c,[{subject_id:1,section_id:2,action:'upsert',employee_id:1,weekly_periods:4}]);
 const preview=renderToStaticMarkup(React.createElement(MatrixPlanSummary,{plan}));assert.match(preview,/مدرس غير متاح بعد الحفظ: 0/);assert.match(preview,/الاكتمال: 20%/);
 const load=c.loads.find(l=>l.id===2);const cell=matrixCellPresentation(load,load.employee_id,c.teachers,1);assert.equal(cell.tone,'bg-red-50');assert.notEqual(cell.label,'مكتمل');
 // These are the same behavioral presenters rendered in the selected header/cell.
 assert.match(source,/<MatrixSummaryDetails summary=\{data.summary\}/);assert.match(source,/matrixCellPresentation\(load, teacher, data.teachers, schoolId\)/);
 assert.match(source,/presentation.state === 'invalid_teacher' \? 'bg-red-50'/);assert.match(source,/value="invalid-teacher"/);assert.match(source,/matrixLoadTeacherState\(l\) === 'invalid_teacher'/);
});
