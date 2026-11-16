// SPDX-License-Identifier: MIT
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {Ajv} from 'ajv';
const validate=new Ajv().compile(JSON.parse(readFileSync('docs/report.schema.json','utf8')));
const captures=[
 ['algorithm','check','examples/mvp/algorithm.pym',[],0],
 ['files-buggy','check','examples/mvp/files-buggy.pym',[],1],
 ['files-fixed','check','examples/mvp/files-fixed.pym',[],0],
 ['checkout','check','examples/mvp/checkout.pym',[],1],
 ['self','check','examples/self/studio.pym',[],0],
 ['protocol-buggy','simulate','examples/mvp/task-protocol.pym',['--entry','retryJob','--max-steps','30','--max-samples','1000'],1],
 ['protocol-fixed','simulate','examples/mvp/task-protocol.pym',['--entry','cautiousJob','--max-steps','30','--max-samples','1000'],0],
 ['library','simulate','examples/mvp/library.pym',['--entry','lend','--scope','examples/mvp/library.scope.json','--max-steps','30','--max-samples','1000'],0],
];
mkdirSync('evidence/1.0/reports',{recursive:true});const rows=[];
for(const [name,command,file,args,expected] of captures){const argv=['dist/cli/main.js',command,file,...args,'--format','json'];const p=spawnSync(process.execPath,argv,{encoding:'utf8'});if(p.error)throw p.error;const report=JSON.parse(p.stdout);if(!validate(report))throw Error(JSON.stringify(validate.errors));writeFileSync(`evidence/1.0/reports/${name}.json`,p.stdout);rows.push({name,command:['node',...argv],expected,actual:p.status,snapshot:report.snapshot.id,behaviour:report.results.filter(r=>r.analysisKind==='behaviour').map(r=>({property:r.propertyId,outcome:r.outcome,completion:r.completion,method:r.method,witnessValidation:r.witnessValidation})),findings:report.diagnostics.map(d=>({code:d.code,message:d.message}))});if(p.status!==expected)throw Error(`${name}: expected ${expected}, got ${p.status}`);}
writeFileSync('evidence/1.0/captures.json',JSON.stringify(rows,null,2)+'\n');console.log(rows.map(r=>`${r.name}: expected exit ${r.expected}, observed ${r.actual}`).join('\n'));
