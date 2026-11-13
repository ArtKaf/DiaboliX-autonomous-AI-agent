'use strict';

// Tokenize shell operators separately from quoted/escaped argument text. This is
// a guard against common long-running commands, not a shell security boundary.
function tokenize(command){
 const tokens=[],hereDocuments=[];let word='',started=false,quote=null,hereDelimiter=null;
 const flush=()=>{if(started){tokens.push({word});if(hereDelimiter){hereDocuments.push({delimiter:word,stripTabs:hereDelimiter.stripTabs});hereDelimiter=null}word='';started=false}};
 for(let i=0;i<command.length;i++){
  const c=command[i],next=command[i+1];
  if(quote){if(c===quote){quote=null;continue}if(c==='\\'&&quote==='"'&&next!==undefined&&'\\"$`\n'.includes(next)){word+=next;i++;started=true;continue}word+=c;started=true;continue}
  if(c==='\\'&&next!==undefined){word+=next;i++;started=true;continue}
  if(c==='\''||c==='"'){quote=c;started=true;continue}
  if(c==='#'&&!started){while(i<command.length&&command[i]!=='\n')i++;if(i<command.length)i--;continue}
  if(c==='\n'){
   flush();if(hereDocuments.length){tokens.push({op:';'});let cursor=i+1;
    for(const doc of hereDocuments){while(cursor<command.length){const end=command.indexOf('\n',cursor),line=command.slice(cursor,end<0?command.length:end).replace(/\r$/,'');cursor=end<0?command.length:end+1;if((doc.stripTabs?line.replace(/^\t+/,''):line)===doc.delimiter)break}}
    hereDocuments.length=0;i=cursor-1;continue;
   }
  }
  if(c==='\n'||c===';'||c==='|'||c==='&'){
   flush();if((c==='&'&&next==='&')||(c==='|'&&next==='|')){tokens.push({op:c+next});i++}else if(c==='&'&&next==='>'){tokens.push({op:'redirect'});i++}else tokens.push({op:c==='\n'?';':c});continue;
  }
  if(c==='<'||c==='>'){
   if(started&&/^\d+$/.test(word)){word='';started=false}else flush();if(c==='<'&&next==='<'){i++;const stripTabs=command[i+1]==='-';if(stripTabs)i++;hereDelimiter={stripTabs}}else if(next===c||next==='&'||next==='|')i++;tokens.push({op:'redirect'});continue;
  }
  if(/\s/.test(c)){flush();continue}word+=c;started=true;
 }
 flush();return tokens;
}

function stripJsLiterals(source){
 let result='',quote=null,line=false,block=false;
 for(let i=0;i<source.length;i++){
  const c=source[i],next=source[i+1];
  if(line){if(c==='\n'){line=false;result+='\n'}else result+=' ';continue}
  if(block){if(c==='*'&&next==='/'){result+='  ';i++;block=false}else result+=c==='\n'?'\n':' ';continue}
  if(quote){if(c==='\\'&&next!==undefined){result+='  ';i++;continue}if(c===quote)quote=null;result+=c==='\n'?'\n':' ';continue}
  if(c==='/'&&next==='/'){result+='  ';i++;line=true;continue}if(c==='/'&&next==='*'){result+='  ';i++;block=true;continue}
  if(c==='\''||c==='"'||c==='`'){quote=c;result+=' ';continue}result+=c;
 }
 return result;
}
function inlineNodeServer(source){
 const code=stripJsLiterals(source);
 if(!/\.\s*listen\s*\(/.test(code))return false;
 if(/\b(?:http|https|http2)\s*\.\s*create(?:Secure)?Server\s*\(/.test(code))return true;
 // Detect the common require('node:http').createServer(...) form without
 // treating a mere printed string as executable code.
 return /(?:\brequire\s*\(\s*|\bfrom\s*)['"](?:node:)?https?['"]/.test(source)&&/(?:\brequire\s*\(|\bfrom\b)/.test(code)&&/\bcreateServer\s*\(/.test(code);
}
function inlinePythonServer(source){
 const code=stripJsLiterals(source);
 return /\b(?:uvicorn|hypercorn)\s*\.\s*run\s*\(/.test(code)||/\bhttp\s*\.\s*server\s*\.\s*test\s*\(/.test(code)||/\.\s*serve_forever\s*\(/.test(code)||(/\b(?:from|import)\s+flask\b/i.test(code)&&/\.\s*run\s*\(/.test(code));
}
const basename=value=>value.split('/').pop().toLowerCase();
function isServerCommand(words,depth){
 if(!words.length)return false;
 while(words.length&&/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]))words=words.slice(1);
 if(!words.length)return false;
 let program=basename(words[0]),args=words.slice(1);
 if(program==='env'){while(args.length&&(/^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])||args[0].startsWith('-')))args=args.slice(1);return isServerCommand(args,depth)}
 if(['command','exec'].includes(program))return isServerCommand(args,depth);
 if(['nohup','uvicorn','hypercorn','gunicorn','nodemon'].includes(program))return !args.some(x=>['--help','-h','--version','-V'].includes(x));
 if(program==='vite')return !args.some(x=>['build','--help','-h','--version','-v'].includes(x));
 if(['npm','pnpm','yarn'].includes(program)&&((args[0]==='run'&&args[1]==='dev')||args[0]==='dev'))return true;
 if(['npx','pnpm','yarn'].includes(program)){const i=args.findIndex(x=>!x.startsWith('-'));if(i>=0&&['vite','nodemon','uvicorn'].includes(basename(args[i])))return isServerCommand(args.slice(i),depth)}
 if(program==='flask'&&args.includes('run'))return true;
 if(/^(?:python(?:\d+(?:\.\d+)*)?|pypy(?:\d+)?)$/.test(program)){
  const moduleIndex=args.indexOf('-m');if(moduleIndex>=0){const mod=args[moduleIndex+1];if(['http.server','uvicorn','hypercorn','gunicorn'].includes(mod))return true;if(mod==='flask'&&args.slice(moduleIndex+2).includes('run'))return true}
  const index=args.indexOf('-c');if(index>=0&&args[index+1]&&inlinePythonServer(args[index+1]))return true;
 }
 if(/^(?:node|nodejs)$/.test(program)){const index=args.findIndex(x=>['-e','--eval','-p','--print'].includes(x)||x.startsWith('--eval=')||x.startsWith('--print='));if(index>=0){const inline=args[index].includes('=')?args[index].slice(args[index].indexOf('=')+1):args[index+1];if(inline&&inlineNodeServer(inline))return true}}
 if(['sh','bash','dash','zsh'].includes(program)&&depth<4){const index=args.findIndex(x=>/^-[a-z]*c[a-z]*$/.test(x));if(index>=0&&args[index+1])return blockedCommand(args[index+1],depth+1)}
 return false;
}
function blockedCommand(command,depth=0){
 const tokens=tokenize(command);let words=[],redirect=false;
 for(const token of tokens){
  if(token.op){if(token.op==='redirect'){redirect=true;continue}if(token.op==='&')return true;if(isServerCommand(words,depth))return true;words=[];redirect=false;continue}
  if(redirect){redirect=false;continue}words.push(token.word);
 }
 return isServerCommand(words,depth);
}

// Detect direct package-install commands without interpreting quoted text as shell code.
// Like the server filter, this is an ACI guard, not a complete shell parser.
function installWords(words,depth){
 while(words.length&&/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]))words=words.slice(1);
 if(!words.length)return false;
 const program=basename(words[0]);let args=words.slice(1);
 if(program==='env'){
  while(args.length){if(/^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])||['-i','--ignore-environment','-0','--null'].includes(args[0]))args.shift();else if(['-u','--unset','-C','--chdir'].includes(args[0]))args.splice(0,2);else if(args[0].startsWith('--unset=')||args[0].startsWith('--chdir='))args.shift();else break}
  return installWords(args,depth);
 }
 if(['command','exec'].includes(program)){while(args[0]?.startsWith('-'))args.shift();return installWords(args,depth)}
 if(['sh','bash','dash','zsh'].includes(program)&&depth<4){const index=args.findIndex(x=>/^-[a-z]*c[a-z]*$/.test(x));return index>=0&&typeof args[index+1]==='string'&&isPackageInstall(args[index+1],depth+1)}
 if(/^(?:python(?:\d+(?:\.\d+)*)?|pypy(?:\d+)?)$/.test(program)){
  let i=0;while(i<args.length){if(args[i]==='-m')return /^pip(?:\d+(?:\.\d+)*)?$/.test(args[i+1]||'')&&installWords([args[i+1],...args.slice(i+2)],depth);if(args[i]==='-c'||!args[i].startsWith('-'))return false;if(['-W','-X'].includes(args[i]))i++;i++}return false;
 }
 if(program!=='npm'&&!/^pip(?:\d+(?:\.\d+)*)?$/.test(program))return false;
 if(args.some(x=>['--help','-h','--version','-V'].includes(x)))return false;
 const optionsWithValue=program==='npm'?new Set(['--prefix','--userconfig','--cache','--registry','--workspace','-w']):new Set(['--proxy','--retries','--timeout','--index-url','-i','--extra-index-url','--trusted-host','--cert','--client-cert','--cache-dir','--log']);
 while(args.length&&args[0].startsWith('-')){const flag=args.shift();if(optionsWithValue.has(flag))args.shift()}
 return program==='npm'?['install','i'].includes(args[0]):args[0]==='install';
}
function isPackageInstall(command,depth=0){
 let words=[],redirect=false;
 for(const token of tokenize(command)){
  if(token.op){if(token.op==='redirect'){redirect=true;continue}if(installWords(words,depth))return true;words=[];redirect=false;continue}
  if(redirect){redirect=false;continue}words.push(token.word);
 }
 return installWords(words,depth);
}
module.exports={blockedCommand,tokenize,isPackageInstall};
