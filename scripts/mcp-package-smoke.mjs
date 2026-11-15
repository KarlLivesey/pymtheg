import {Client} from '@modelcontextprotocol/client';import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import assert from 'node:assert/strict';
const packageRoot=resolve(process.argv[2]??'/tmp/pym-rework-package/node_modules/pymtheg');
const project=await mkdtemp(join(tmpdir(),'pym-package-mcp-'));await writeFile(join(project,'main.pym'),'flow main(flag: Bool) -> Unit { assert flag; }');
const client=new Client({name:'package-smoke',version:'1'});const transport=new StdioClientTransport({command:process.execPath,args:[join(packageRoot,'dist/cli/main.js'),'mcp',project],stderr:'pipe'});
try{
 await client.connect(transport);const info=await client.callTool({name:'project_info',arguments:{}});assert.equal(info.structuredContent.tools,undefined);console.log('Installed package reports no external checker status.');
 const checked=await client.callTool({name:'check_design',arguments:{file:'main.pym'}});assert.equal(checked.isError,undefined);
 const scaffold=await client.callTool({name:'emit_scaffold',arguments:{runId:checked.structuredContent.runId}});assert.equal(scaffold.isError,undefined);assert.match(scaffold.structuredContent.source,/function main\(flag: boolean\): void/);console.log('Packaged MCP check and typed empty-body scaffold succeeded.');
 const explored=await client.callTool({name:'explore_behaviour',arguments:{file:'main.pym',entry:'main',method:'simulate',maxSteps:6,maxSamples:100}});assert.equal(explored.isError,undefined,JSON.stringify(explored));assert.ok(explored.structuredContent.results.counterexamples>0);console.log('Packaged MCP simulation found the source assertion counterexample with the built-in simulator.');
}finally{await client.close();await rm(project,{recursive:true,force:true});}
