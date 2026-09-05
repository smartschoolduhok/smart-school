// Execute the package's actual test commands and retain auditable local logs.
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const names=['finance-fees','security','rbac','settings','academic-years','student-enrollments','student-promotion','student-profile','subject-management','subject-order','religious-subjects','subject-applicability','flexible-grades','grade-presentation','result-cards','excel-import','timetable','teaching-load-matrix','week-setup'];
const directory=mkdtempSync(join(tmpdir(),'smart-school-finance-regressions-')),results=[];
console.log('Regression artifacts: '+directory);
async function run(name){const command=pkg.scripts['test:'+name],args=command.split(/\s+/).slice(1);assertNode(command);
 return new Promise(resolve=>{const child=spawn(process.execPath,args,{cwd:root,env:process.env,windowsHide:true});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 child.on('close',code=>{writeFileSync(join(directory,name+'.log'),output);const read=key=>Number(output.match(new RegExp('(?:ℹ|#) '+key+' (\\d+)'))?.[1]??NaN);
 const result={suite:name,command,exit_code:code,tests:read('tests'),pass:read('pass'),fail:read('fail'),skipped:read('skipped')};results.push(result);console.log(JSON.stringify(result));resolve(result);});});}
function assertNode(command){if(!command.startsWith('node ')||command.includes('--remote'))throw new Error('Unexpected command');}
// Sequential Vite suites avoid resource-contention artifacts in local SQLite.
for(const name of names)await run(name);
const files=new Map();for(const name of names)for(const file of pkg.scripts['test:'+name].split(/\s+/).filter(s=>s.startsWith('test/')))files.set(file,(files.get(file)??0)+1);
const report={results,executions:results.reduce((n,r)=>n+r.tests,0),passes:results.reduce((n,r)=>n+r.pass,0),failures:results.reduce((n,r)=>n+r.fail,0),skips:results.reduce((n,r)=>n+r.skipped,0),overlapping_files:[...files].filter(([,n])=>n>1)};
writeFileSync(join(directory,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(results.some(r=>r.exit_code!==0||!Number.isFinite(r.tests)))process.exitCode=1;
