import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {blockedCommand}=createRequire(import.meta.url)('../sandbox/command-filter.cjs');

test('one-shot Python and Node CLI commands, redirection and quoted ampersands are allowed',()=>{
 for(const command of [
  '/workspace/.venv/bin/python /workspace/predict.py --allow-paper',
  '/workspace/.venv/bin/python /workspace/predict.py --allow-paper 2>&1',
  'python3 -c "print(42)"',
  'python3 -c "print(\'a & b\')" 2>&1',
  'node -e "console.log(\'http.createServer & vite\')"',
  'node -e "const http=require(\'http\'); console.log(typeof http.createServer())"',
  'node --check src/server.js && python3 -c "print(1)"',
  'printf "%s" "uvicorn & flask run"',
  'echo \\&',
  'npm run build',
  'vite build',
  'uvicorn --version',
  'python3 -c "import http.server; print(\'not starting a server\')"',
  "python3 - <<'PY'\na = 1 & 2\nprint(a)\nPY",
  "python3 - <<'PY' # ordinary bitwise expression\na = 1 & 2\nprint(a)\nPY",
 ])assert.equal(blockedCommand(command),false,command);
});
test('background shell operators and known server invocations are blocked',()=>{
 for(const command of [
  'python3 /workspace/predict.py &',
  'python3 /workspace/predict.py >/tmp/out 2>&1 &',
  'echo ok & echo later',
  'python3 -m http.server 8080',
  '/workspace/.venv/bin/python -m uvicorn app:app',
  'uvicorn app:app --host 0.0.0.0',
  'flask --app app run',
  'python3 -m flask --app app run',
  'nohup python3 task.py',
  'npm run dev',
  'npx vite',
  'sh -c "python3 -m http.server 8000"',
  'python3 -c "import uvicorn; uvicorn.run(app)"',
  'python3 -c "import http.server; http.server.test()"',
  'node -e "const http = require(\'http\'); http.createServer(() => {}).listen(8080)"',
  'node -e "require(\'node:http\').createServer(() => {}).listen(8080)"',
  'node -e "const {createServer}=require(\'http\'); createServer(() => {}).listen(8080)"',
 ])assert.equal(blockedCommand(command),true,command);
});
