// Read-only target-specific diagnosis; never apply migrations or repair rows here.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stagingClient} from './lib/phase20d2-staging-client.mjs';
import {collectOperationalReadiness} from './lib/operational-readiness.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [output,confirmation]=process.argv.slice(2);
assert.ok(output,'Evidence path outside Git is required');assert.equal(confirmation,'--confirm-staging');
const evidencePath=resolve(output),rel=relative(root,evidencePath);
assert.ok(rel==='..'||rel.startsWith('..'+sep),'Evidence must be outside the repository');
const client=stagingClient(root);
assert.equal(client.accountId,'8d30029482b5722704371f03169c5ca1');
async function read(sql){
 assert.match(sql,/^(?:SELECT\b|PRAGMA foreign_key_check$)/u);
 const r=client.query(sql);assert.equal(r.status,200);assert.equal(r.payload.success,true);
 assert.equal(r.payload.result.length,1);const row=r.payload.result[0];assert.equal(row.success,true);
 assert.equal(row.meta.changed_db,false);assert.equal(Number(row.meta.rows_written||0),0);return row.results;
}
const report=await collectOperationalReadiness(read,new Date().toISOString().slice(0,10));
const files=readdirSync(join(root,'migrations')).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort();
const applied=report.migration_history.map(r=>r.name);
assert.equal(new Set(applied).size,applied.length,'Duplicate migrations');
assert.deepEqual(applied,files.slice(0,applied.length),'Unexpected migration history');
Object.assign(report,{captured_at:new Date().toISOString(),account_id:client.accountId,database_id:client.id,target:client.target,pending:files.slice(applied.length)});
mkdirSync(dirname(evidencePath),{recursive:true});writeFileSync(evidencePath,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({evidence_path:evidencePath,read_only:true,pending:report.pending,...report.summary,production_ready:false}));
