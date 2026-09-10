// Disposable generated LOCAL D1 only. No repository config, env file, remote
// binding, real school data, credentials or seed.sql are read by this runner.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,cpSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'vite';
import {signJWT} from '../src/lib/jwtSecurity.ts';
import {root,migrationFiles,financeFixtureSQL,legacyFinanceSQL,feeDraft,paymentDraft} from '../test/helpers/finance-fixture.mjs';
const directory=mkdtempSync(join(tmpdir(),'smart-school-finance-local-'));
const xdgConfigHome=join(directory,'xdg-config');mkdirSync(xdgConfigHome);process.env.XDG_CONFIG_HOME=xdgConfigHome;
const {getPlatformProxy}=await import('wrangler');
const commands=[],evidence=[];let checks=0;
function setup(label,through){const path=join(directory,label);mkdirSync(path);mkdirSync(join(path,'migrations'));
 for(const file of migrationFiles.filter(f=>f.slice(0,4)<=through))copyFileSync(join(root,'migrations',file),join(path,'migrations',file));
 const configPath=join(path,'wrangler.json'),state=join(path,'state'),name='finance-'+label+'-local-only';
 writeFileSync(configPath,JSON.stringify({name,compatibility_date:'2026-04-13',compatibility_flags:['nodejs_compat'],d1_databases:[{binding:'DB',database_name:name,database_id:'00000000-0000-0000-0000-000000000028',migrations_dir:'migrations'}]}));return {path,configPath,state,name};}
function run(env,args,expectedFailure=null){assert.ok(!args.includes('--remote'));const command=[join(root,'node_modules/wrangler/bin/wrangler.js'),'d1',...args,env.name,'--local','--config',env.configPath,'--persist-to',env.state];
 const startedAt=Date.now();
 const r=spawnSync(process.execPath,command,{cwd:env.path,encoding:'utf8',windowsHide:true,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',XDG_CONFIG_HOME:xdgConfigHome},timeout:180000,maxBuffer:10_000_000});
 const elapsedMs=Date.now()-startedAt,stdout=r.stdout??'',stderr=r.stderr??'',output=stdout+stderr;
 commands.push(command);const commandNumber=commands.length,logPath=join(env.path,'command-'+commandNumber+'.log');writeFileSync(logPath,output);
 const safeErrorMessage=r.error?.message?.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted token]')??null;
 const diagnostic={scenario:env.name,status:r.status,signal:r.signal??null,error:{name:r.error?.name??null,code:r.error?.code??null,message:safeErrorMessage},elapsed_ms:elapsedMs,timeout_ms:180000,max_buffer_bytes:10_000_000,stdout_bytes:Buffer.byteLength(stdout),stderr_bytes:Buffer.byteLength(stderr)};
 writeFileSync(join(env.path,'command-'+commandNumber+'.diagnostic.json'),JSON.stringify(diagnostic,null,2)+'\n');
 console.log('LOCAL Wrangler subprocess: '+JSON.stringify(diagnostic));
 assert.equal(r.status,expectedFailure?1:0,'Wrangler subprocess failed; details: '+JSON.stringify(diagnostic)+'; output log: '+logPath);
 if(expectedFailure)assert.match(output,expectedFailure);return stdout;}
function fixtures(env,sql){const file=join(env.path,'generated-local-fixtures.sql');writeFileSync(file,sql);run(env,['execute','--file',file]);}
async function open(env){return getPlatformProxy({configPath:env.configPath,persist:{path:join(env.state,'v3')},remoteBindings:false,envFiles:[]});}
async function snap(db){const tables=(await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results;
 const output={};for(const {name}of tables)output[name]=(await db.prepare('SELECT * FROM "'+name+'"').all()).results.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));return output;}
function preserve(before,after){for(const [table,rows]of Object.entries(before)){if(table==='d1_migrations')continue;assert.equal(after[table].length,rows.length,table);
 const keys=rows.length?Object.keys(rows[0]):[],project=row=>Object.fromEntries(keys.map(k=>[k,row[k]]));const sort=rows=>rows.map(project).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));assert.deepEqual(sort(after[table]),sort(rows),table);}}

// Build one genuine 0001..0027 template, then clone its closed LOCAL persistence
// directory. Each adversarial upgrade still owns an independent D1 database,
// while avoiding five identical Wrangler rebuilds of the historical chain.
const blockerTemplate=setup('blocker-template','0027');
run(blockerTemplate,['migrations','apply']);
fixtures(blockerTemplate,financeFixtureSQL+legacyFinanceSQL);
for(const [label,sql,error]of [
 ['duplicate-fee',"INSERT INTO student_fees(school_id,student_id,academic_year_id,fee_type,amount,currency) VALUES(1,1,1,'رسوم قديمة',100,'IQD')",/UNIQUE constraint failed/],
 ['duplicate-receipt-number',"UPDATE fee_receipts SET receipt_number='same'",/UNIQUE constraint failed/],
 ['duplicate-token',"UPDATE fee_receipts SET verification_token='same'",/UNIQUE constraint failed/],
 ['duplicate-active-reservation',"UPDATE fee_receipts SET status='active'",/UNIQUE constraint failed/],
 ['missing-payment',"UPDATE fee_receipts SET payment_ids_json='[1,999]' WHERE id=1",/finance_legacy_receipt_review_required/],
]){
 const env=setup('blocker-'+label,'0027');cpSync(blockerTemplate.state,env.state,{recursive:true});fixtures(env,sql+';');
 let proxy=await open(env),before,schema;
 const schemaSQL="SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name";
 try{before=await snap(proxy.env.DB);schema=(await proxy.env.DB.prepare(schemaSQL).all()).results;assert.equal(before.d1_migrations.length,28);}finally{await proxy.dispose();}
 copyFileSync(join(root,'migrations/0028_finance_fee_payment_integrity.sql'),join(env.path,'migrations/0028_finance_fee_payment_integrity.sql'));
 run(env,['migrations','apply'],error);proxy=await open(env);
 try{const db=proxy.env.DB;assert.deepEqual(await snap(db),before);assert.deepEqual((await db.prepare(schemaSQL).all()).results,schema);
  assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys,1);assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  checks++;evidence.push({case:label,migration_exit:1,atomic_rollback:true,history_count:28,schema_and_data_unchanged:true,fk_enabled:true,fk_clean:true});
 }finally{await proxy.dispose();}
 console.log('LOCAL expected blocker rolled back schema, history and data: '+label);
}

// Intentionally inconsistent pre-0028 LOCAL fixtures. Migration must preserve
// them, and real workerd must reject operations instead of repairing either.
const driftSQL=`
INSERT INTO student_fees(id,school_id,student_id,academic_year_id,fee_type,amount,currency,paid_amount,status,discount_type,discount_value,discount_amount,net_fee) VALUES
 (3,1,1,1,'Local fee drift',100000,'IQD',50000,'partial','none',0,0,100000),
 (4,2,3,3,'Local treasury drift',100000,'IQD',20000,'partial','none',0,0,100000);
INSERT INTO fee_payments(id,school_id,student_fee_id,student_id,amount,payment_method,payment_date,created_by_user_id) VALUES
 (2,1,3,1,20000,'cash',1788600000,1),(3,2,4,3,20000,'cash',1788600000,1);
INSERT INTO treasury_transactions(id,school_id,transaction_type,category,amount,currency,source_type,source_id,status,created_by) VALUES
 (2,1,'income','tuition_fee',20000,'IQD','fee_payment',2,'active',1),(3,2,'income','tuition_fee',20000,'IQD','fee_payment',3,'active',1);
UPDATE treasury_accounts SET current_balance=80000 WHERE school_id=1;
INSERT INTO treasury_accounts(school_id,current_balance) VALUES(2,20001);
`;
const upgrade=setup('upgrade','0027');run(upgrade,['migrations','apply']);fixtures(upgrade,financeFixtureSQL+legacyFinanceSQL+driftSQL);
let proxy=await open(upgrade),before;try{before=await snap(proxy.env.DB);}finally{await proxy.dispose();}
copyFileSync(join(root,'migrations/0028_finance_fee_payment_integrity.sql'),join(upgrade.path,'migrations/0028_finance_fee_payment_integrity.sql'));
run(upgrade,['migrations','apply']);proxy=await open(upgrade);
try{const db=proxy.env.DB,after=await snap(db);preserve(before,after);assert.equal(after.fee_payments[0].status,'active');assert.equal(after.fee_receipt_payments.length,2);assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys,1);assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);checks++;evidence.push({case:'populated-0027-to-0028',old_tables_compared:Object.keys(before).length-1,all_old_columns_and_rows_equal:true,legacy_usd_preserved:true});}finally{await proxy.dispose();}
console.log('LOCAL populated upgrade preserved every original column and row.');
// Runtime/API checks must use the complete current schema. The isolated
// adversarial blocks above intentionally remain scoped to the historical
// 0027 -> 0028 upgrade contract.
const fresh=setup('fresh','9999');run(fresh,['migrations','apply']);fixtures(fresh,financeFixtureSQL);proxy=await open(fresh);
const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
try{
 const db=proxy.env.DB,{default:app}=await vite.ssrLoadModule('/src/worker.ts');
 assert.equal(
  (await db.prepare('SELECT COUNT(*) n FROM d1_migrations').first()).n,
  migrationFiles.length,
 );
 const secret='generated-local-finance-workerd-test-secret-only',token=await signJWT({email:'owner@matrix.test',auth_version:1},secret);
 async function api(label,method,path,input,{failAt=null,failSql=null,database=db,authToken=token}={}){
  let count=0,maxParameters=0;
  const wrap=(real,sql)=>({real,sql,bind(...args){maxParameters=Math.max(maxParameters,args.length);return wrap(real.bind(...args),sql);},async first(...args){count++;return real.first(...args);},async all(...args){count++;return real.all(...args);},async run(...args){count++;return real.run(...args);}});
  const counted={prepare:sql=>wrap(database.prepare(sql),sql),async batch(statements){count+=statements.length;const real=statements.map(s=>s.real);if(failAt!==null)real[failAt]=database.prepare('SELECT * FROM local_intentional_missing_finance_table');if(failSql)real.splice(1,0,database.prepare(failSql));return database.batch(real);}};
  const response=await app.request('http://localhost/api/'+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+authToken},body:input===undefined?undefined:JSON.stringify(input)},{DB:counted,JWT_SECRET:secret,APP_ENV:'test'});
  const result={status:response.status,body:await response.json()};assert.ok(count<50,label+' '+count);assert.ok(maxParameters<=100);evidence.push({case:label,status:result.status,http_d1_statements:count,max_parameters:maxParameters});return result;
 }
 async function fee(label,patch={}){const r=await api(label,'POST','student-fees',feeDraft({fee_type:label,...patch}));assert.equal(r.status,201,JSON.stringify(r));return r.body.data.id;}
 const driftProxy=await open(upgrade);
 try{const adminToken=await signJWT({email:'admin@matrix.test',auth_version:1},secret);
  for(const [label,schoolId,feeId,paymentId]of [['fee',1,3,2],['treasury',2,4,3]])for(const op of ['payment','metadata','amount','cancel']){
   const before=await snap(driftProxy.env.DB),options={database:driftProxy.env.DB,authToken:adminToken};
   const r=op==='payment'?await api('legacy-'+label+'-'+op,'POST','fee-payments',paymentDraft(feeId,{school_id:schoolId,amount:1000}),options):
    op==='cancel'?await api('legacy-'+label+'-'+op,'PUT','fee-payments/'+paymentId+'/cancel',{school_id:schoolId,cancel_reason:'Local correction'},options):
    await api('legacy-'+label+'-'+op,'PUT','student-fees/'+feeId,{school_id:schoolId,...(op==='metadata'?{notes:'Local edit'}:{amount:120000})},options);
   assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.body.code,'finance_reconciliation_required');assert.deepEqual(await snap(driftProxy.env.DB),before);checks++;
  }
 }finally{await driftProxy.dispose();}
 const id=await fee('fee-create');let r=await api('fee-update','PUT','student-fees/'+id,{school_id:1,notes:'Local only'});assert.equal(r.status,200);
 const payment=paymentDraft(id),first=await api('one-payment','POST','fee-payments',payment);assert.equal(first.status,201);const p=first.body.data.id;
 const retry=await api('idempotent-retry','POST','fee-payments',payment);assert.equal(retry.status,200);assert.equal(retry.body.data.id,p);assert.equal(retry.body.data.already_applied,true);checks++;
 const raceFee=await fee('concurrent-different-key-fee');
 const race=await Promise.all([api('concurrent-payment-A','POST','fee-payments',paymentDraft(raceFee)),api('concurrent-payment-B','POST','fee-payments',paymentDraft(raceFee))]);
 assert.equal(race.filter(r=>r.status===201).length,1);assert.equal(race.find(r=>r.status!==201).body.code,'payment_overpay');
 assert.equal((await db.prepare('SELECT paid_amount FROM student_fees WHERE id=?').bind(raceFee).first()).paid_amount,60000);assert.equal((await db.prepare("SELECT SUM(amount) n FROM fee_payments WHERE student_fee_id=? AND status='active'").bind(raceFee).first()).n,60000);checks++;
 const sameFee=await fee('concurrent-same-key-fee'),same=paymentDraft(sameFee),twins=await Promise.all([api('same-key-A','POST','fee-payments',same),api('same-key-B','POST','fee-payments',same)]);
 assert.deepEqual(twins.map(r=>r.status).sort(),[200,201]);assert.equal(twins[0].body.data.id,twins[1].body.data.id);checks++;
 const installmentFee=await fee('installment-plan-fee'),installment=await api('installment-plan-create','PUT','student-fees/'+installmentFee+'/installment-plan',{school_id:1,expected_fee_revision:0,notes:'PRIVATE LOCAL D1 PLAN NOTE',items:[
  {label:'الدفعة الأولى',amount:50000,due_date:'2026-09-01'},{label:'الدفعة الثانية',amount:50000,due_date:'2027-01-01'},
 ]});
 assert.equal(installment.status,200,JSON.stringify(installment));assert.equal(installment.body.data.plan.items.length,2);checks++;
 const installmentPayment=await api('installment-payment','POST','fee-payments',paymentDraft(installmentFee,{amount:25000,notes:'PRIVATE LOCAL D1 PAYMENT NOTE'}));
 assert.equal(installmentPayment.status,201,JSON.stringify(installmentPayment));
 const installmentDocument=await api('installment-receipt-v2','POST','fee-receipts/generate',{school_id:1,student_id:1,payment_ids:[installmentPayment.body.data.id]});
 assert.equal(installmentDocument.status,200,JSON.stringify(installmentDocument));assert.equal(installmentDocument.body.data.receipt.receipt_schema_version,2);
 assert.equal(JSON.parse(installmentDocument.body.data.receipt.installment_plan_snapshot_json)[0].items[0].paid_amount,25000);checks++;
 await db.prepare("INSERT INTO parent_student_links(school_id,parent_user_id,student_id,status,created_by_user_id) VALUES(1,8,1,'active',1)").run();
 const parentToken=await signJWT({email:'parent@matrix.test',auth_version:1},secret),parentFinance=await api('parent-installment-view','GET','parent/students/1/finance',undefined,{authToken:parentToken});
 assert.equal(parentFinance.status,200,JSON.stringify(parentFinance));const parentFee=parentFinance.body.data.fees.find(fee=>fee.id===installmentFee);assert.equal(parentFee.installment_plan.items[0].paid_amount,25000);
 assert.ok(!JSON.stringify(parentFinance.body).includes('PRIVATE LOCAL D1 PLAN NOTE'));assert.ok(!JSON.stringify(parentFinance.body).includes('PRIVATE LOCAL D1 PAYMENT NOTE'));checks++;
 await db.prepare("UPDATE parent_student_links SET status='inactive',updated_at=unixepoch() WHERE school_id=1 AND parent_user_id=8 AND student_id=1").run();
 const revokedParent=await api('parent-installment-revoked','GET','parent/students/1/finance',undefined,{authToken:parentToken});assert.equal(revokedParent.status,404);checks++;
 const docInput={school_id:1,student_id:1,payment_ids:[p]},docs=await Promise.all([api('receipt-one-A','POST','fee-receipts/generate',docInput),api('receipt-one-B','POST','fee-receipts/generate',docInput)]);
 assert.ok(docs.every(r=>r.status===200),JSON.stringify(docs));assert.equal(docs[0].body.data.receipt.id,docs[1].body.data.receipt.id);const receipt=docs[0].body.data.receipt;checks++;
 for(const [label,path,body]of [['receipt-cancel','fee-receipts/'+receipt.id+'/cancel',{school_id:1,cancel_reason:'Local document correction'}],['payment-cancel','fee-payments/'+p+'/cancel',{school_id:1,cancel_reason:'Local money correction'}]]){
  const before=await snap(db),failure=await api(label+'-final-read-rollback','PUT',path,body,{failAt:1});assert.equal(failure.status,500);assert.deepEqual(await snap(db),before);checks++;
  const result=await api(label,'PUT',path,body);assert.equal(result.status,200);checks++;
 }
 const tenFee=await fee('receipt-ten-fee'),ids=[];for(let i=0;i<10;i++){const r=await api('ten-payment-'+i,'POST','fee-payments',paymentDraft(tenFee,{amount:1000}));assert.equal(r.status,201);ids.push(r.body.data.id);}
 const ten=await api('receipt-ten-payments','POST','fee-receipts/generate',{school_id:1,student_id:1,payment_ids:ids});assert.equal(ten.status,200);assert.equal(ten.body.data.receipt.total_amount,10000);checks++;
 const printPath='fee-receipts/'+ten.body.data.receipt.id+'/mark-printed',beforePrint=await snap(db),badPrint=await api('mark-print-final-read-rollback','PUT',printPath,{school_id:1},{failAt:2});assert.equal(badPrint.status,500);assert.deepEqual(await snap(db),beforePrint);checks++;
 assert.equal((await api('mark-printed','PUT',printPath,{school_id:1,copies:2})).status,200);checks++;
 for(const stage of ['first','final','fee','treasury','cache']){
  const failFee=await fee('rollback-'+stage),targets={fee:['UPDATE','student_fees'],treasury:['INSERT','treasury_transactions'],cache:['INSERT','treasury_accounts']};
  if(targets[stage]){const [op,table]=targets[stage];await db.prepare("CREATE TRIGGER local_fail_stage BEFORE "+op+' ON '+table+" BEGIN SELECT RAISE(ABORT,'local injected stage'); END;").run();}
  const before=await snap(db),r=await api('rollback-'+stage,'POST','fee-payments',paymentDraft(failFee),{failAt:stage==='first'?0:stage==='final'?1:null});assert.equal(r.status,500);assert.deepEqual(await snap(db),before);checks++;
  if(targets[stage])await db.prepare('DROP TRIGGER local_fail_stage').run();
 }
 const oldYear=await db.prepare('SELECT name FROM academic_years WHERE id=1').first();
 await db.batch([db.prepare('UPDATE academic_years SET is_active=0 WHERE school_id=1'),db.prepare('UPDATE academic_years SET is_active=1 WHERE id=2')]);
 const yearFee=await fee('old-year-receipt'),yearPayment=await api('old-year-payment','POST','fee-payments',paymentDraft(yearFee));assert.equal(yearPayment.status,201);
 const yearDoc=await api('old-fee-year-not-active-year','POST','fee-receipts/generate',{school_id:1,student_id:1,payment_ids:[yearPayment.body.data.id]});
 assert.equal(yearDoc.status,200,JSON.stringify(yearDoc));assert.equal(yearDoc.body.data.receipt.academic_year_snapshot,oldYear.name);checks++;
 const unspecifiedFee=await fee('unspecified-year-fee',{academic_year_id:null}),unspecifiedPayment=await api('unspecified-year-payment','POST','fee-payments',paymentDraft(unspecifiedFee));assert.equal(unspecifiedPayment.status,201);
 const otherFee=await fee('other-year-fee',{academic_year_id:2}),otherPayment=await api('other-year-payment','POST','fee-payments',paymentDraft(otherFee));assert.equal(otherPayment.status,201);
 const beforeMixed=await snap(db),mixed=await api('mixed-years-rejected','POST','fee-receipts/generate',{school_id:1,student_id:1,payment_ids:[otherPayment.body.data.id,unspecifiedPayment.body.data.id]});
 assert.equal(mixed.body.code,'receipt_academic_year_conflict');assert.equal(mixed.status,400);assert.deepEqual(await snap(db),beforeMixed);checks++;
 const unspecifiedDoc=await api('null-fee-year-remains-null','POST','fee-receipts/generate',{school_id:1,student_id:1,payment_ids:[unspecifiedPayment.body.data.id]});assert.equal(unspecifiedDoc.status,200);assert.equal(unspecifiedDoc.body.data.receipt.academic_year_snapshot,null);checks++;
 const beforeKey=await snap(db);await assert.rejects(()=>db.prepare("UPDATE student_fees SET fee_type_key='tampered local key' WHERE id=?").bind(yearFee).run(),/invalid_finance_request/);assert.deepEqual(await snap(db),beforeKey);checks++;
 assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys,1);assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 const balance=await db.prepare("SELECT (SELECT current_balance FROM treasury_accounts WHERE school_id=1) cache,coalesce(SUM(CASE WHEN transaction_type='income' THEN amount ELSE -amount END),0) ledger FROM treasury_transactions WHERE school_id=1 AND status='active'").first();assert.equal(balance.cache,balance.ledger);checks++;
 console.log(JSON.stringify({local_only:true,real_migrations:migrationFiles.length,checks,evidence,artifacts:directory},null,2));
 writeFileSync(join(directory,'evidence.json'),JSON.stringify({checks,evidence,commands},null,2));
}finally{await vite.close();await proxy.dispose();}
