import {test} from 'node:test';import assert from 'node:assert/strict';import {isLikelyTestCommand} from '../verification-command-policy.js';
test('recognizes common explicit test commands without blocking ordinary scripts',()=>{
 for(const command of ['npm test','npm run test','npm run test:unit','yarn test','pnpm test','python3 -m pytest','/workspace/.venv/bin/python -m unittest','node --test','go test ./...','cargo test','cd src && npm test'])assert.equal(isLikelyTestCommand(command),true,command);
 for(const command of ['node app.js','python3 /workspace/predict.py','npm run build','echo testing','git status'])assert.equal(isLikelyTestCommand(command),false,command);
});
