// Exact, isolated D1 restore and rehearsal for migration 0046. No remote mode.
import assert from 'node:assert/strict';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {getPlatformProxy} from 'wrangler';
import {contentSnapshot,digest,prepareLocalRestore,assertSameContent} from './lib/local-d1-restore.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [backupArg,snapshotArg,evidenceArg]=process.argv.slice(2);
assert.ok(backupArg&&snapshotArg&&evidenceArg,'Backup, full snapshot, and private evidence paths required');
const [backupPath,snapshotPath,evidencePath]=[backupArg,snapshotArg,evidenceArg].map(p=>resolve(p));
for(const p of [backupPath,snapshotPath,evidencePath]){const r=relative(root,p);assert.ok(r==='..'||r.startsWith('..'+sep),'Keep evidence outside repository');}
assert.ok(!existsSync(evidencePath),'Do not overwrite rehearsal evidence');
const before=JSON.parse(readFileSync(snapshotPath,'utf8'));
const migration='0046_cancelled_draft_readiness.sql';
assert.deepEqual(before.pending,[migration]);assert.equal(before.migration_history.length,46);
assert.equal(before.migration_history.at(-1).name,'0045_admissions_transfers.sql');
const backup=readFileSync(backupPath),restore=prepareLocalRestore(backup.toString('utf8'));
const isolated=mkdtempSync(join(tmpdir(),'smart-school-operational-local-'));
const migrations=join(isolated,'migrations'),persist=join(isolated,'.wrangler','state'),state=join(persist,'v3'),config=join(isolated,'wrangler.json');
mkdirSync(migrations);copyFileSync(join(root,'migrations',migration),join(migrations,migration));
writeFileSync(config,JSON.stringify({name:'operational-local-only',compatibility_date:'2026-04-13',compatibility_flags:['nodejs_compat'],d1_databases:[{binding:'DB',database_name:'operational-local-only',database_id:'00000000-0000-0000-0000-000000000046',migrations_dir:migrations}]}));
const open=()=>getPlatformProxy({configPath:config,persist:{path:state},remoteBindings:false,envFiles:[]});
let proxy=await open();await proxy.env.DB.prepare('SELECT 1').all();await proxy.dispose();
const directory=join(state,'d1','miniflare-D1DatabaseObject'),files=readdirSync(directory).filter(n=>n.endsWith('.sqlite')&&n!=='metadata.sqlite');assert.equal(files.length,1);
const sqlite=new DatabaseSync(join(directory,files[0]));
try{sqlite.exec(restore.baseSql);for(const insert of restore.inserts)sqlite.prepare(insert.sql).run(...insert.values);}finally{sqlite.close();}
proxy=await open();
try{const restored=await contentSnapshot(async sql=>(await proxy.env.DB.prepare(sql).all()).results);assertSameContent(before.snapshot,restored);assert.deepEqual(restored,before.snapshot);}finally{await proxy.dispose();}
const expectedDb=new DatabaseSync(':memory:');expectedDb.exec(backup.toString('utf8'));expectedDb.exec(readFileSync(join(root,'migrations',migration),'utf8'));
const expectedReadiness={};
try{for(const name of Object.keys(before.readiness)){assert.match(name,/^[a-z_]+$/);expectedReadiness[name]=expectedDb.prepare(`SELECT * FROM "${name}"`).all();}}finally{expectedDb.close();}
const run=spawnSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','operational-local-only','--local','--persist-to',persist,'--config',config],{cwd:isolated,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:2000000,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'}});
assert.equal(run.status,0,run.stderr||run.stdout);
proxy=await open();let after,history,readiness={};
try{
 after=await contentSnapshot(async sql=>(await proxy.env.DB.prepare(sql).all()).results);
 history=(await proxy.env.DB.prepare('SELECT id,name,applied_at FROM d1_migrations ORDER BY id').all()).results;
 assert.equal(history.length,47);assert.equal(new Set(history.map(r=>r.name)).size,47);assert.equal(history.at(-1).name,migration);assert.deepEqual(history.slice(0,46),before.migration_history);
 for(const [name,table]of Object.entries(before.snapshot.tables))if(!['d1_migrations','sqlite_sequence'].includes(name))assert.deepEqual(after.tables[name],table,'Business data changed: '+name);
 const seq=(s)=>s.tables.sqlite_sequence.content.filter(r=>Buffer.from(JSON.parse(r)[0][1],'hex').toString('utf8')!=='d1_migrations');assert.deepEqual(seq(after),seq(before.snapshot));
 const schema=(s)=>s.schema.filter(r=>r.name!=='result_card_publication_readiness');assert.deepEqual(schema(after),schema(before.snapshot));
 assert.deepEqual(after.foreignKeys,[]);assert.equal(Object.keys(after.tables).length,95);
 for(const name of Object.keys(before.readiness))readiness[name]=(await proxy.env.DB.prepare(`SELECT * FROM "${name}"`).all()).results;
 assert.deepEqual(JSON.parse(JSON.stringify(readiness)),JSON.parse(JSON.stringify(expectedReadiness)));
 for(const name of Object.keys(readiness))if(name!=='result_card_publication_readiness')assert.deepEqual(readiness[name],before.readiness[name]);
}finally{await proxy.dispose();}
const evidence={at:new Date().toISOString(),local_only:true,work_root:isolated,backup_path:backupPath,backup_bytes:backup.length,backup_sha256:createHash('sha256').update(backup).digest('hex'),exact_restore:true,business_tables_preserved:93,schema_change_only:'result_card_publication_readiness',migrations:47,foreign_key_check:[],readiness,expected_after_snapshot:after,bound_oversized_rows:restore.inserts.map(i=>({parameters:i.values.length,bytes:i.bytes}))};
writeFileSync(evidencePath,JSON.stringify(evidence,null,2),{flag:'wx'});console.log(JSON.stringify({...evidence,expected_after_snapshot:undefined,readiness:undefined}));
