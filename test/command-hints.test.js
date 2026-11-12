import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installFailureHint} from '../command-hints.js';
test('installation hints only accompany network errors or timeouts on install commands',()=>{
 const network={code:1,timedOut:false,output:'npm ERR! getaddrinfo EAI_AGAIN registry.npmjs.org'};
 for(const command of ['npm install foo','npm i foo','yarn add foo','pnpm add foo','pip install numpy','.venv/bin/pip3 install numpy','python3 -m pip install numpy','cd app && npm install'])assert.match(installFailureHint('run_command',{command},network),/install_dependencies/,command);
 assert.match(installFailureHint('run_command',{command:'npm i x'},{code:null,timedOut:true,output:''}),/install_dependencies/);
 for(const [name,command,result] of [['run_command','npm i x',{...network,code:0}],['run_command','npm i x',{...network,output:'invalid package.json'}],['run_command','echo "npm install"',network],['run_command','node build.js',network],['run_tests','npm i x',network]])assert.equal(installFailureHint(name,{command},result),'');
});
