import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {root} from './helpers/finance-fixture.mjs';
const window=new Window({url:'http://localhost',width:390,height:844});
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','HTMLFormElement','Node','Event','MouseEvent','InputEvent','localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?window:window[key]});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createElement,act}=await import('react');
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root,appType:'custom',ssr:{noExternal:['react-router-dom','react-router'],resolve:{conditions:['module','browser','development']}},server:{middlewareMode:true,hmr:false}});
const {AuthProvider}=await vite.ssrLoadModule('/src/hooks/useAuth.tsx');
const {MemoryRouter}=await vite.ssrLoadModule('react-router-dom');
const pages={};
for(const [name,path] of Object.entries({communication:'communication/CommunicationPage',progress:'gradeProgress/GradeProgressPage',regulations:'admissions/RegulationsPage',admissions:'admissions/AdmissionsPage'}))pages[name]=(await vite.ssrLoadModule(`/src/modules/${path}.tsx`)).default;
after(async()=>{await vite.close();await window.happyDOM.close();});
const response=(data,status=200)=>new Response(JSON.stringify({data}),{status,headers:{'Content-Type':'application/json'}});
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const snapshot={student_name:'طالب تجريبي',student_number:'TEST-1',year_name:'2026',class_name:'الأول',section_name:'أ',period:'first_month',period_label:'الشهر الأول',max_grade:100,subjects:[{subject_name:'الرياضيات',score:null}],missing_count:1};
const report={report_key:'00000000-0000-4000-8000-000000000001',revision:1,status:'published',created_at:1789000000,snapshot};
const rules={age_reference_date:'2026-09-01',age_rule:'review',min_age_months:null,max_age_months:null,repeat_rule:'review',max_previous_repeats:null,acceleration:'review',required_documents:[]};
const regulation=(key,title)=>({regulation_key:key,title,academic_year_id:1,class_id:1,process:'admission',version:1,status:'draft',revision:1,jurisdiction:'جهة تجريبية',source_reference:'مرجع تجريبي',source_url:'https://example.invalid/source',effective_from:'2026-01-01',effective_to:'2026-12-31',rules});
const application={application_key:'00000000-0000-4000-8000-000000000002',student_name:'متقدم تجريبي',student_id:1,applicant:null,academic_year_id:1,class_id:1,section_id:1,process:'admission',external_school:null,document_reference:null,facts:{previous_repeats:0,accelerated:false,documents:[]},status:'submitted',revision:1};
async function mount(t,page,role='school_owner',handlers={}){
 localStorage.clear();sessionStorage.clear();const user={id:1,role_key:role,school_id:1,full_name:'مستخدم تجريبي'};
 localStorage.setItem('smart_school_user',JSON.stringify(user));localStorage.setItem('smart_school_token','generated-token');
 const calls=[];globalThis.fetch=async(url,init={})=>{const path=String(url).split('?')[0],method=init.method||'GET',body=init.body?JSON.parse(init.body):null;calls.push({path,method,body});if(handlers[path])return handlers[path](body,method);
 if(path==='/api/auth/me')return response(user);
 if(path==='/api/academic-years')return response([{id:1,name:'2026',is_active:1}]);
 if(path==='/api/classes')return response([{id:1,name:'الأول',status:'active'}]);
 if(path==='/api/sections')return response([{id:1,name:'أ',class_id:1,status:'active'}]);
 if(path==='/api/students')return response([{id:1,full_name:'طالب تجريبي'}]);
 if(path==='/api/grade-progress')return response({reports:[report],next_cursor:null});
 if(path==='/api/regulations')return response([]);
 if(path==='/api/admissions')return response({applications:[],next_cursor:null});
 if(path==='/api/communication')return response({conversations:[],next_cursor:null});
 if(path==='/api/communication/contacts')return response({contacts:[],has_more:false});
 throw new Error(`Unexpected ${method} ${path}`);};
 const container=document.createElement('div');document.body.append(container);const reactRoot=createRoot(container);
 await act(async()=>reactRoot.render(createElement(AuthProvider,null,createElement(MemoryRouter,null,createElement(pages[page])))));
 t.after(async()=>{await act(async()=>reactRoot.unmount());container.remove();});
 assert.equal(container.querySelector('[dir="rtl"]')?.getAttribute('dir'),'rtl');return {container,calls};
}
const buttons=v=>[...v.container.querySelectorAll('button')];
const button=(v,label)=>{const b=buttons(v).find(b=>b.textContent.trim()===label);assert.ok(b,`Missing button ${label}`);return b;};
const click=el=>act(async()=>el.click());
const input=async(el,value)=>{assert.ok(el);await act(async()=>{const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});};

test('linked-parent progress shows missing scores and print, without publishing or raw grade calls',async t=>{
 const v=await mount(t,'progress','parent');await click(buttons(v).find(b=>b.textContent.includes('طالب تجريبي')));
 assert.match(v.container.textContent,/لم تُدخل/);assert.match(v.container.textContent,/درجات غير مدخلة: 1/);assert.ok(button(v,'طباعة A4'));
 assert.equal(v.container.querySelector('select'),null);assert.equal(v.container.querySelector('input'),null);
 assert.equal(v.calls.some(c=>c.path==='/api/grades'||c.path==='/api/students'),false);
});
test('progress publishing needs delivery confirmation and sends the exact preview digest',async t=>{
 const v=await mount(t,'progress','teacher',{'/api/grade-progress/preview':()=>response({snapshot,preview_digest:'a'.repeat(64)}),'/api/grade-progress/publish':()=>response(report,201)});
 await input(v.container.querySelector('select'),'1');await click(button(v,'معاينة الدرجات'));
 assert.equal(button(v,'نشر لولي الأمر المرتبط').disabled,true);await click(v.container.querySelector('input[type="checkbox"]'));await click(button(v,'نشر لولي الأمر المرتبط'));
 const post=v.calls.find(c=>c.path.endsWith('/publish'));assert.equal(post.body.confirm_delivered,true);assert.equal(post.body.preview_digest,'a'.repeat(64));assert.match(post.body.report_key,/^[a-f0-9-]{36}$/);
});
test('regulation selection discards an obsolete audit response and approval requires source verification',async t=>{
 const first=defer(),second=defer();const v=await mount(t,'regulations','school_owner',{'/api/regulations':()=>response([regulation('one','الأولى'),regulation('two','الثانية')]),'/api/regulations/one/audit':()=>first.promise,'/api/regulations/two/audit':()=>second.promise});
 await click(buttons(v).find(b=>b.textContent.includes('الأولى')));await click(buttons(v).find(b=>b.textContent.includes('الثانية')));
 await act(async()=>second.resolve(response([{action:'draft',reason:'CURRENT-AUDIT',created_at:1789000000}])));await act(async()=>first.resolve(response([{action:'draft',reason:'OBSOLETE-AUDIT',created_at:1789000000}])));
 assert.match(v.container.textContent,/CURRENT-AUDIT/);assert.doesNotMatch(v.container.textContent,/OBSOLETE-AUDIT/);assert.equal(button(v,'اعتماد هذا الإصدار').disabled,true);
});
test('admissions keep approval disabled for a missing rule even after evidence is confirmed',async t=>{
 const v=await mount(t,'admissions','school_owner',{'/api/admissions':()=>response({applications:[application],next_cursor:null}),[`/api/admissions/${application.application_key}/preview`]:()=>response({can_approve:false,preview_digest:'b'.repeat(64),eligibility:{decision:'review',issues:['لا توجد لائحة معتمدة']},operational_issues:[],regulation:null}),[`/api/admissions/${application.application_key}/audit`]:()=>response([])});
 await click(buttons(v).find(b=>b.textContent.includes('متقدم تجريبي')));assert.match(v.container.textContent,/لا توجد لائحة معتمدة/);
 await click(v.container.querySelector('input[type="checkbox"]'));const note=[...v.container.querySelectorAll('label')].find(l=>l.textContent.startsWith('سبب الإجراء')).querySelector('input');await input(note,'تمت المراجعة');assert.equal(button(v,'اعتماد الطلب').disabled,true);assert.equal(v.calls.filter(c=>c.method==='POST').length,0);
});
test('registrar can execute an approved admission only after explicit confirmation',async t=>{
 const a={...application,status:'approved',revision:2};const v=await mount(t,'admissions','registrar',{'/api/admissions':()=>response({applications:[a],next_cursor:null}),[`/api/admissions/${a.application_key}/preview`]:()=>response({can_approve:true,preview_digest:'c'.repeat(64),eligibility:{decision:'eligible',issues:[]},operational_issues:[],regulation:null}),[`/api/admissions/${a.application_key}/audit`]:()=>response([])});
 await click(buttons(v).find(b=>b.textContent.includes('متقدم تجريبي')));assert.equal(button(v,'تنفيذ الطلب المعتمد').disabled,true);assert.equal(buttons(v).some(b=>b.textContent==='اعتماد الطلب'),false);await click(v.container.querySelector('input[type="checkbox"]'));assert.equal(button(v,'تنفيذ الطلب المعتمد').disabled,false);
});
test('closed conversations render message text safely and offer parents no reply or management action',async t=>{
 const conversation={conversation_key:'closed',title:'متابعة مغلقة',student_name:'طالب',parent_name:'ولي الأمر',staff_name:'مدرس',status:'closed',revision:2,updated_at:1789000000,unread_count:1};const v=await mount(t,'communication','parent',{'/api/communication':()=>response({conversations:[conversation],next_cursor:null}),'/api/communication/closed':()=>response({conversation,can_manage:false,audit:[],messages:[{id:1,message_key:'message',sender_name:'مدرس',body:'<script>private text</script>',created_at:1789000000,mine:false}],has_more:false}),'/api/communication/closed/read':()=>response({read:true})});
 await click(buttons(v).find(b=>b.textContent.includes('متابعة مغلقة')));assert.match(v.container.textContent,/<script>private text<\/script>/);assert.equal(v.container.querySelector('script'),null);assert.equal(v.container.querySelector('textarea'),null);assert.doesNotMatch(v.container.textContent,/إدارة المحادثة وسجل الإجراءات/);
});
