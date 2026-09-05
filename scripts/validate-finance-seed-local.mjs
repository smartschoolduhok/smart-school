// EXACT fresh -> all genuine migrations -> repository seed.sql. Disposable LOCAL only.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {getPlatformProxy} from 'wrangler';
import {root,migrationFiles} from '../test/helpers/finance-fixture.mjs';
import {assertFinanceSeed} from '../test/helpers/finance-seed-assertions.mjs';
const dir=mkdtempSync(join(tmpdir(),'smart-school-finance-seed-local-')),config=join(dir,'wrangler.json'),state=join(dir,'state'),name='finance-demo-seed-local-only';
mkdirSync(join(dir,'migrations'));for(const file of migrationFiles)copyFileSync(join(root,'migrations',file),join(dir,'migrations',file));
copyFileSync(join(root,'seed.sql'),join(dir,'seed.sql'));
writeFileSync(config,JSON.stringify({name,compatibility_date:'2026-04-13',compatibility_flags:['nodejs_compat'],d1_databases:[{binding:'DB',database_name:name,database_id:'00000000-0000-0000-0000-000000000028',migrations_dir:'migrations'}]}));
console.log('LOCAL seed artifacts: '+dir);
for(const [label,args]of [['migrations',['migrations','apply']],['seed',['execute','--file',join(dir,'seed.sql')]]]){
 const command=[join(root,'node_modules/wrangler/bin/wrangler.js'),'d1',...args,name,'--local','--config',config,'--persist-to',state];
 const r=spawnSync(process.execPath,command,{cwd:dir,encoding:'utf8',windowsHide:true,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},timeout:180000,maxBuffer:10_000_000});
 writeFileSync(join(dir,label+'.log'),(r.stdout??'')+(r.stderr??''));assert.equal(r.status,0,label+': '+r.stdout+'\n'+r.stderr);
}
const proxy=await getPlatformProxy({configPath:config,persist:{path:join(state,'v3')},remoteBindings:false,envFiles:[]});
try{const evidence=await assertFinanceSeed(proxy.env.DB);console.log(JSON.stringify(evidence));writeFileSync(join(dir,'evidence.json'),JSON.stringify(evidence,null,2));}finally{await proxy.dispose();}
