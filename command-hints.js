import shell from './sandbox/command-filter.cjs';

const hint='Подсказка: в обычной песочнице отключён прямой интернет. Для установки npm и pip пакетов используй специальный инструмент install_dependencies';

function isInstall(words){
 while(words.length&&/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]))words=words.slice(1);
 if(words[0]==='env'){words=words.slice(1);while(words.length&&(/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])||words[0].startsWith('-')))words=words.slice(1)}
 if(!words.length)return false;
 const program=words[0].split('/').pop().toLowerCase(),args=words.slice(1);
 if(program==='npm')return ['install','i'].includes(args[0]);
 if(['yarn','pnpm'].includes(program))return args[0]==='add';
 if(/^pip(?:\d+(?:\.\d+)*)?$/.test(program))return args[0]==='install';
 if(/^(?:python(?:\d+(?:\.\d+)*)?|pypy(?:\d+)?)$/.test(program))return args[0]==='-m'&&/^pip(?:\d+(?:\.\d+)*)?$/.test(args[1]||'')&&args[2]==='install';
 return false;
}
export function installFailureHint(name,args,{code,timedOut,output}){
 if(name!=='run_command'||typeof args?.command!=='string'||(!timedOut&&code===0)||(!timedOut&&!/\b(?:ENOTFOUND|EAI_AGAIN)\b|could not resolve/i.test(output)))return '';
 let words=[],redirect=false;for(const token of shell.tokenize(args.command)){
  if(token.op){if(token.op==='redirect'){redirect=true;continue}if(isInstall(words))return hint;words=[];redirect=false;continue}
  if(redirect){redirect=false;continue}words.push(token.word);
 }
 return isInstall(words)?hint:'';
}
