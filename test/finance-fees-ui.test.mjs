import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {root} from './helpers/finance-fixture.mjs';
const window=new Window({url:'http://localhost'});
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','Node','Event','MouseEvent','InputEvent','localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?window:window[key]});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.alert=()=>{};globalThis.confirm=()=>true;
const {createElement,act}=await import('react'),{createRoot}=await import('react-dom/client');
const vite=await createServer({root,appType:'custom',ssr:{noExternal:['react-router-dom','react-router'],resolve:{conditions:['module','browser','development']}},server:{middlewareMode:true,hmr:false}});
const {default:FeesPage}=await vite.ssrLoadModule('/src/modules/fees/FeesPage.tsx');
const {AuthProvider}=await vite.ssrLoadModule('/src/hooks/useAuth.tsx');
after(async()=>{await vite.close();await window.happyDOM.close();});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const fees=[{id:1,student_id:1,student_name:'Generated Student',fee_type:'Zero net',amount:100000,net_fee:0,paid_amount:0,currency:'IQD',status:'paid'},
 {id:2,student_id:1,student_name:'Generated Student',fee_type:'Payable',amount:100000,net_fee:100000,paid_amount:0,currency:'IQD',status:'pending'}];
const payments=[{id:1,student_id:1,amount:100,status:'active',currency:'IQD',active_receipt_id:null,payment_date:1788600000},
 {id:2,student_id:1,amount:200,status:'cancelled',currency:'IQD',active_receipt_id:null,payment_date:1788600000},
 {id:3,student_id:1,amount:300,status:'active',currency:'IQD',active_receipt_id:5,payment_date:1788600000},
 {id:4,student_id:1,amount:400,status:'active',currency:'USD',active_receipt_id:null,payment_date:1788600000}];
async function mount(t,overrides={},component=FeesPage,userOverrides={}){
 const user={id:1,role_key:'school_owner',school_id:1,full_name:'Generated owner',...userOverrides},calls=[];
 localStorage.clear();sessionStorage.clear();localStorage.setItem('smart_school_user',JSON.stringify(user));localStorage.setItem('smart_school_token','local-ui-placeholder');
 globalThis.fetch=async(url,init={})=>{const path=String(url).split('?')[0],method=init.method??'GET',input=init.body?JSON.parse(init.body):undefined;calls.push({path,url:String(url),method,input});
  if(overrides[path])return overrides[path](input,method);
  const data={'/api/auth/me':user,'/api/students':[{id:1,full_name:'Generated Student',student_number:'FIN-1',status:'active'}],'/api/academic-years':[{id:1,name:'2026-2027'}],'/api/student-fees':fees,'/api/fee-payments':payments,'/api/fee-receipts':[]}[path];
  return response({data:data??{id:1}});
 };
 const container=document.createElement('div');document.body.append(container);const app=createRoot(container);
 await act(async()=>app.render(createElement(AuthProvider,null,createElement(component))));
 t.after(async()=>{await act(async()=>app.unmount());container.remove();});
 return {container,calls};
}
const button=(u,text)=>{const el=[...u.container.querySelectorAll('button')].find(b=>b.textContent.trim()===text);assert.ok(el,text);return el;};
const click=async el=>act(async()=>el.click());
async function input(el,value){await act(async()=>{const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
async function fillPayment(u){await click(button(u,'المدفوعات'));const form=u.container.querySelector('form[aria-label="تسجيل دفعة"]');await input(form.querySelectorAll('select')[1],'2');await input(form.querySelector('input[type="number"]'),'1000');return form;}
async function submit(form){await act(async()=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));}
test('rendered zero net stays zero; new fee has only IQD and whole-money inputs',async t=>{
 const u=await mount(t),row=[...u.container.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('Zero net'));
 assert.equal(row.querySelectorAll('td')[2].textContent,'٠ د.ع');assert.equal(row.querySelectorAll('td')[4].textContent,'٠ د.ع');
 await click(button(u,'إضافة قسط'));const options=[...u.container.querySelectorAll('option')];assert.ok(options.some(o=>o.value==='IQD'));assert.ok(!options.some(o=>['EGP','USD','SAR','AED'].includes(o.value)));
 assert.equal(u.container.querySelector('input[type="number"]').step,'1');
});
test('fee list exposes one row action and opens the authoritative account with an exact installment draft',async t=>{
 const finance={student:{id:1,full_name:'Generated Student',student_number:'FIN-1'},totals:{original_fee:100000,discount_amount:0,net_due:100000,paid_amount:0,remaining_amount:100000},fees:[{...fees[1],finance_revision:7,remaining_amount:100000,due_date:Date.UTC(2027,0,31)/1000,installment_plan:null}],payments:[],receipts:[]};
 const u=await mount(t,{'/api/student-finance/1':()=>response({data:finance}),'/api/student-fees/2/installment-plan':()=>response({data:{id:9}})}),row=[...u.container.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('Payable'));
 assert.deepEqual([...row.querySelectorAll('button')].map(element=>element.textContent.trim()),['فتح الحساب']);
 await click(row.querySelector('button'));assert.match(u.container.querySelector('[aria-label="حساب الطالب المالي"]').textContent,/إجمالي حساب الطالب/);
 await click(button(u,'إنشاء خطة'));assert.ok(u.container.querySelector('[role="dialog"]'));assert.equal(u.container.querySelectorAll('input[type="number"]').length,3);
 assert.deepEqual([...u.container.querySelectorAll('input[type="date"]')].map(element=>element.value),['2027-01-31','2027-02-28','2027-03-31']);
 await click(button(u,'حفظ الخطة'));const request=u.calls.find(call=>call.path==='/api/student-fees/2/installment-plan'&&call.method==='PUT');
 assert.equal(request.input.expected_fee_revision,7);assert.equal(request.input.items.reduce((sum,item)=>sum+item.amount,0),100000);
});
test('receipts first visit loads eligible payments without visiting payments tab, excludes cancelled/reserved/non-IQD',async t=>{
 const u=await mount(t);assert.equal(u.calls.filter(c=>c.path==='/api/fee-payments').length,0);
 await click(button(u,'الإيصالات'));assert.equal(u.calls.filter(c=>c.path==='/api/fee-payments').length,1);
 await input(u.container.querySelector('select'),'1');assert.equal(u.container.querySelectorAll('input[type="checkbox"]').length,1);
 const row=u.container.querySelector('input[type="checkbox"]').closest('tr');assert.match(row.textContent,/١٠٠/);assert.ok(!row.textContent.includes('٣٠٠'));
});
test('payment busy double-submit guard, uncertain retry retains exact UUID/payload; confirmed new draft uses new key',async t=>{
 const first=deferred(),second=deferred();let writes=0;
 const u=await mount(t,{'/api/fee-payments':(body,method)=>method==='GET'?response({data:payments}):(++writes===1?first.promise:writes===2?second.promise:response({data:{id:2}}))}),form=await fillPayment(u);
 await submit(form);await submit(form);assert.equal(writes,1);assert.equal(button(u,'تسجيل الدفع').disabled,true);assert.equal(form.querySelector('fieldset').disabled,true);
 await act(async()=>first.resolve(response({error:'uncertain transport',code:'finance_failure'},500)));
 assert.equal(button(u,'تسجيل الدفع').disabled,false);assert.equal(form.querySelector('fieldset').disabled,true);
 await submit(form);assert.equal(writes,2);const posts=u.calls.filter(c=>c.path==='/api/fee-payments'&&c.method==='POST');assert.deepEqual(posts[0].input,posts[1].input);assert.match(posts[0].input.client_request_id,/^[0-9a-f-]{36}$/);
 await act(async()=>second.resolve(response({data:{id:1}})));assert.equal(form.querySelector('fieldset').disabled,false);
 await input(form.querySelectorAll('select')[1],'2');await input(form.querySelector('input[type="number"]'),'1000');await submit(form);
 assert.notEqual(u.calls.filter(c=>c.method==='POST').at(-1).input.client_request_id,posts[0].input.client_request_id);
});
test('intentional new draft after uncertain request requires explicit confirmation',async t=>{
 const u=await mount(t,{'/api/fee-payments':(body,method)=>response(method==='GET'?{data:payments}:{error:'uncertain'},method==='GET'?200:500)}),form=await fillPayment(u);await submit(form);
 let prompts=0;window.confirm=()=>{prompts++;return false;};await click(button(u,'دفعة جديدة'));assert.equal(prompts,1);assert.equal(form.querySelector('fieldset').disabled,true);
 window.confirm=()=>true;await click(button(u,'دفعة جديدة'));assert.equal(form.querySelector('fieldset').disabled,false);assert.equal(form.querySelector('input[type="number"]').value,'');
});
test('payment cancellation requires a reason and does not call document cancellation',async t=>{
 const u=await mount(t);await click(button(u,'المدفوعات'));window.prompt=()=>'';await click(button(u,'إلغاء الدفعة'));assert.equal(u.calls.filter(c=>c.method==='PUT').length,0);
 window.prompt=()=> '  Generated correction  ';await click(button(u,'إلغاء الدفعة'));const request=u.calls.find(c=>c.method==='PUT');assert.equal(request.path,'/api/fee-payments/1/cancel');assert.equal(request.input.cancel_reason,'Generated correction');
});
test('document cancellation requires its own reason and never calls payment cancellation',async t=>{
 const u=await mount(t,{'/api/fee-receipts':()=>response({data:[{id:5,student_id:1,receipt_number:'LOCAL-5',student_name_snapshot:'Generated Student',total_amount:300,status:'active',created_at:1788600000}]})});
 await click(button(u,'الإيصالات'));window.prompt=()=>'';await click(u.container.querySelector('button[title="إلغاء"]'));assert.equal(u.calls.filter(c=>c.method==='PUT').length,0);
 window.prompt=()=>'  Document only  ';await click(u.container.querySelector('button[title="إلغاء"]'));const request=u.calls.find(c=>c.method==='PUT');assert.equal(request.path,'/api/fee-receipts/5/cancel');assert.equal(request.input.cancel_reason,'Document only');
});
test('receipt print route ignores stale same-school document responses',async t=>{
 const {MemoryRouter,Routes,Route,useNavigate}=await vite.ssrLoadModule('react-router-dom');
 const {default:PrintReceiptPage}=await vite.ssrLoadModule('/src/modules/print/PrintReceiptPage.tsx');
 function Navigate(){const navigate=useNavigate();return createElement('button',{onClick:()=>navigate('/receipt/2')},'Next document');}
 function Page(){return createElement(MemoryRouter,{initialEntries:['/receipt/1']},createElement(Navigate),createElement(Routes,null,createElement(Route,{path:'/receipt/:id',element:createElement(PrintReceiptPage)})));}
 const old=deferred(),latest=deferred(),u=await mount(t,{'/api/fee-receipts/1':()=>old.promise,'/api/fee-receipts/2':()=>latest.promise},Page);
 await click(button(u,'Next document'));
 const doc=(id)=>({data:{id,school_id:1,receipt_number:'DOC-'+id,student_name_snapshot:'Generated Student',school_name_snapshot:'Generated School',total_amount:100,status:'active',created_at:1788600000,payments_snapshot:[],settings_snapshot:{currency:'IQD'}}});
 await act(async()=>latest.resolve(response(doc(2))));assert.match(u.container.textContent,/DOC-2/);
 assert.ok(!u.container.textContent.includes('١٩٧٠'));assert.match(u.container.textContent,/هذه الدفعة١٠٠ د.ع/);
 await act(async()=>old.resolve(response(doc(1))));assert.match(u.container.textContent,/DOC-2/);assert.ok(!u.container.textContent.includes('DOC-1'));
});
test('parent finance view is read-only and uses only parent-scoped endpoints',async t=>{
 const {MemoryRouter}=await vite.ssrLoadModule('react-router-dom'),{default:ParentFinanceSection}=await vite.ssrLoadModule('/src/modules/students/ParentFinanceSection.tsx');
 const finance={student:{id:1,full_name:'Generated Student'},linked_students:[{id:1,full_name:'Generated Student'}],totals:{original_fee:100000,discount_amount:0,net_due:100000,paid_amount:25000,remaining_amount:75000,payment_ratio_basis_points:2500},fees:[{id:2,fee_type:'رسوم دراسية',net_fee:100000,remaining_amount:75000,due_date:1788600000,installment_plan:{items:[{id:1,label:'الدفعة 1',percentage_basis_points:5000,amount:50000,due_date:'2026-09-01',paid_amount:25000,remaining_amount:25000,status:'partial'}]}}],payments:[{id:3,fee_type:'رسوم دراسية',payment_method:'cash',payment_date:1788600000,amount:25000,status:'active'}],receipts:[{id:5,receipt_number:'FIN-5',created_at:1788600000,total_amount:25000,status:'active',verification_token:'verify-5'}]};
 function Page(){return createElement(MemoryRouter,null,createElement(ParentFinanceSection,{studentId:1}));}
 const u=await mount(t,{'/api/parent/students/1/finance':()=>response({data:finance})},Page,{role_key:'parent',full_name:'Generated parent'});
 assert.match(u.container.textContent,/الأقساط/);assert.match(u.container.textContent,/المتبقي٧٥٬٠٠٠ د.ع/);assert.match(u.container.textContent,/FIN-5/);
 assert.ok(!/(تحصيل دفعة|تعديل القسط|حذف القسط)/.test(u.container.textContent));
 assert.ok(u.container.querySelector('a[href="/print/receipt/5"]'));assert.equal(u.calls.filter(call=>call.path==='/api/student-finance/1').length,0);
});
test('parent receipt print fetches the parent-safe document and never marks it printed',async t=>{
 const {MemoryRouter,Routes,Route}=await vite.ssrLoadModule('react-router-dom'),{default:PrintReceiptPage}=await vite.ssrLoadModule('/src/modules/print/PrintReceiptPage.tsx');
 function Page(){return createElement(MemoryRouter,{initialEntries:['/print/receipt/5']},createElement(Routes,null,createElement(Route,{path:'/print/receipt/:id',element:createElement(PrintReceiptPage)})));}
 const receipt={id:5,school_id:1,student_id:1,receipt_number:'FIN-5',student_name_snapshot:'Generated Student',school_name_snapshot:'Generated School',total_amount:25000,currency_snapshot:'IQD',status:'active',verification_token:'verify-5',created_at:1788600000,payments_snapshot:[],financial_summary_snapshot:{currency:'IQD',original_fee:100000,discount_amount:0,net_due:100000,paid_before:0,this_payment:25000,total_paid:25000,remaining_after:75000,payment_ratio_basis_points:2500},settings_snapshot:{currency:'IQD'}};
 const u=await mount(t,{'/api/parent/fee-receipts/5':()=>response({data:receipt})},Page,{role_key:'parent',full_name:'Generated parent'});
 assert.match(u.container.textContent,/إيصال استلام قسط دراسي/);assert.match(u.container.textContent,/FIN-5/);
 assert.equal(u.calls.filter(call=>call.path==='/api/parent/fee-receipts/5').length,1);assert.equal(u.calls.filter(call=>call.path.includes('/print')).length,0);assert.equal(u.calls.filter(call=>call.path==='/api/fee-receipts/5').length,0);
});
