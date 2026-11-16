// SPDX-License-Identifier: MIT
import {spawnSync} from 'node:child_process';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';import assert from 'node:assert/strict';
const root=resolve(process.argv[2]??'/tmp/pym-production-1/node_modules/pymtheg');
const child=spawnSync(process.execPath,[resolve(root,'dist/cli/main.js'),'check',resolve(root,'examples/mvp/library.pym'),'--format','json'],{encoding:'utf8'});
assert.ifError(child.error);assert.equal(child.status,0,child.stdout);const report=JSON.parse(child.stdout);assert.equal(report.diagnostics.length,0);assert.ok(report.results.length);console.log('Production-only CLI: library model checked, valid JSON with '+report.results.length+' results.');
const {startStudio}=await import(pathToFileURL(resolve(root,'dist/studio/server.js')).href);
const app=await startStudio({path:resolve(root,'examples/mvp/library.pym')});try{const response=await fetch(app.url);assert.equal(response.status,200);assert.match(await response.text(),/<script/);const project=await app.service.project();assert.equal(project.defaultFile,'library.pym');assert.equal(project.tools,undefined);console.log('Production-only Studio: HTML served, source project loaded, no external checker status reported.');}finally{await app.close();}
