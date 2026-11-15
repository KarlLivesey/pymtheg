import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { resolve } from "node:path";
export async function connect(root) {
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve("dist/cli/main.js"),"mcp",root],env:{...process.env},stderr:"pipe"});
  let stderr="";transport.stderr?.on("data",b=>{stderr+=b;});
  const client=new Client({name:"r1c-agent",version:"1"});await client.connect(transport);
  const log=[];
  async function raw(name,args={}) {
    const result=await client.callTool({name,arguments:args},{timeout:120000});
    let body=result.structuredContent; if(!body) {try{body=JSON.parse(result.content[0].text);}catch{body={error:{message:result.content[0].text}};}}
    log.push({name,args,bytes:Buffer.byteLength(JSON.stringify(result)),body,isError:result.isError??false});
    return {result,body};
  }
  const call=async(name,args={})=>{const {result,body}=await raw(name,args);if(result.isError)throw Error(JSON.stringify(body));return body;};
  async function graph(action,query,extra={}) {
    const job=await call("code_graph",{action,...(query!==undefined?{query}:{}),...extra});
    const answer=await call("graph_result",{jobId:job.jobId,wait:true});
    return {jobId:job.jobId,answer,page:(section,extra={})=>call("graph_result",{jobId:job.jobId,section,...extra})};
  }
  return {client,call,raw,graph,log,stderr:()=>stderr,close:()=>client.close()};
}
