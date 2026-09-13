// Browser QA on the exact staging preview with the disposable authenticated user.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [previewArgument,directoryArgument]=process.argv.slice(2);
const preview=new URL(previewArgument),directory=resolve(directoryArgument);
assert.match(preview.hostname,/^[a-f0-9]{8}\.smart-school-staging\.pages\.dev$/u);
const ctx=JSON.parse(readFileSync(join(directory,'qa-private-context.json'),'utf8'));
assert.ok(ctx.ownerToken);
const {chromium}=await import(pathToFileURL(process.env.PH20D2_PLAYWRIGHT_MODULE).href);
const me=await fetch(new URL('/api/auth/me',preview),{headers:{Authorization:`Bearer ${ctx.ownerToken}`},redirect:'error'});
assert.equal(me.status,200);const user=(await me.json()).data;
const browser=await chromium.launch({headless:true,executablePath:process.env.PH20D2_CHROME});
const context=await browser.newContext({viewport:{width:390,height:844},locale:'ar-IQ',deviceScaleFactor:1});
await context.addInitScript(({token,user,origin})=>{if(location.origin===origin){sessionStorage.setItem('smart_school_token',token);sessionStorage.setItem('smart_school_user',JSON.stringify(user));}},{token:ctx.ownerToken,user,origin:preview.origin});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const report={preview:preview.href,marker:ctx.marker,viewport:{width:390,height:844},checks:[],screenshots:[]};
function check(name,data={}){report.checks.push({name,pass:true,...data});}
async function shot(name){const path=join(directory,name+'.png');await page.screenshot({path,fullPage:true});report.screenshots.push(path);}
async function selectByLabel(label,value){const el=page.locator('label').filter({hasText:label}).first().locator('..').locator('select');await el.selectOption(String(value));}
try{
  await page.goto(new URL(`/student-promotion?student_id=${ctx.rows.ui_ready.studentId}`,preview).href);
  await page.getByText('القرار المستخرج من النتيجة الرسمية',{exact:false}).waitFor();
  await page.getByText(ctx.marker+'-ui_ready',{exact:true}).first().waitFor();
  await page.getByText('الدور الأول',{exact:true}).waitFor({state:'visible'});
  assert.ok(await page.getByText('الدور الأول',{exact:true}).isVisible());
  assert.ok(await page.getByText('ناجح',{exact:true}).isVisible());
  check('individual UI displays official card, round and result');
  const arbitrary=await page.locator('button').filter({hasText:/^(مترفع|معيد|متخرج)$/u}).count();assert.equal(arbitrary,0);check('no arbitrary individual outcome choices');
  await selectByLabel('السنة الدراسية المستهدفة',ctx.targetYearId);
  await selectByLabel('الصف المستهدف',ctx.targetClassId);
  await page.waitForFunction(id=>Array.from(document.querySelectorAll('select')).some(s=>Array.from(s.options).some(o=>o.value===String(id))),ctx.targetSectionId);
  await selectByLabel('الشعبة المستهدفة',ctx.targetSectionId);
  const previewButton=page.getByRole('button',{name:'معاينة الترفيع',exact:true});
  await previewButton.focus();await page.keyboard.press('Enter');
  await page.getByText('المعاينة صالحة للتنفيذ',{exact:true}).waitFor();
  check('keyboard preview succeeds');await shot('ui-individual-phone');
  const executeButton=page.getByRole('button',{name:'تنفيذ الترفيع',exact:true});await executeButton.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  await page.keyboard.press('Tab');
  const focus=await page.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement?.textContent,insideDialog:!!document.activeElement?.closest('[role=dialog]')}));
  assert.equal(focus.insideDialog,true);check('keyboard reaches confirmation controls',focus);await shot('ui-confirmation-phone');
  await dialog.getByRole('button',{name:'إلغاء',exact:true}).focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'hidden'});
  check('confirmation cancellation leaves execution pending');
  await page.getByRole('tab',{name:'ترفيع جماعي',exact:true}).click();
  await selectByLabel('الصف المصدر',ctx.sourceClassId);
  await page.getByText('النتيجة الرسمية',{exact:true}).waitFor();
  await page.locator('tbody tr').filter({hasText:ctx.marker+' ui_ready'}).getByText('الدور الأول',{exact:false}).waitFor();
  const actions=await page.locator('tbody tr').evaluateAll(rows=>rows.map(row=>Array.from(row.querySelector('select')?.options||[]).map(o=>o.value)));
  for(const options of actions){assert.ok(options.length<=2);assert.ok(options.includes('skipped'));}
  check('bulk shows official result/card/round and only derived action or skip',{row_action_options:actions});
  await selectByLabel('السنة المستهدفة',ctx.targetYearId);
  await selectByLabel('الصف الافتراضي للمترفعين',ctx.targetClassId);
  await selectByLabel('الشعبة الافتراضية',ctx.targetSectionId);
  await page.getByRole('button',{name:'معاينة إلزامية',exact:true}).focus();await page.keyboard.press('Enter');
  await page.getByText('المعاينة الحالية صالحة؛ أي تعديل سيلغيها.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'تنفيذ الدفعة',exact:true}).focus();await page.keyboard.press('Enter');
  await dialog.waitFor();await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('[role=dialog]')),true);
  await shot('ui-bulk-confirmation-phone');
  await dialog.getByRole('button',{name:'إلغاء',exact:true}).focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'hidden'});
  check('bulk keyboard preview and confirmation cancellation');
  await page.locator('tbody tr').filter({hasText:ctx.marker+' ui_ready'}).locator('td').nth(2).scrollIntoViewIfNeeded();
  await shot('ui-bulk-phone');
  const layout=await page.evaluate(()=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,rtl:!!document.querySelector('[dir=rtl]'),scrollableTables:Array.from(document.querySelectorAll('table')).map(t=>({table:t.scrollWidth,container:t.parentElement.clientWidth,overflow:getComputedStyle(t.parentElement).overflowX}))}));
  assert.equal(layout.rtl,true);assert.ok(layout.documentWidth<=layout.viewport+1);assert.ok(layout.scrollableTables.every(t=>t.overflow==='auto'||t.table<=t.container));check('phone RTL layout and contained table scrolling',layout);
  await page.setViewportSize({width:1365,height:900});await page.getByRole('tab',{name:'ترفيع جماعي',exact:true}).scrollIntoViewIfNeeded();await shot('ui-bulk-desktop');
  assert.deepEqual(errors,[]);check('no uncaught browser errors');
  report.pass=true;
}catch(error){report.pass=false;report.failure=error.message;await shot('ui-failure');throw error;}
finally{writeFileSync(join(directory,'phase20d2-ui-qa.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report));
