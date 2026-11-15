// Dev-server only. MCP performs all graph/link operations; source reads validate answers.
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { initializeWorkspace } from '../../dist/project/workspace.js';
const evidence=resolve('evidence/r1-c2');await mkdir(evidence,{recursive:true});
const scratch=await mkdtemp(join(process.env.PYM_SCRATCH,'mcp-links-restic-'));const root=join(scratch,'restic');
const transcript=[];let client;
const git=(...args)=>{const r=spawnSync('git',['-C',root,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
try{
 await cp(join(homedir(),'pymtheg-dev/corpora/restic'),root,{recursive:true,verbatimSymlinks:true});assert.equal(spawnSync('chmod',['-R','u+w',root]).status,0);
 assert.equal(git('rev-parse','HEAD'),'c734245fd3ae9bcac8ab3aaafb4482d4b5d0ae92');assert.equal(git('status','--porcelain'),'');
 await initializeWorkspace(root,'MCP restic links');
 const transport=new StdioClientTransport({command:process.execPath,args:[resolve('dist/cli/main.js'),'mcp',root],env:{...process.env},stderr:'pipe'});transport.stderr?.resume();
 client=new Client({name:'restic-requirements-agent',version:'1'});await client.connect(transport);
 const call=async(name,args)=>{const r=await client.callTool({name,arguments:args},{timeout:3600000});assert.equal(r.isError,undefined,JSON.stringify(r));const bytes=Buffer.byteLength(JSON.stringify(r));assert.ok(bytes<=65536);transcript.push({name,args,bytes,result:r.structuredContent});return r.structuredContent;};
 const graph=async(action,query,extra={})=>{const first=await call('code_graph',{action,...(query?{query}:{}),...extra});return first.state==='running'?call('graph_result',{jobId:first.jobId,wait:true,section:extra.section??'answer'}):first;};
 const link=async(action,args={})=>{const first=await call('requirement_links',{action,...args});return first.state==='running'?call('link_result',{jobId:first.jobId,wait:true,section:args.section??'items'}):first;};
 console.log('Indexing clean pinned restic copy through MCP');const indexed=await graph('index',undefined,{wait:false});assert.equal(indexed.summary.sync.complete,true);assert.equal(indexed.summary.failedFileCount,0);
 const specs=[
  {id:'C2-ID',title:'IDs can be parsed',selector:'ParseID',path:'internal/restic/id.go',needle:'func ParseID'},
  {id:'C2-INDEX',title:'Repository index loads',selector:'(*Repository).LoadIndex',path:'internal/repository/repository.go',needle:'func (r *Repository) LoadIndex'},
  {id:'C2-PACK',title:'Blobs are packed before upload',selector:'internal/repository/packer_manager.go:116',path:'internal/repository/packer_manager.go',needle:'func (r *packerManager) SaveBlob'},
 ];
 const checks=[];const links=[];
 for(const spec of specs){
  console.log('Linking',spec.id,spec.selector);
  const found=await graph('symbol',spec.selector);const selected=found.items[0];assert.match(selected.ref,/^symbol:[0-9a-f]{64}$/);assert.equal(selected.file,spec.path);
  const lines=(await readFile(join(root,spec.path),'utf8')).split('\n');assert.ok(lines[selected.line-1].includes(spec.needle));checks.push({path:spec.path,line:selected.line,excerpt:lines[selected.line-1],ref:selected.ref});
  await link('requirement',{id:spec.id,title:spec.title});
  const added=await link('add',{record:spec.id,selector:selected.ref});assert.equal(added.summary.status,'created');assert.equal(added.items[0].symbol.ref,selected.ref);links.push(added.items[0]);
 }
 const clean=await link('check');assert.equal(clean.summary.passed,true);assert.equal(clean.summary.counts.ok,3);
 const file=join(root,'internal/repository/packer_manager.go');const before=await readFile(file,'utf8');const anchor='packer, err := r.pickPacker(len(ciphertext))';assert.ok(before.includes(anchor));await writeFile(file,before.replace(anchor,anchor+'\n\t_ = 0 // R1-C2 MCP edit'));
 const changed=await link('check');assert.equal(changed.summary.passed,false);assert.equal(changed.summary.counts.changed,1);assert.equal(changed.summary.counts.ok,2);assert.equal(changed.items[0].id,links[2].id);assert.deepEqual(changed.items[0].differs,['body']);assert.match(changed.items[0].next,/Review/);
 const impact=await link('requirements_for',{symbol:'(*Repository).LoadIndex',impact:true,depth:2});const notFollowed=await call('link_result',{jobId:impact.jobId,section:'not_followed'});assert.equal(impact.summary.impactIncomplete,true);assert.ok(notFollowed.items.length);
 const hashes={};for(const path of ['src/architecture/code-links.ts','src/mcp/links.ts','src/mcp/links-worker.ts','src/mcp/links-jobs.ts','src/mcp/links-view.ts','src/mcp/graph-view.ts','src/mcp/graph.ts','src/mcp/graph-jobs.ts','src/mcp/graph-worker.ts','src/mcp/operation-errors.ts','src/mcp/check-findings.ts','src/mcp/server.ts','src/mcp/workspace.ts','src/mcp/limits.ts','docs/mcp.md'])hashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
 await writeFile(join(evidence,'restic-transcript.json'),JSON.stringify(transcript)+'\n');await writeFile(join(evidence,'restic-source-checks.json'),JSON.stringify(checks,null,2)+'\n');
 await writeFile(join(evidence,'restic-summary.json'),JSON.stringify({pin:git('rev-parse','HEAD'),cleanBefore:true,links,checksBefore:clean.summary,checkAfter:changed.summary,changed:changed.items[0],impact:impact.summary,notFollowed:notFollowed.items,calls:transcript.length,bytes:transcript.map(t=>({name:t.name,bytes:t.bytes})),maximumBytes:Math.max(...transcript.map(t=>t.bytes)),sourceHashes:hashes,trackedDiff:git('diff','--stat')},null,2)+'\n');
 console.log('Three MCP links and source checks passed; edit reported changed, never auto-refreshed.');
}finally{await client?.close();await rm(scratch,{recursive:true,force:true});await writeFile(join(evidence,'restic-cleanup.txt'),'MCP client/server closed; unique copied corpus, graph/planning databases and scratch removed in finally.\n');}
