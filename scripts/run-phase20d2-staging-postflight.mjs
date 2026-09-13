// Read-only evidence after migration and after QA; compare every historical row.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {stagingClient} from './lib/phase20d2-staging-client.mjs';
import {contentSnapshot,digest} from './lib/local-d1-restore.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [mode,baselineArgument,evidenceArgument,confirmation]=process.argv.slice(2);
assert.ok(['migration','qa'].includes(mode));assert.equal(confirmation,'--confirm-staging');
const baselinePath=resolve(baselineArgument),evidencePath=resolve(evidenceArgument);
for(const path of [baselinePath,evidencePath])assert.ok(relative(root,path).startsWith('..'));
const baseline=JSON.parse(readFileSync(baselinePath,'utf8'));
const client=stagingClient(root);
function read(queries){
  for(const sql of queries)assert.match(sql,/^(?:SELECT\b|PRAGMA (?:table_xinfo|foreign_key_check)\b)/u);
  const response=client.query(queries.join(';\n')+';');
  assert.equal(response.status,200,JSON.stringify(response.payload.errors));assert.equal(response.payload.success,true);
  assert.equal(response.payload.result.length,queries.length);
  assert.ok(response.payload.result.every(r=>r.success && r.meta.changed_db===false && Number(r.meta.rows_written||0)===0));
  return response.payload.result.map(r=>r.results);
}
const schemaSql='SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name';
const [schema,fk,history]=read([schemaSql,'PRAGMA foreign_key_check','SELECT id,name,applied_at FROM d1_migrations ORDER BY id']);
assert.deepEqual(fk,[]);assert.equal(history.length,36);assert.equal(new Set(history.map(r=>r.name)).size,36);assert.equal(history.at(-1).name,'0035_official_result_promotion.sql');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const tables=schema.filter(r=>r.type==='table'&&!r.name.startsWith('_cf_')&&!r.name.startsWith('sqlite_stat'));
const columnQueries=tables.map(t=>`PRAGMA table_xinfo(${quote(t.name)})`),columns=read(columnQueries);
const rowQueries=tables.map((t,i)=>'SELECT '+columns[i].filter(c=>c.hidden!==1).map(c=>c.name).flatMap((c,j)=>[
  `typeof(${quote(c)}) AS t${j}`,
  `CASE typeof(${quote(c)}) WHEN 'null' THEN NULL WHEN 'integer' THEN CAST(${quote(c)} AS TEXT) WHEN 'real' THEN printf('%!.17g',${quote(c)}) ELSE hex(${quote(c)}) END AS v${j}`,
]).join(',')+' FROM '+quote(t.name));
const rows=read(rowQueries),cache=new Map([[schemaSql,schema],['PRAGMA foreign_key_check',fk]]);
columnQueries.forEach((q,i)=>cache.set(q,columns[i]));rowQueries.forEach((q,i)=>cache.set(q,rows[i]));
const snapshot=await contentSnapshot(async sql=>{assert.ok(cache.has(sql));return cache.get(sql);});
const comparisons={};
for(const [name,before] of Object.entries(baseline.snapshot.tables)){
  if(name==='d1_migrations'||name.startsWith('sqlite_'))continue;
  const after=snapshot.tables[name];assert.ok(after,name);assert.deepEqual(after.columns,before.columns,name+' columns');
  if(mode==='migration'){assert.equal(after.count,before.count,name+' count');assert.deepEqual(after.content,before.content,name+' values');}
  else {
    const counts=new Map();for(const row of after.content)counts.set(row,(counts.get(row)||0)+1);
    for(const row of before.content){assert.ok(counts.get(row)>0,name+' historical row changed');counts.set(row,counts.get(row)-1);}
  }
  comparisons[name]={before_count:before.count,after_count:after.count,before_hash:before.hash,after_hash:after.hash,historical_rows_unchanged:true};
}
const names=schema.filter(r=>r.type==='view'&&r.name.endsWith('_readiness')).map(r=>r.name).sort();
assert.ok(names.includes('student_promotion_result_readiness'));
const readinessRows=read(names.map(n=>'SELECT * FROM '+quote(n))),readiness=Object.fromEntries(names.map((n,i)=>[n,readinessRows[i]]));
for(const [name,results]of Object.entries(readiness)){
  if(name.startsWith('finance_'))assert.ok(results.every(r=>Number(r.healthy)===1),name);
  else if(name==='academic_grade_policy_readiness')assert.ok(results.every(r=>['healthy','not_configured'].includes(r.status)),name);
  else assert.ok(results.every(r=>r.status==='healthy'),name);
}
const pending=spawnSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','migrations','list',client.target,'--remote','--config',join(root,'wrangler.jsonc')],{cwd:root,encoding:'utf8',windowsHide:true,timeout:90000,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'}});
assert.equal(pending.status,0);assert.match(pending.stdout,/No migrations to apply/u);
const evidence={mode,staging_only:true,read_only:true,target:client.target,target_id:client.id,captured_at:new Date().toISOString(),migration_history:history,pending:[],foreign_key_check:fk,readiness,comparisons,snapshot,snapshot_hash:digest(snapshot)};
writeFileSync(evidencePath,JSON.stringify(evidence,null,2));
console.log(JSON.stringify({mode,evidence_path:evidencePath,migrations:history.length,pending:[],historical_tables_unchanged:Object.keys(comparisons).length,foreign_key_violations:0,readiness,snapshot_hash:evidence.snapshot_hash}));
