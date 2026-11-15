import {parentPort} from "node:worker_threads";
parentPort.on("message", message=>{if(message==="complete"){
const symbol={id:"symbol:"+"a".repeat(64),name:"Ready",identity:"Ready",kind:"function",module:"go",file:"a.go",range:{start:0,end:1},status:"clean",line:1,column:1,endLine:1,endColumn:2};
parentPort.postMessage({kind:"result",view:{tables:{answer:[{...symbol,ref:symbol.id,type:"match",at:"a.go:1:1"}],symbols:[],links:[],possible_callers:[],failed_files:[]},summary:{status:"ok",truncated:false},details:new Map()}});parentPort.close();return;}
if(message==="unexpected-exit"){parentPort.postMessage({kind:"result",view:{}});process.exit(7);}if(message==="announce-error")parentPort.postMessage({kind:"error",message:"Held error; cleanup not complete"});if(message==="finish"){parentPort.postMessage({kind:"error",message:"Controlled terminal result"});parentPort.close();}});
parentPort.postMessage({kind:"progress",progress:{phase:"controlled-ready",done:0,total:1}});
// Cannot naturally complete: only an explicit finish or worker termination releases it.
