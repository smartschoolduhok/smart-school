import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSectionAdvisorPlacements, parseSectionAdvisorSaveRequest } from '../src/lib/sectionAdvisors.ts';
import { fixture as makeFixture, migrationFiles, migrationSQL, root, snapshot } from './helpers/teaching-load-matrix-fixture.mjs';

const request = patch => ({ school_id:1,academic_year_id:1,class_id:1,section_id:1,employee_id:1,attendance_confirmed:false,notes:'',expected_version:0,...patch });
const teacher = (id, patch={}) => ({id,school_id:1,full_name:`Teacher ${id}`,role:'teacher',status:'active',...patch});
const load = (id, employee_id, patch={}) => ({id,school_id:1,academic_year_id:1,class_id:1,section_id:1,subject_id:id,subject_name:`Subject ${id}`,employee_id,weekly_periods:9,status:'active',class_status:'active',class_school_id:1,active_section_count:1,section_status:'active',section_school_id:1,section_class_id:1,subject_status:'active',subject_school_id:1,subject_class_id:1,subject_section_id:null,employee_status:'active',employee_school_id:1,employee_role:'teacher',parallel_with_load_id:null,...patch});
const entry = (id, teaching_load_id, patch={}) => ({id,school_id:1,academic_year_id:1,slot_id:1,teaching_load_id,...patch});
const fixture = patch => ({schoolId:1,academicYearId:1,teachers:[teacher(1),teacher(2),teacher(3)],assignments:[],classes:[{id:1,school_id:1,name:'Class',stage:'primary',order_index:1,status:'active'}],sections:[{id:1,school_id:1,class_id:1,name:'A',status:'active'}],days:[{id:1,school_id:1,academic_year_id:1,day_of_week:0,is_active:1,order_index:0}],slots:[{id:1,school_id:1,academic_year_id:1,day_of_week:0,is_active:1,slot_type:'lesson'}],loads:[load(1,1),load(2,2)],entries:[entry(1,1)],...patch});
const saved = patch => ({school_id:1,academic_year_id:1,class_id:1,section_id:1,employee_id:1,employee_name:'Teacher 1',attendance_confirmed:0,notes:'',version:3,...patch});

test('request parser rejects invalid IDs, untyped confirmation, excessive notes and unknown fields',()=>{
  assert.deepEqual(parseSectionAdvisorSaveRequest(request({notes:' note '})),request({notes:'note'}));
  for(const patch of [{school_id:'1'},{school_id:0},{academic_year_id:1.5},{class_id:-1},{section_id:undefined},{employee_id:'1'},{attendance_confirmed:'true'},{notes:'x'.repeat(1001)},{expected_version:-1},{expected_version:1.5},{other:1}])assert.equal(parseSectionAdvisorSaveRequest(request(patch)),null,JSON.stringify(patch));
  assert.equal(parseSectionAdvisorSaveRequest(null),null);assert.equal(parseSectionAdvisorSaveRequest([]),null);
  assert.deepEqual(parseSectionAdvisorSaveRequest(request({employee_id:null,attendance_confirmed:true,notes:'old'})),request({employee_id:null,attendance_confirmed:false,notes:''}));
});

test('candidates use distinct saved lessons, preserve teacher identities, aggregate subjects and full-school days',()=>{
  const input=fixture({teachers:[teacher(1,{full_name:'Same'}),teacher(2,{full_name:'Same'})],
    sections:[{id:1,school_id:1,class_id:1,name:'A',status:'active'},{id:2,school_id:1,class_id:1,name:'B',status:'active'}],
    days:[{school_id:1,academic_year_id:1,day_of_week:3,is_active:1,order_index:0},{school_id:1,academic_year_id:1,day_of_week:0,is_active:1,order_index:1}],
    slots:[{id:1,school_id:1,academic_year_id:1,day_of_week:0,is_active:1,slot_type:'lesson'},{id:2,school_id:1,academic_year_id:1,day_of_week:3,is_active:1,slot_type:'lesson'}],
    loads:[load(1,1),load(2,2,{parallel_with_load_id:1}),load(3,1,{section_id:2})],entries:[entry(1,1),entry(1,1),entry(2,2),entry(3,3,{slot_id:2})]});
  const before=structuredClone(input),result=buildSectionAdvisorPlacements(input),candidates=result.placements[0].candidates;
  assert.deepEqual(result.school_days,[3,0]);assert.deepEqual(candidates.map(c=>[c.employee_id,c.section_weekly_periods,c.total_weekly_periods,c.scheduled_days]),[[1,1,2,[3,0]],[2,1,1,[0]]]);
  assert.deepEqual(candidates[0].subjects,['Subject 1']);assert.deepEqual(input,before);
});

test('active class without active sections is a null-section placement and still requires saved lessons',()=>{
  const result=buildSectionAdvisorPlacements(fixture({sections:[],loads:[load(1,1,{section_id:null,active_section_count:0})]}));
  assert.equal(result.placements[0].section_id,null);assert.equal(result.placements[0].candidates[0].employee_id,1);
  assert.equal(buildSectionAdvisorPlacements(fixture({entries:[]})).placements[0].candidates.length,0);
});

test('read keeps stale and cleared assignments with versions, never infers attendance from a complete schedule',()=>{
  for(const row of [saved(),saved({employee_id:null,employee_name:null,version:4})]){
    const result=buildSectionAdvisorPlacements(fixture({teachers:[],assignments:[row,saved({school_id:2,version:99})]}));
    assert.deepEqual(result.placements[0].assignment,{employee_id:row.employee_id,employee_name:row.employee_name,attendance_confirmed:false,notes:'',version:row.version});assert.deepEqual(result.placements[0].candidates,[]);
  }
});

test('candidate filtering excludes invalid academic references, inactive teachers and hidden saved slots',async t=>{
  for(const patch of [{status:'inactive'},{class_status:'archived'},{class_school_id:2},{section_status:'archived'},{section_school_id:2},{section_class_id:2},{subject_status:'archived'},{subject_class_id:2},{subject_section_id:2},{employee_status:'archived'},{employee_role:'staff'},{employee_school_id:2},{employee_id:null},{school_id:2},{academic_year_id:2}])await t.test(JSON.stringify(patch),()=>assert.deepEqual(buildSectionAdvisorPlacements(fixture({loads:[load(1,1,patch)]})).placements[0].candidates,[]));
  for(const [collection,patch] of [['days',{is_active:0}],['slots',{is_active:0}],['slots',{slot_type:'break'}],['entries',{academic_year_id:2}],['entries',{school_id:2}]])await t.test(collection+JSON.stringify(patch),()=>{
    const input=fixture();input[collection]=input[collection].map(row=>({...row,...patch}));assert.deepEqual(buildSectionAdvisorPlacements(input).placements[0].candidates,[]);
  });
});

const insert = (db,patch={}) => {const row={school_id:1,academic_year_id:1,class_id:1,section_id:1,employee_id:2,attendance_confirmed:0,notes:'',version:1,created_by_user_id:1,updated_by_user_id:1,...patch};return db.prepare(`INSERT INTO section_advisors(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));};
test('migration constrains tenant identities, null-section uniqueness, versions and cleared assignments',t=>{
  const f=makeFixture();t.after(()=>f.db.close());
  for(const patch of [{academic_year_id:3},{class_id:3},{section_id:3},{section_id:2,class_id:2},{employee_id:5},{created_by_user_id:3,school_id:2,academic_year_id:3,class_id:3,section_id:3,employee_id:5},{attendance_confirmed:2},{notes:'x'.repeat(1001)},{employee_id:null,attendance_confirmed:1}])assert.throws(()=>insert(f.db,patch),undefined,JSON.stringify(patch));
  insert(f.db);assert.throws(()=>insert(f.db));assert.throws(()=>f.db.exec('UPDATE section_advisors SET version=1'));assert.throws(()=>f.db.exec('UPDATE section_advisors SET school_id=2,version=2'));
  f.db.exec("UPDATE section_advisors SET employee_id=NULL,attendance_confirmed=0,notes='',version=2");
  assert.throws(()=>f.db.exec('UPDATE sections SET class_id=2 WHERE id=1'),/section_advisor_referenced_placement/);
  insert(f.db,{class_id:2,section_id:null});assert.throws(()=>insert(f.db,{class_id:2,section_id:null}));
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('additive migration preserves all previous data and accepts historical inactive assignments without current saved lessons',()=>{
  const db=new DatabaseSync(':memory:');try{
    for(const file of migrationFiles.filter(file=>file<'0053'))db.exec(migrationSQL(file));
    const before=snapshot(db);db.exec(readFileSync(join(root,'migrations/0053_section_advisors.sql'),'utf8'));
    const after=snapshot(db);for(const [name,rows]of Object.entries(before))assert.deepEqual(after[name],rows,name);assert.deepEqual(after.section_advisors,[]);
  }finally{db.close();}
  const f=makeFixture();try{f.db.exec("UPDATE employees SET status='archived' WHERE id=2");insert(f.db,{attendance_confirmed:1,notes:'historical'});assert.equal(f.db.prepare('SELECT count(*) n FROM section_advisors').get().n,1);}finally{f.db.close();}
});
