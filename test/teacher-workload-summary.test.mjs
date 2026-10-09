import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateTeacherWorkloadSummary } from '../src/lib/teacherWorkloadSummary.ts';

const teacher = (id, patch={}) => ({id,school_id:1,full_name:`Teacher ${id}`,role:'teacher',status:'active',...patch});
const load = (id, employee_id, patch={}) => ({
  id,school_id:1,academic_year_id:1,class_id:1,section_id:1,subject_id:id,employee_id,weekly_periods:9,status:'active',
  class_status:'active',class_school_id:1,active_section_count:1,section_status:'active',section_school_id:1,section_class_id:1,
  subject_status:'active',subject_school_id:1,subject_class_id:1,subject_section_id:null,
  employee_status:'active',employee_school_id:1,employee_role:'teacher',parallel_with_load_id:null,...patch,
});
const entry = (id, teaching_load_id, patch={}) => ({id,school_id:1,academic_year_id:1,slot_id:1,teaching_load_id,...patch});
const fixture = patch => ({
  schoolId:1,academicYearId:1,teachers:[teacher(1),teacher(2),teacher(3)],
  days:[{id:1,school_id:1,academic_year_id:1,day_of_week:0,is_active:1}],
  slots:[{id:1,school_id:1,academic_year_id:1,day_of_week:0,is_active:1,slot_type:'lesson'}],
  loads:[load(1,1),load(2,2)],entries:[entry(1,1)],...patch,
});
const counts = result => Object.fromEntries(result.teachers.map(row=>[row.employee_id,row.weekly_periods]));

test('detail groups the same saved lessons by class, section and subject IDs and reconciles every total',()=>{
  const input=fixture({loads:[
    load(1,1,{class_name:'الأول المتوسط',section_name:'أ',subject_id:8,subject_name:'الرياضيات'}),
    load(2,1,{class_name:'الأول المتوسط',section_name:'أ',subject_id:8,subject_name:'الرياضيات'}),
    load(3,1,{class_name:'الأول المتوسط',section_name:'ب',section_id:2,subject_id:8,subject_name:'الرياضيات'}),
    load(4,1,{class_name:'الأول المتوسط',section_name:'أ',subject_id:9,subject_name:'الفيزياء'}),
    load(5,2,{class_name:'الأول المتوسط',section_name:'أ',subject_id:8,subject_name:'الرياضيات'}),
  ], entries:[entry(1,1),entry(1,1),entry(2,1),entry(3,2),entry(4,3),entry(5,4),entry(6,5)]});
  const before=structuredClone(input), result=aggregateTeacherWorkloadSummary(input);
  const first=result.teachers.find(row=>row.employee_id===1);
  assert.equal(first.breakdown.length,3);
  assert.deepEqual(first.breakdown.find(row=>row.section_id===1&&row.subject_id===8),{
    class_id:1,class_name:'الأول المتوسط',section_id:1,section_name:'أ',subject_id:8,subject_name:'الرياضيات',weekly_periods:3,
  });
  for(const teacher of result.teachers) assert.equal(teacher.breakdown.reduce((sum,row)=>sum+row.weekly_periods,0),teacher.weekly_periods);
  assert.deepEqual(result.teachers.find(row=>row.employee_id===3).breakdown,[]);
  assert.equal(result.total_weekly_periods,6);
  assert.deepEqual(input,before);
});

test('same subject labels remain distinct by ID and sections without an assignment are represented explicitly',()=>{
  const result=aggregateTeacherWorkloadSummary(fixture({loads:[
    load(1,1,{subject_name:'المادة نفسها',section_id:null,active_section_count:0,section_name:null}),
    load(2,1,{subject_name:'المادة نفسها',section_id:null,active_section_count:0,section_name:null}),
    load(3,1,{subject_name:'مادة غير مجدولة'}),
  ],entries:[entry(1,1),entry(2,2)]}));
  const details=result.teachers.find(row=>row.employee_id===1).breakdown;
  assert.deepEqual(details.map(row=>row.subject_id),[1,2]);
  assert.ok(details.every(row=>row.section_id===null&&row.section_name===null&&row.weekly_periods===1));
  assert.doesNotMatch(JSON.stringify(details),/غير مجدولة/);
});

test('saved entries are counted once by ID, names are not merged, zero teachers remain, and inputs are unchanged',()=>{
  const input=fixture({teachers:[teacher(2,{full_name:'Same name'}),teacher(1,{full_name:'Same name'}),teacher(3)],
    entries:[entry(1,1),entry(1,1),entry(2,1),entry(3,2)]});
  const before=structuredClone(input),result=aggregateTeacherWorkloadSummary(input);
  assert.deepEqual(counts(result),{1:2,2:1,3:0});
  assert.deepEqual(result.teachers.slice(0,2).map(row=>row.employee_id),[1,2]);
  assert.equal(result.total_weekly_periods,3);
  assert.deepEqual(input,before);
});

test('parallel lessons each count for their teacher and separate saved collision entries are not collapsed by slot',()=>{
  const result=aggregateTeacherWorkloadSummary(fixture({loads:[load(1,1),load(2,2,{parallel_with_load_id:1}),load(3,1)],
    entries:[entry(1,1),entry(2,2),entry(3,3)]}));
  assert.deepEqual(counts(result),{1:2,2:1,3:0});
  assert.equal(result.total_weekly_periods,3);
});

test('invalid academic or teacher references do not contribute saved lessons',async t=>{
  for(const patch of [
    {status:'inactive'},{class_status:'archived'},{class_school_id:2},
    {section_status:'archived'},{section_school_id:2},{section_class_id:2},{section_id:null},
    {subject_status:'archived'},{subject_school_id:2},{subject_class_id:2},{subject_section_id:2},
    {employee_id:null},{employee_status:'archived'},{employee_school_id:2},{employee_role:'staff'},
    {school_id:2},{academic_year_id:2},
  ]) await t.test(JSON.stringify(patch),()=>{
    assert.equal(aggregateTeacherWorkloadSummary(fixture({loads:[load(1,1,patch)]})).total_weekly_periods,0);
  });
});

test('a valid class without active sections contributes its saved lesson once',()=>{
  assert.equal(aggregateTeacherWorkloadSummary(fixture({loads:[load(1,1,{section_id:null,active_section_count:0})]})).total_weekly_periods,1);
});

test('disabled and nonlesson slots or days and cross-scope entries are excluded',async t=>{
  for(const [collection,patch] of [
    ['days',{is_active:0}],['days',{school_id:2}],['days',{academic_year_id:2}],
    ['slots',{is_active:0}],['slots',{slot_type:'break'}],['slots',{school_id:2}],['slots',{academic_year_id:2}],
    ['entries',{school_id:2}],['entries',{academic_year_id:2}],['entries',{slot_id:999}],['entries',{teaching_load_id:999}],
  ]) await t.test(`${collection} ${JSON.stringify(patch)}`,()=>{
    const input=fixture();input[collection]=input[collection].map(row=>({...row,...patch}));
    assert.equal(aggregateTeacherWorkloadSummary(input).total_weekly_periods,0);
  });
});

test('archived staff and foreign teachers are never returned, even if a load names their ID',()=>{
  const result=aggregateTeacherWorkloadSummary(fixture({teachers:[teacher(1,{status:'archived'}),teacher(2,{role:'staff'}),teacher(3,{school_id:2})]}));
  assert.deepEqual(result,{teachers:[],total_weekly_periods:0,total_scheduled_weekly_periods:0,total_extra_weekly_periods:0,total_report_weekly_periods:0});
});


test('report-only extras reconcile without becoming scheduled demand; named resources stay distinct from real teachers',()=>{
  const extra={id:1,school_id:1,academic_year_id:1,employee_id:1,subject_name:'التربية المسيحية',weekly_periods:5,deleted_at:null};
  const input=fixture({teachers:[teacher(1,{full_name:'مدرس الإنكليزي'})],loads:[load(1,1),load(2,null,{teacher_placeholder:'مدرس الإنكليزي'}),load(3,null,{teacher_placeholder:'مدرس الإنكليزي'})],entries:[entry(1,1),entry(2,2),entry(3,3)],extras:[extra,extra,{...extra,id:2,school_id:2},{...extra,id:3,academic_year_id:2},{...extra,id:4,deleted_at:1},{...extra,id:5,employee_id:999}]});
  const saved=structuredClone(input),r=aggregateTeacherWorkloadSummary(input),real=r.teachers.find(t=>t.employee_id===1),placeholder=r.teachers.find(t=>t.employee_id===null);
  assert.equal(real.weekly_periods,1);assert.equal(real.report_weekly_periods,6);assert.equal(real.extra_weekly_periods,5);assert.equal(real.breakdown.reduce((s,r)=>s+r.weekly_periods,0),1);
  assert.equal(placeholder.teacher_key,'placeholder:مدرس الإنكليزي');assert.equal(placeholder.weekly_periods,2);assert.equal(placeholder.extras.length,0);
  assert.equal(r.total_scheduled_weekly_periods,3);assert.equal(r.total_report_weekly_periods,8);assert.equal(r.total_extra_weekly_periods,5);assert.deepEqual(input,saved);
});
