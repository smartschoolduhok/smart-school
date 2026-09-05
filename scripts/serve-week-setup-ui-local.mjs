// Optional visual QA fixture. Loopback only; no auth, network API or D1 writes.
// Real component + generated in-memory repository-schema fixture. Not an app entry point.
import {createServer} from 'vite';
import {fixture,root} from '../test/helpers/teaching-load-matrix-fixture.mjs';
import {loadWeekSetup} from '../src/lib/weekSetupDb.ts';
import {publicWeekSnapshot} from '../src/lib/weekSetup.ts';
const f=fixture(),context=await loadWeekSetup(f.d1,1,1),snapshot=publicWeekSnapshot(context);f.db.close();
const id='\0week-qa.tsx';
const server=await createServer({root,server:{host:'127.0.0.1',port:5193,strictPort:true},plugins:[{
 name:'local-week-qa',resolveId:source=>source==='virtual:week-qa'?id:null,
 load:source=>source===id?`
 import React from 'react'; import {createRoot} from 'react-dom/client';
 import {WeekSetupTab} from '/src/modules/timetable/WeekSetupTab.tsx';
 import {planWeekSetup} from '/src/lib/weekSetup.ts'; import '/src/index.css';
 const context=${JSON.stringify(context)}, snapshot=${JSON.stringify(snapshot)};
 const api={load:async()=>({data:snapshot}),preview:async input=>({data:await planWeekSetup(context,input)}),apply:async()=>({error:'Visual fixture only: no database writes.'})};
 createRoot(document.getElementById('root')).render(React.createElement('main',{className:'min-w-0 p-3'},React.createElement('p',{className:'mb-4 bg-amber-50 p-2 text-center'},'LOCAL VISUAL FIXTURE — لا يوجد حفظ لقاعدة بيانات'),React.createElement(WeekSetupTab,{schoolId:1,academicYearId:1,dataVersion:0,onDirtyChange:()=>{},onChanged:()=>{},onEditSlot:()=>alert('Individual editor callback'),onDeleteSlot:()=>{},onDayChange:()=>{},api})));
 `:null,
 configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  if(req.url==='/__week-qa'){
   res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await vite.transformIndexHtml('/__week-qa','<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local Week Setup QA</title></head><body><div id="root"></div><script type="module">import "virtual:week-qa";</script></body></html>'));return;
  }
  if(req.url==='/__week-qa-narrow'){
   res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><title>375px Local Week Setup QA</title></head><body style="margin:0;background:#e5e7eb"><iframe title="375px responsive QA" src="/__week-qa" style="display:block;width:375px;height:812px;border:0;margin:12px auto;background:white"></iframe></body></html>');return;
  }
  next();
 });},
}]});
await server.listen();console.log('Local generated fixture: http://127.0.0.1:5193/__week-qa');console.log('Narrow iframe (375 × 812): http://127.0.0.1:5193/__week-qa-narrow');
