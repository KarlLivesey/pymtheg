import {parentPort} from "node:worker_threads";
parentPort.on("message", message=>{if(message==="unexpected-exit"){parentPort.postMessage({kind:"result",view:{}});process.exit(7);}if(message==="announce-error")parentPort.postMessage({kind:"error",message:"Held error; cleanup not complete"});if(message==="finish"){parentPort.postMessage({kind:"error",message:"Controlled terminal result"});parentPort.close();}});
parentPort.postMessage({kind:"progress",progress:{phase:"controlled-ready",done:0,total:1}});
// Cannot naturally complete: only an explicit finish or worker termination releases it.
