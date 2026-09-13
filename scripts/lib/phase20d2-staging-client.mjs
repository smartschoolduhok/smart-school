// Narrow D1 query client: only the database identity in tracked STAGING config.
// Wrangler supplies credentials in memory; they never enter arguments or evidence.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function stagingClient(root) {
  const config=JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8'));
  const target='smart-school-staging-db',id='1bdb9c3d-08d6-4023-9cbc-64369d53198a';
  assert.equal(config.name,'smart-school-staging');
  assert.deepEqual(config.d1_databases,[{binding:'DB',database_name:target,database_id:id}]);
  function wrangler(args) {
    const result=spawnSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),...args],{
      cwd:root,encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:2000000,
      env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},
    });
    assert.equal(result.status,0,'Wrangler authentication failed');
    return JSON.parse(result.stdout);
  }
  const identity=wrangler(['whoami','--json']);
  assert.equal(identity.accounts.length,1,'Ambiguous Cloudflare account');
  const accountId=identity.accounts[0].id;
  const credentials=wrangler(['auth','token','--json']);
  assert.ok(credentials.token && ['oauth','api_token'].includes(credentials.type),'Bearer authentication required');
  const url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${id}`;
  function request(method,body) {
    const child=spawnSync(process.execPath,['--input-type=module','-e',
      "let input='';for await(const chunk of process.stdin)input+=chunk;const request=JSON.parse(input);const response=await fetch(process.env.PH20D2_D1_URL+(request.method==='POST'?'/query':''),{method:request.method,redirect:'error',headers:{Authorization:'Bearer '+process.env.PH20D2_CF_TOKEN,'Content-Type':'application/json'},body:request.body===undefined?undefined:JSON.stringify(request.body),signal:AbortSignal.timeout(90000)});process.stdout.write(JSON.stringify({status:response.status,payload:await response.json()}));"
    ],{cwd:root,encoding:'utf8',windowsHide:true,input:JSON.stringify({method,body}),timeout:100000,maxBuffer:40000000,
      env:{...process.env,PH20D2_CF_TOKEN:credentials.token,PH20D2_D1_URL:url}});
    assert.equal(child.status,0,'STAGING D1 request failed');
    return JSON.parse(child.stdout);
  }
  const verified=request('GET');
  assert.equal(verified.status,200);assert.equal(verified.payload.success,true);
  assert.equal(verified.payload.result.uuid,id);assert.equal(verified.payload.result.name,target);
  return {accountId,target,id,query(sql,params){return request('POST',{sql,...(params?{params}:{})});}};
}
