const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
async function safe(p, missing=false) {
 const base=await fs.realpath('/workspace'), target=path.resolve(base,p||'.');
 if(target!==base&&!target.startsWith(base+'/'))throw Error('Путь находится вне рабочей папки');
 let probe=target; while(true){try{const real=await fs.realpath(probe);if(real!==base&&!real.startsWith(base+'/'))throw Error('Символическая ссылка ведёт за пределы рабочей папки');break}catch(e){if(e.code!=='ENOENT'||!missing)throw e;probe=path.dirname(probe)}} return target;
}
(async()=>{let input='';for await(const chunk of process.stdin)input+=chunk;const {name,args}=JSON.parse(input);
 if(name==='list_files'){const list=await fs.readdir(await safe(args.path),{withFileTypes:true});console.log(list.slice(0,500).map(x=>(x.isDirectory()?'📁 ':'📄 ')+x.name).join('\n')||'(пусто)');}
 else if(name==='project_rules'){let result='';for(const name of ['DIABOLIX.md','.diabolixrules']){try{const p=await safe(name);const data=await fs.readFile(p);result=data.subarray(0,4096).toString('utf8');break}catch(e){if(e.code!=='ENOENT')throw e}}console.log(result);}
 else if(name==='diagnose'){
  const target=await safe(args.path),ext=path.extname(target);let command,argv;
  if(['.js','.mjs','.cjs'].includes(ext)){command=process.execPath;argv=['--check',target]}
  else if(ext==='.json'){try{JSON.parse(await fs.readFile(target,'utf8'));console.log('Синтаксис JSON проверен')}catch(e){console.log('Ошибка JSON: '+e.message);process.exitCode=1}}
  else if(['.ts','.tsx'].includes(ext)){try{await fs.access('/workspace/tsconfig.json');await fs.access('/workspace/node_modules/.bin/tsc');command='/workspace/node_modules/.bin/tsc';argv=['--noEmit','--pretty','false']}catch{console.log('Проверка типов пропущена: отсутствуют tsconfig.json или локальный tsc')}}
  else console.log('Для этого типа файла автоматическая проверка недоступна');
  if(command){const child=spawn(command,argv,{cwd:'/workspace',stdio:'inherit',env:{PATH:process.env.PATH,HOME:'/tmp',TMPDIR:'/tmp'}});child.on('exit',code=>{if(code)process.exitCode=code;else console.log('Проверка пройдена')});child.on('error',e=>{console.error(e.message);process.exitCode=1})}
 }
 else if(name==='hash_file'){const data=await fs.readFile(await safe(args.path));console.log(crypto.createHash('sha256').update(data).digest('hex'));}
 else if(name==='read_file'){
  const text=await fs.readFile(await safe(args.path),'utf8');const lines=text.split('\n');if(lines.at(-1)==='')lines.pop();const start=args.start_line??1,end=args.end_line??(start+249);
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end-start>=250)throw Error('Укажите диапазон от 1 до 250 строк');
  console.log(`Всего строк: ${lines.length}, показано: ${start}–${Math.min(end,lines.length)}\n`+lines.slice(start-1,end).map((l,i)=>`${start+i}: ${l}`).join('\n'));
 }
 else if(name==='search_code'){
  if(typeof args.query!=='string'||!args.query)throw Error('Укажите непустой запрос');let re;try{re=new RegExp(args.regex?args.query:args.query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),args.case_sensitive?'':'i')}catch(e){throw Error('Некорректное регулярное выражение: '+e.message)}
  const root=await safe(args.path||'.'),hits=[];async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(hits.length>=50)break;if(['node_modules','.git'].includes(e.name)||e.isSymbolicLink())continue;const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.isFile()){const st=await fs.stat(p);if(st.size>1000000)continue;const text=await fs.readFile(p,'utf8');if(text.includes('\0'))continue;const lines=text.split('\n');for(let i=0;i<lines.length&&hits.length<50;i++)if(re.test(lines[i]))hits.push(`${path.relative('/workspace',p)}:${i+1}: ${lines[i].slice(0,500)}`)}}}await walk(root);console.log(hits.join('\n')||'Совпадений не найдено');
 }
 else if(name==='write_file'){if(typeof args.content!=='string')throw Error('Содержимое должно быть строкой');const p=await safe(args.path,true);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,args.content,{flag:'wx'});console.log(`Создан файл: ${args.path}`);}
 else if(name==='patch_file'){
  if(typeof args.target_content!=='string'||!args.target_content||typeof args.replacement_content!=='string')throw Error('Укажите непустой исходный блок и строку замены');const p=await safe(args.path);const original=await fs.readFile(p,'utf8');const first=original.indexOf(args.target_content);if(first<0)throw Error('Блок не найден; проверьте пробелы и добавьте окружающие строки');if(original.indexOf(args.target_content,first+1)>=0)throw Error('Блок найден более одного раза; добавьте окружающие строки для уникальности');
  const next=original.slice(0,first)+args.replacement_content+original.slice(first+args.target_content.length);const tmp=path.join(path.dirname(p),'.diabolix-'+crypto.randomUUID());try{await fs.writeFile(tmp,next,{mode:(await fs.stat(p)).mode});await fs.rename(tmp,p)}finally{await fs.rm(tmp,{force:true})};console.log(JSON.stringify({сообщение:'Изменение применено',hash:crypto.createHash('sha256').update(next).digest('hex')}));
 }
 else if(name==='checkpoint_file'){
  const p=await safe(args.path,true);let data;try{data=await fs.readFile(p)}catch(e){if(e.code!=='ENOENT')throw e}
  if(data&&data.length>1000000)throw Error('Файл превышает предел отката 1 МБ');
  console.log(JSON.stringify({exists:!!data,content:data?.toString('base64')||''}));
 }
 else if(name==='rollback_file'){
  const p=await safe(args.path);const now=await fs.readFile(p);const hash=crypto.createHash('sha256').update(now).digest('hex');
  if(hash!==args.expected)throw Error('Конфликт отката: файл изменён после записи агента');
  if(args.exists)await fs.writeFile(p,Buffer.from(args.content,'base64'));else await fs.unlink(p);
  console.log('Откат выполнен: '+args.path);
 }
 else if(name==='survey'){
  const Parser=require('tree-sitter'),js=require('tree-sitter-javascript'),py=require('tree-sitter-python');const files=[];let budget=400000;
  const skip=new Set(['node_modules','.git','dist','build','.next','coverage']);const locks=/^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|Pipfile\.lock|poetry\.lock|uv\.lock|composer\.lock)$/i;
  async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(files.length>=300)break;if(skip.has(e.name)||e.isSymbolicLink())continue;const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.isFile()){const st=await fs.stat(p);if(st.size>200000)continue;const data=await fs.readFile(p);if(data.includes(0))continue;let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data)}catch{continue}const rel=path.relative('/workspace',p),ext=path.extname(p),language=ext==='.py'?py:['.js','.jsx','.mjs','.cjs'].includes(ext)?js:null;let nodes=[];if(language){const parser=new Parser();parser.setLanguage(language);const tree=parser.parse(text);function visit(n){if(nodes.length>=30)return;if(['function_declaration','function_definition','class_declaration','class_definition','method_definition'].includes(n.type)){const nodeName=n.childForFieldName('name')?.text||'';if(nodeName)nodes.push({type:n.type,name:nodeName.slice(0,100),line:n.startPosition.row+1,text:nodeName.slice(0,100)})}if(n.type==='export_statement'){const declaration=n.childForFieldName('declaration');const nodeName=declaration?.childForFieldName('name')?.text;if(nodeName)nodes.push({type:n.type,name:nodeName.slice(0,100),line:n.startPosition.row+1,text:nodeName.slice(0,100)})}for(const c of n.namedChildren)visit(c)}visit(tree.rootNode)}const complete=data.length<=budget;budget-=complete?data.length:0;files.push({path:rel,hash:crypto.createHash('sha256').update(data).digest('hex'),content:complete?text:null,complete,language:ext==='.py'?'python':'javascript',nodes})}}}await walk('/workspace');console.log(JSON.stringify(files));
 }
 else if(name==='parse_ast'){
  const Parser=require('tree-sitter'); const ext=path.extname(args.path||'').toLowerCase();
  const language=ext==='.py'?require('tree-sitter-python'):['.js','.mjs','.cjs','.jsx'].includes(ext)?require('tree-sitter-javascript'):null;
  if(!language)throw Error('Поддерживаются JavaScript, JSX и Python');
  const code=await fs.readFile(await safe(args.path),'utf8'); if(Buffer.byteLength(code)>1000000)throw Error('Файл слишком велик');
  const parser=new Parser();parser.setLanguage(language);const tree=parser.parse(code);const nodes=[];
  function visit(node){if(nodes.length>=300)return; if(['function_declaration','function_definition','class_declaration','class_definition','method_definition','import_statement','import_from_statement','import_declaration'].includes(node.type))nodes.push({type:node.type,name:node.childForFieldName('name')?.text||'',line:node.startPosition.row+1,text:node.text.slice(0,300)}); for(const child of node.namedChildren)visit(child)}
  visit(tree.rootNode);console.log(JSON.stringify({path:args.path,language:ext==='.py'?'python':'javascript',hasError:tree.rootNode.hasError,nodes}));
 }
 else if(name==='run_command' || name==='run_tests'){if(typeof args.command!=='string'||!args.command.trim())throw Error('Команда пуста');if(/(^|[;&|\s])(python\d*\s+-m\s+http\.server|vite|nodemon|npm\s+run\s+dev)(\s|$)|(^|[^&])&(?!&)/i.test(args.command))throw Error('Фоновые процессы и серверы запрещены; используйте одноразовые синхронные проверки');const child=spawn('/bin/sh',['-c',args.command],{cwd:'/workspace',stdio:'inherit',env:{PATH:process.env.PATH,HOME:'/tmp',TMPDIR:'/tmp',LANG:'C.UTF-8'}});child.on('exit',(code,signal)=>process.exit(code??(signal?1:0)));child.on('error',e=>{console.error(e.message);process.exit(1)});}
 else throw Error('Неизвестный инструмент');
})().catch(e=>{console.error(e.message);process.exit(1)});
