const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
async function safe(p, missing=false) {
 const base=await fs.realpath('/workspace'), target=path.resolve(base,p||'.');
 if(target!==base&&!target.startsWith(base+'/'))throw Error('Path outside workspace');
 let probe=target; while(true){try{const real=await fs.realpath(probe);if(real!==base&&!real.startsWith(base+'/'))throw Error('Symlink outside workspace');break}catch(e){if(e.code!=='ENOENT'||!missing)throw e;probe=path.dirname(probe)}} return target;
}
(async()=>{let input='';for await(const chunk of process.stdin)input+=chunk;const {name,args}=JSON.parse(input);
 if(name==='list_files'){const list=await fs.readdir(await safe(args.path),{withFileTypes:true});console.log(list.slice(0,500).map(x=>(x.isDirectory()?'📁 ':'📄 ')+x.name).join('\n')||'(пусто)');}
 else if(name==='read_file'){console.log((await fs.readFile(await safe(args.path),'utf8')).slice(0,24000));}
 else if(name==='write_file'){if(typeof args.content!=='string')throw Error('content must be a string');const p=await safe(args.path,true);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,args.content);console.log(`Записано: ${args.path}`);}
 else if(name==='checkpoint_file'){
  const p=await safe(args.path,true);let data;try{data=await fs.readFile(p)}catch(e){if(e.code!=='ENOENT')throw e}
  if(data&&data.length>1000000)throw Error('File exceeds rollback limit (1 MB)');
  console.log(JSON.stringify({exists:!!data,content:data?.toString('base64')||''}));
 }
 else if(name==='rollback_file'){
  const p=await safe(args.path);const now=await fs.readFile(p);const hash=crypto.createHash('sha256').update(now).digest('hex');
  if(hash!==args.expected)throw Error('Rollback conflict: file changed after the agent write');
  if(args.exists)await fs.writeFile(p,Buffer.from(args.content,'base64'));else await fs.unlink(p);
  console.log('Rollback complete: '+args.path);
 }
 else if(name==='parse_ast'){
  const Parser=require('tree-sitter'); const ext=path.extname(args.path||'').toLowerCase();
  const language=ext==='.py'?require('tree-sitter-python'):['.js','.mjs','.cjs','.jsx'].includes(ext)?require('tree-sitter-javascript'):null;
  if(!language)throw Error('Supported: JavaScript, JSX and Python');
  const code=await fs.readFile(await safe(args.path),'utf8'); if(Buffer.byteLength(code)>1000000)throw Error('File too large');
  const parser=new Parser();parser.setLanguage(language);const tree=parser.parse(code);const nodes=[];
  function visit(node){if(nodes.length>=300)return; if(['function_declaration','function_definition','class_declaration','class_definition','method_definition','import_statement','import_from_statement','import_declaration'].includes(node.type))nodes.push({type:node.type,name:node.childForFieldName('name')?.text||'',line:node.startPosition.row+1,text:node.text.slice(0,300)}); for(const child of node.namedChildren)visit(child)}
  visit(tree.rootNode);console.log(JSON.stringify({path:args.path,language:ext==='.py'?'python':'javascript',hasError:tree.rootNode.hasError,nodes}));
 }
 else if(name==='run_command' || name==='run_tests'){if(typeof args.command!=='string'||!args.command.trim())throw Error('Empty command');const child=spawn('/bin/sh',['-c',args.command],{cwd:'/workspace',stdio:'inherit',env:{PATH:process.env.PATH,HOME:'/tmp',TMPDIR:'/tmp',LANG:'C.UTF-8'}});child.on('exit',(code,signal)=>process.exit(code??(signal?1:0)));child.on('error',e=>{console.error(e.message);process.exit(1)});}
 else throw Error('Unknown tool');
})().catch(e=>{console.error(e.message);process.exit(1)});
