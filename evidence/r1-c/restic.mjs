// Foreground dev-server only. Uses MCP for all graph questions, source reads only as independent checks.
import assert from "node:assert/strict";
import {cp,mkdtemp,rm,readFile,writeFile,mkdir} from "node:fs/promises";
import {join,resolve} from "node:path";
import {homedir} from "node:os";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {Client} from "@modelcontextprotocol/client";
import {StdioClientTransport} from "@modelcontextprotocol/client/stdio";
const evidence=resolve(process.env.R1C_EVIDENCE ?? "evidence/r1-c");await mkdir(evidence,{recursive:true});
const scratch=await mkdtemp(join(process.env.PYM_SCRATCH,"r1c-restic-"));const root=join(scratch,"restic");
const transcript=[];const questions=[];let client;
const git=(...args)=>{const r=spawnSync("git",args,{encoding:"utf8"});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
try {
 await cp(join(homedir(),"pymtheg-dev/corpora/restic"),root,{recursive:true});
 assert.equal(spawnSync("chmod",["-R","u+w",root]).status,0);
 assert.equal(git("-C",root,"rev-parse","HEAD"),"c734245fd3ae9bcac8ab3aaafb4482d4b5d0ae92");assert.equal(git("-C",root,"status","--porcelain"),"");
 const transport=new StdioClientTransport({command:process.execPath,args:[resolve("dist/cli/main.js"),"mcp",root],env:{...process.env},stderr:"pipe"});
 client=new Client({name:"restic-agent",version:"1"});await client.connect(transport);
 async function call(name,args) {
  const response=await client.callTool({name,arguments:args},{timeout:3600000});
  assert.equal(response.isError,undefined,JSON.stringify(response));
  const bytes=Buffer.byteLength(JSON.stringify(response));assert.ok(bytes<=65536);
  const body=response.structuredContent;transcript.push({name,args,bytes,result:body});return body;
 }
 async function question(label,action,query,extra={}) {
  console.log(label);const offset=transcript.length;
  const first=await call("code_graph",{action,...(query!==undefined?{query}:{}),...extra});
  const answer=first.state === "running" ? await call("graph_result",{jobId:first.jobId,section:extra.section??"answer",limit:extra.limit??20,wait:true}) : first;
  assert.equal(answer.state,"complete");assert.equal(answer.summary.failedFileCount,0);assert.equal(answer.summary.sync.complete,true);
  if(action!=="index")assert.equal(answer.summary.sync.mode,"unchanged");
  questions.push({label,action,calls:transcript.length-offset,inline:first.state==="complete",responseBytes:transcript.slice(offset).map(t=>t.bytes),totalBytes:transcript.slice(offset).reduce((n,t)=>n+t.bytes,0)});
  return answer;
 }
 await question("Explicit cold index","index",undefined,{wait:false});
 const search=await question("1. Where is ParseID declared?","search","ParseID");const definition=search.items.find(s=>s.name==="ParseID");assert.ok(definition);
 const incoming=await question("2. Which call sites call ParseID?","callers",definition.ref,{section:"links",limit:100});
 const caller=incoming.items.find(l=>l.file==="internal/data/snapshot_find.go"&&l.line===98);assert.ok(caller);assert.equal(caller.certainty,"definite");
 const outgoing=await question("3. What does ParseID call?","callees",definition.ref,{section:"links"});const hex=outgoing.items.find(l=>l.targetName==="hex.DecodeString");assert.ok(hex);assert.equal(hex.certainty,"unresolved");
 const hints=await question("4. Are there possible callers of SaverUnpacked.SaveUnpacked?","callers","SaverUnpacked.SaveUnpacked",{section:"possible_callers"});assert.equal(hints.summary.query.hasPossibleCallers,true);
 assert.equal(hints.total,2);assert.ok(hints.items.every(l=>l.certainty==="unresolved"));
 const impact=await question("5. What could a ParseID change affect within two call levels?","impact",definition.ref,{depth:2,limit:20});assert.equal(impact.summary.query.depth,2);assert.equal(impact.summary.truncated,true);
 const checks=[];for(const [name,file,line,needle] of [["definition","internal/restic/id.go",21,"func ParseID"],["caller","internal/data/snapshot_find.go",98,"restic.ParseID"],["callee","internal/restic/id.go",26,"hex.DecodeString"]]) {
  const lines=(await readFile(join(root,file),"utf8")).split("\n");assert.ok(lines[line-1].includes(needle));checks.push({name,file,line,excerpt:lines.slice(line-2,line+2).join("\n")});
 }
 assert.equal(definition.at,"internal/restic/id.go:21:1");assert.equal(hex.line,26);
 const hashes={};for(const path of ["src/mcp/graph.ts","src/mcp/graph-wait.ts","src/mcp/graph-jobs.ts","src/mcp/graph-view.ts","src/mcp/graph-worker.ts","src/mcp/limits.ts","src/mcp/server.ts","src/mcp/workspace.ts","docs/mcp.md"])
  hashes[path]=createHash("sha256").update(await readFile(path)).digest("hex");
 await writeFile(join(evidence,"restic-manifest.json"),JSON.stringify({commit:git("-C",root,"rev-parse","HEAD"),cleanBefore:true,shallow:git("-C",root,"rev-parse","--is-shallow-repository"),hashes},null,2)+"\n");
 await writeFile(join(evidence,"restic-transcript.json"),JSON.stringify(transcript)+"\n");
 await writeFile(join(evidence,"restic-source-checks.json"),JSON.stringify(checks,null,2)+"\n");
 await writeFile(join(evidence,"restic-summary.json"),JSON.stringify({questions:5,callsPerQuestion:questions,toolCalls:transcript.length,responseBytes:transcript.map(t=>({name:t.name,bytes:t.bytes})),maximumResponseBytes:Math.max(...transcript.map(t=>t.bytes)),counts:search.summary.counts,sourceChecks:checks.map(c=>({file:c.file,line:c.line})),possibleCallerCount:hints.total,impactTruncated:impact.summary.truncated},null,2)+"\n");
 assert.equal(git("-C",root,"status","--porcelain"),"");console.log("Five questions and three source checks passed");
} finally {await client?.close();await rm(scratch,{recursive:true,force:true});await writeFile(join(evidence,"restic-cleanup.txt"),"MCP client/server closed; copied pinned corpus, graph database and unique scratch removed in finally.\n");}
