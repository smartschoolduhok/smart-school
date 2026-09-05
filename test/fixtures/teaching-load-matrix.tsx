// Interactive, in-memory UI fixture. No backend, authentication or remote D1.
// Run Vite locally and open /test/fixtures/teaching-load-matrix.html.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TeachingLoadMatrixTab } from '../../src/modules/timetable/TeachingLoadMatrixTab';
import { planTeachingLoadMatrix, planTeachingLoadCopy, summarizeMatrix, MATRIX_LEAVE_MESSAGE } from '../../src/lib/teachingLoadMatrix';
import type { MatrixContext, MatrixChange } from '../../src/lib/teachingLoadMatrix';
import type { TimetableTeachingLoad } from '../../src/lib/timetable';
import '../../src/index.css';
const classes=[{id:1,school_id:1,name:'الثالث المتوسط',status:'active',order_index:1},{id:2,school_id:1,name:'الصف بلا شعب',status:'active',order_index:2}];
const sections=[{id:1,school_id:1,class_id:1,name:'أ',status:'active'},{id:2,school_id:1,class_id:1,name:'ب',status:'active'}];
const subjects=[{id:1,school_id:1,class_id:1,section_id:null,name:'الرياضيات',status:'active',order_index:1},{id:2,school_id:1,class_id:1,section_id:1,name:'الفيزياء',status:'active',order_index:2},{id:3,school_id:1,class_id:2,section_id:null,name:'العربية',status:'active',order_index:1}];
const teachers=[{id:1,school_id:1,full_name:'أحمد علي',status:'active',role:'teacher'},{id:2,school_id:1,full_name:'سارة حسن',status:'active',role:'teacher'}];
let loads:TimetableTeachingLoad[]=[{id:1,school_id:1,academic_year_id:1,class_id:1,section_id:1,subject_id:1,employee_id:1,employee_name:'أحمد علي',weekly_periods:4,status:'active'},{id:2,school_id:1,academic_year_id:1,class_id:1,section_id:2,subject_id:1,employee_id:null,weekly_periods:5,status:'active'}];
let revision=0, nextId=10;
const years=[{id:1,school_id:1,name:'2026-2027',starts_at:'2026-09-01',ends_at:'2027-06-01',is_active:1},{id:2,school_id:1,name:'2025-2026',starts_at:'2025-09-01',ends_at:'2026-06-01',is_active:0}];
const context=(classId:number,year:number):MatrixContext=>({class:classes.find(c=>c.id===classId)!,academic_year_id:year,sections:sections.filter(s=>s.class_id===classId),subjects:subjects.filter(s=>s.class_id===classId),teachers,loads:loads.filter(l=>l.academic_year_id===year),timetable_revision:revision,days:[],slots:[],entries:[],availability:[],constraints:[]});
window.fetch=async(input,init)=>{
 const url=new URL(String(input),location.origin);
 // Deliberately refuse every URL outside the four mocked matrix endpoints.
 if(url.origin!==location.origin||!url.pathname.startsWith('/api/timetable/teaching-load-matrix'))throw new Error('Fixture forbids network');
 const body=init?.body?JSON.parse(String(init.body)):null;
 const c=context(body?.class_id??Number(url.searchParams.get('class_id')),body?.academic_year_id??body?.target_academic_year_id??Number(url.searchParams.get('academic_year_id')));
 let result:unknown;
 if(!body)result={...c,summary:summarizeMatrix(c.class.id,c.sections,c.subjects,c.loads)};
 else if(url.pathname.endsWith('copy-preview'))result=planTeachingLoadCopy(c,[{...loads[0],weekly_periods:3}],'periods_only');
 else{
  result=planTeachingLoadMatrix(c,body.changes);
  if(url.pathname.endsWith('/apply')){
   for(const change of body.changes as MatrixChange[]){
    let load=loads.find(l=>l.class_id===c.class.id&&l.academic_year_id===c.academic_year_id&&l.subject_id===change.subject_id&&l.section_id===change.section_id&&l.status==='active');
    if(change.action==='deactivate'){if(load)load.status='inactive';continue;}
    if(!load){load={id:nextId++,school_id:1,academic_year_id:c.academic_year_id,class_id:c.class.id,subject_id:change.subject_id,section_id:change.section_id,employee_id:null,weekly_periods:1,status:'active'};loads.push(load);}
    Object.assign(load,{weekly_periods:change.weekly_periods,employee_id:change.employee_id,employee_name:teachers.find(t=>t.id===change.employee_id)?.full_name??null});
   }
   result={...result as object,revision:++revision,applied:true};
  }
 }
 return new Response(JSON.stringify({data:result}),{headers:{'Content-Type':'application/json'}});
};
function Harness(){
 const [version,setVersion]=useState(0),[year,setYear]=useState(1),[dirty,setDirty]=useState(false);
 return <main className="mx-auto max-w-7xl space-y-5 p-6"><p className="bg-amber-50 p-3 font-bold">اختبار محلي فقط — بيانات في الذاكرة، لا اتصال بالخادم</p>
  <select aria-label="سنة الاختبار" value={year} onChange={e=>{if(!dirty||confirm(MATRIX_LEAVE_MESSAGE))setYear(Number(e.target.value));}}>{years.map(y=><option key={y.id} value={y.id}>{y.name}</option>)}</select>
  <TeachingLoadMatrixTab key={year} schoolId={1} academicYearId={year} years={years} classes={classes} sections={sections} subjects={subjects} loads={loads.filter(l=>l.academic_year_id===year)}
   dataVersion={version} onDirtyChange={setDirty} onChanged={async()=>setVersion(v=>v+1)} onAdvanced={()=>alert('التعديل المتقدم متاح من TimetablePage')} />
 </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
