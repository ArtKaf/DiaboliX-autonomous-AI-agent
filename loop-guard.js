import crypto from 'node:crypto';
import path from 'node:path';
export function createLoopGuard(){let previous=null;const canonical=v=>v&&typeof v==='object'?(Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]))):v;return (name,args)=>{const key=JSON.stringify([name,canonical(args)]);if(key===previous)return false;previous=key;return true;};}
export function createReviewProgressGuard(limit=3){let previous='',count=0;return ({tree,feedback,answer})=>{const key=JSON.stringify([tree,String(feedback).trim(),String(answer||'').trim()]);if(key===previous)count++;else{previous=key;count=1}return count<limit}}
export function createReadCycleGuard(){const recent=[],progress=createResearchProgressGuard();let warnings=0;return (name,args,result)=>{if(!['list_files','read_file','search_code','parse_ast'].includes(name)){recent.length=0;warnings=0;progress.reset();return 0}if(progress(name,args,result)?.novel)warnings=0;const sorted=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(sorted):Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])]))):value;recent.push(JSON.stringify([name,sorted(args),result]));if(recent.length>9)recent.shift();for(const width of [2,3]){if(recent.length<width*3)continue;const a=recent.slice(-width),b=recent.slice(-width*2,-width),c=recent.slice(-width*3,-width*2);if(JSON.stringify(a)===JSON.stringify(b)&&JSON.stringify(b)===JSON.stringify(c)){recent.length=0;return ++warnings}}return 0}}

// Observe read-only results rather than counting requests. Project contents are
// untrusted data: keep only bounded SHA-256 fingerprints, not source text.
// Older fingerprints are evicted, so this is a loop guard, not an exhaustive
// proof that a very long session never saw a fact before.
const researchObservations=new Set(['list_files','read_file','search_code','parse_ast','code_navigation','module_map','project_state','project_memory','read_task_evidence','parallel_read']);
export function isResearchObservation(name){return researchObservations.has(name)}
const volatileKeys=new Set(['event_id','run_id','source','elapsed_ms','duration_ms','timestamp','started_at','updated_at','next_offset','scanned','notice']);
function stableObservation(value){
 if(Array.isArray(value))return value.map(stableObservation);
 if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())if(!volatileKeys.has(key))out[key]=stableObservation(value[key]);return out}
 return value;
}
function researchPath(value){
 const input=typeof value==='string'&&value?value:'.';const clean=path.posix.normalize(input);return clean==='/workspace'?'.':clean.startsWith('/workspace/')?clean.slice('/workspace/'.length):clean;
}
function researchFacts(name,args,result,failed=false){
 if(failed||typeof result!=='string')return [];
 const text=result.replace(/\r\n/g,'\n'),exit=[...text.matchAll(/(?:^|\n)\[код:\s*([^\]]+)\]/g)].at(-1)?.[1];
 if(/^\s*(?:Ошибка:|Error:)/i.test(text)||exit!==undefined&&exit.trim()!=='0'||/не менялся с прошлого чтения в этой сессии/i.test(text))return [];
 const body=text.replace(/\n\[код:\s*0\]\s*$/,'').replace(/\n+$/,''),file=researchPath(args?.path),fact=(...parts)=>JSON.stringify(parts);let facts=[];
 if(name==='read_file'){
  facts=body.split('\n').map(line=>line.match(/^(\d+): ?(.*)$/)).filter(Boolean).map(match=>fact('line',file,Number(match[1]),match[2]));
  const meta=body.match(/^Всего строк:\s*(\d+)/);if(meta)facts.push(fact('file-length',file,Number(meta[1])));else if(!facts.length&&body.trim())facts.push(fact('read',file,body));
  return facts;
 }
 if(name==='search_code'){
  facts=body.split('\n').map(line=>line.match(/^(.*?):(\d+): ?(.*)$/)).filter(Boolean).map(match=>fact('line',researchPath(match[1]),Number(match[2]),match[3]));
  if(!facts.length&&/^(?:Совпадений не найдено|No matches(?: found)?\.?|\(no matches\))\s*$/i.test(body.trim())){const query=String(args?.query||'');facts.push(fact('no-matches',file,args?.regex===true||args?.case_sensitive===true?query:query.toLowerCase(),args?.regex===true,args?.case_sensitive===true));}
  else if(!facts.length&&body.trim())facts.push(fact('search-result',body));
  return facts;
 }
 if(name==='list_files'){
  facts=body.split('\n').filter(line=>/^[📁📄]/u.test(line)).map(line=>fact('entry',file,line));
  if(!facts.length&&/^(?:\(пусто\)|\(empty\))$/i.test(body.trim()))facts.push(fact('empty-directory',file));
  else if(!facts.length&&body.trim())facts.push(fact('directory-result',file,body));
  return facts;
 }
 let value;try{value=JSON.parse(body)}catch{if(body.trim())return [fact('result',name,body)];return []}
 if(!value||typeof value!=='object')return [fact('result',name,value)];
 if(name==='parallel_read'){
  const results=Array.isArray(value.results)?value.results:[],operations=Array.isArray(args?.operations)?args.operations:[];
  return results.flatMap((item,index)=>{const operation=operations[index],tool=item?.name||operation?.name;if(!researchObservations.has(tool)||tool==='parallel_read')return [];const status=item?.outcome?.status;return researchFacts(tool,operation?.args||{},item?.output,status==='error'||status==='timeout'||status==='failed')});
 }
 const scope=researchPath(value.path||args?.path),groups=['nodes','symbols','imports','matches','locations','references','definitions','diagnostics','errors','modules','files','items','events','post_edit_diagnostics','recent_tool_errors'];
 if(name==='project_memory'&&value.source&&typeof value.source==='object'&&value.source.kind)facts.push(fact('historical-source',stableObservation(value.source)));
 let foundGroup=false;for(const group of groups){if(!Array.isArray(value[group]))continue;foundGroup=true;for(const entry of value[group])facts.push(fact('structured',name,scope,group,stableObservation(entry)))}
 // A known empty result is useful once for the same tool, path and kind. Do
 // not count different query/pagination arguments or volatile event IDs as new.
 if(foundGroup&&!facts.length){const selector=name==='code_navigation'?{action:args?.action,...(args?.query!==undefined?{query:args.query}:{}),...(args?.pattern!==undefined?{pattern:args.pattern}:{}),...(args?.line!==undefined?{line:args.line}:{}),...(args?.column!==undefined?{column:args.column}:{}),...(args?.offset!==undefined?{offset:args.offset}:{})}:null;facts.push(fact('empty-structured',name,scope,groups.filter(key=>Array.isArray(value[key])).sort(),selector))}
 if(name==='project_state')for(const key of ['tests','project_diagnostics'])if(value[key]!==undefined&&value[key]!==null)facts.push(fact('project-status',key,stableObservation(value[key])));
 const meta={};for(const key of ['path','language','hasError','hash','tree','requested_path','changed_files'])if(value[key]!==undefined)meta[key]=stableObservation(value[key]);
 if(Object.keys(meta).length)facts.push(fact('metadata',name,scope,meta));
 if(!facts.length)facts.push(fact('structured-result',name,scope,stableObservation(value)));
 return facts;
}

export function createResearchProgressGuard({warningAfter=3,stopAfter=8,maxFacts=40000}={}){
 if(!Number.isInteger(warningAfter)||warningAfter<1||!Number.isInteger(stopAfter)||stopAfter<warningAfter||!Number.isInteger(maxFacts)||maxFacts<1)throw new TypeError('Invalid research progress guard limits');
 const seen=new Set();let streak=0;
 const guard=(name,args,result,{failed=false}={})=>{
  if(!isResearchObservation(name))return null;
  let novel=false;for(const item of researchFacts(name,args,result,failed)){
   const hash=crypto.createHash('sha256').update(item).digest('hex');if(seen.has(hash))continue;
   novel=true;seen.add(hash);while(seen.size>maxFacts)seen.delete(seen.values().next().value);
  }
  streak=novel?0:streak+1;
  return {novel,streak,warning:streak>=warningAfter,stop:streak>=stopAfter};
 };
 guard.reset=()=>{streak=0};return guard;
}
