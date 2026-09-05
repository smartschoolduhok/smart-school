// Execute the existing employee shell assertions against generated, disposable
// in-memory data, never the legacy script's fixed localhost:3000 service.
// Only its transport/temp/Python paths are adapted; assertions are unchanged.
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer as httpServer} from 'node:http';
import {createServer} from 'vite';
import {hashPassword} from '../src/lib/authSecurity.ts';
import {root,financeFixture} from '../test/helpers/finance-fixture.mjs';
const bash=process.env.FINANCE_TEST_BASH,python=process.env.FINANCE_TEST_PYTHON;
assert.ok(bash && python,'Set explicit local FINANCE_TEST_BASH and FINANCE_TEST_PYTHON executable paths.');
const directory=mkdtempSync(join(tmpdir(),'smart-school-finance-legacy-')),f=financeFixture(null);
const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}}),{default:app}=await vite.ssrLoadModule('/src/worker.ts');
// Known synthetic identities expected by this historic test; confined to RAM.
const fixtures=[['admin@smart-school.iq','admin123',1,null],['principal@nukhba.iq','school123',3,1],['accountant@rafidain.iq','accountant123',6,2],['teacher@nukhba.iq','teacher123',5,1]];
for(const [email,password,role,school]of fixtures)f.db.prepare("INSERT INTO users(email,password_hash,full_name,role_id,school_id,status,auth_version) VALUES(?,?,'Generated legacy test',?,?,'active',1)").run(email,await hashPassword(password),role,school);
const server=httpServer(async(req,res)=>{
 try {const buffers=[];for await(const chunk of req)buffers.push(chunk);
  const r=await app.request('http://localhost'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(buffers).toString()},
    {DB:f.d1,JWT_SECRET:'generated-local-legacy-finance-secret-only',APP_ENV:'test'});
  res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());
 }catch{res.writeHead(500);res.end('{"error":"local fixture transport failure"}');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
try{
 let script=readFileSync(join(root,'test_employees_full.sh'),'utf8').replace(/\r\n/g,'\n');
 assert.equal((script.match(/http:\/\/localhost:3000/g)??[]).length,1);assert.ok(!script.includes('https://'));
 script=script.replace('http://localhost:3000','http://127.0.0.1:'+port).replaceAll('/tmp/body.txt',join(directory,'body.txt').replaceAll('\\','/')).replace(/\bpython3\b/g,'"'+python.replaceAll('\\','/')+'"');
 const path=join(directory,'employees.sh');writeFileSync(path,script);
 const result=await new Promise(resolve=>{const p=spawn(bash,[path.replaceAll('\\','/')],{cwd:directory,windowsHide:true,env:process.env});let output='';p.stdout.on('data',d=>output+=d);p.stderr.on('data',d=>output+=d);p.on('close',code=>resolve({code,output}));});
 const safe=result.output.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted local token]');
 writeFileSync(join(directory,'employees.log'),safe);
 const passes=Number(safe.match(/PASS: (\d+)/)?.[1]??0),failures=Number(safe.match(/FAIL: (\d+)/)?.[1]??0);
 console.log(safe);console.log(JSON.stringify({original_script:'test_employees_full.sh',original_exit:result.code,passes,failures,artifacts:directory,local_generated_only:true}));
 // The historic shell ends with echo and can exit 0 despite failed checks.
 if(result.code!==0||failures>0||passes===0)process.exitCode=1;
}finally{await new Promise(resolve=>server.close(resolve));await vite.close();f.db.close();}
