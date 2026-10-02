// Execute the package's actual test commands and retain auditable local logs.
import {readFileSync,mkdtempSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const names=['student-study-status','employee-records','user-accounts','finance-fees','treasury-payroll','security','rbac','resource-access','ui-foundations','settings','academic-years','student-enrollments','student-promotion','student-profile','subject-management','subject-order','religious-subjects','subject-applicability','flexible-grades','grade-policies','academic-analytics','grade-presentation','result-cards','result-card-ui','result-publication','official-promotion','official-books','excel-import','timetable','attendance','homework','communication','grade-progress','admissions','school-workflow-ui','operational-readiness','backup-verification','teaching-load-matrix','week-setup','timetable-parallel','section-advisors'];
const listedFiles=new Set(names.flatMap(name=>{
 const command=pkg.scripts['test:'+name];
 if(!command)throw new Error('Missing regression suite: '+name);
 return command.match(/test\/[\w.-]+\.test\.mjs/g)??[];
}));
const missingFiles=readdirSync(join(root,'test')).filter(file=>file.endsWith('.test.mjs')).map(file=>'test/'+file).filter(file=>!listedFiles.has(file));
if(missingFiles.length)throw new Error('Regression manifest omits: '+missingFiles.join(', '));
const directory=mkdtempSync(join(tmpdir(),'smart-school-finance-regressions-')),results=[];
console.log('Regression artifacts: '+directory);
function printFailureDetails(name, output, logPath) {
 const lines=output.split(/\r?\n/),selected=new Set();
 // TAP puts diagnostics beside the failed test; the spec reporter also repeats
 // failures at the end. Keep both so an early failure survives a long suite.
 const firstFailure=lines.findIndex(line=>/^\s*(?:not ok\b|✖)/u.test(line));
 if(firstFailure>=0)for(let i=Math.max(0,firstFailure-5);i<Math.min(lines.length,firstFailure+55);i++)selected.add(i);
 for(let i=Math.max(0,lines.length-120);i<lines.length;i++)selected.add(i);
 console.error(`Failed regression suite: ${name}. Full log: ${logPath}`);
 let previous=-1;
 for(const index of [...selected].sort((a,b)=>a-b)) {
  if(index>previous+1)console.error(`[... ${index-previous-1} lines omitted ...]`);
  const line=lines[index],limit=1200;
  console.error(`${index+1}: ${line.length>limit?line.slice(0,limit)+` [... ${line.length-limit} characters omitted ...]`:line}`);
  previous=index;
 }
}
async function run(name){const command=pkg.scripts['test:'+name],args=command.split(/\s+/).slice(1);assertNode(command);
 return new Promise(resolve=>{const child=spawn(process.execPath,args,{cwd:root,env:process.env,windowsHide:true});let output='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 child.on('error',error=>{output+=`\nRegression process error: ${error.message}\n`;});
 child.on('close',code=>{const logPath=join(directory,name+'.log');writeFileSync(logPath,output);const read=key=>Number(output.match(new RegExp('(?:ℹ|#) '+key+' (\\d+)'))?.[1]??NaN);
 const result={suite:name,command,exit_code:code,tests:read('tests'),pass:read('pass'),fail:read('fail'),skipped:read('skipped')};results.push(result);console.log(JSON.stringify(result));
 if(code!==0||!Number.isFinite(result.tests))printFailureDetails(name,output,logPath);
 resolve(result);});});}
function assertNode(command){if(!command.startsWith('node ')||command.includes('--remote'))throw new Error('Unexpected command');}
// Sequential Vite suites avoid resource-contention artifacts in local SQLite.
for(const name of names)await run(name);
const files=new Map();for(const name of names)for(const file of pkg.scripts['test:'+name].split(/\s+/).filter(s=>s.startsWith('test/')))files.set(file,(files.get(file)??0)+1);
const report={results,executions:results.reduce((n,r)=>n+r.tests,0),passes:results.reduce((n,r)=>n+r.pass,0),failures:results.reduce((n,r)=>n+r.fail,0),skips:results.reduce((n,r)=>n+r.skipped,0),overlapping_files:[...files].filter(([,n])=>n>1)};
writeFileSync(join(directory,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(results.some(r=>r.exit_code!==0||!Number.isFinite(r.tests)))process.exitCode=1;
