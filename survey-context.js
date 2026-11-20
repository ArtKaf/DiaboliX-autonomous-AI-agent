// Turn the initial, bounded sandbox survey into ranking hints only. No source
// text, import specifiers or symbol names leave this module. The survey is a
// historical, partial observation, never evidence of the current workspace.
import path from 'node:path';

const WORD=/[\p{L}\p{N}_$]+/gu;
const COMMON=new Set(['the','and','for','from','with','this','that','into','using','use','fix','file','files','code','project','please','function','class','для','это','как','код','файл','файлы','проект','пожалуйста']);
const MAX_FILES=300,MAX_SOURCE=200000,MAX_TOTAL_SOURCE=400000,MAX_WORDS=16000,MAX_IMPORTS=40;
const cache=new WeakMap();

function words(value,max=40){
 const expanded=String(value||'').replace(/([\p{Ll}\d])([\p{Lu}])/gu,'$1 $2').toLowerCase();const terms=[];
 for(const raw of expanded.match(WORD)||[]){for(const term of raw.split(/[_$]+/)){if(term.length>=3&&term.length<=100&&!COMMON.has(term))terms.push(term);if(terms.length>=max)return [...new Set(terms)];}}
 return [...new Set(terms)];
}
function safeRelative(value){
 if(typeof value!=='string'||!value||value.includes('\0')||value.includes('\\')||path.posix.isAbsolute(value))return null;
 const clean=path.posix.normalize(value);return clean==='.'||clean==='..'||clean.startsWith('../')?null:clean;
}
function imports(text,file){
 const found=[],push=(spec,kind)=>{if(found.length<MAX_IMPORTS&&typeof spec==='string'&&spec.length<=200)found.push({spec,kind})};
 // These are syntactic hints only. They may contain false positives from
 // comments/strings and deliberately do not claim semantic module resolution.
 const js=/(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*)["']([^"'\r\n]+)["']/g;let m;
 while(found.length<MAX_IMPORTS&&(m=js.exec(text)))push(m[1],'js');
 if(/\.pyi?$/i.test(file)){const py=/^\s*(?:from\s+([\w.]+)\s+import\b|import\s+([\w.]+))/gm;while(found.length<MAX_IMPORTS&&(m=py.exec(text)))push(m[1]||m[2],'python');}
 return found;
}
function candidates(file,{spec,kind}){
 if(kind==='js'){
  if(!spec.startsWith('./')&&!spec.startsWith('../'))return [];
  const target=safeRelative(path.posix.join(path.posix.dirname(file),spec));if(!target)return [];
  const suffix=path.posix.extname(target),out=[target];
  if(!suffix){for(const ext of ['.js','.jsx','.ts','.tsx','.mjs','.cjs','.py','.json'])out.push(target+ext);for(const ext of ['.js','.jsx','.ts','.tsx','.mjs','.cjs'])out.push(path.posix.join(target,'index'+ext));}
  else if(['.js','.jsx','.mjs','.cjs'].includes(suffix))for(const ext of ['.ts','.tsx','.mts','.cts'])out.push(target.slice(0,-suffix.length)+ext);
  return out;
 }
 if(kind==='python'&&/^[A-Za-z_][\w.]*$/.test(spec)){const p=spec.replaceAll('.','/');return [p+'.py',p+'.pyi',p+'/__init__.py'];}
 return [];
}
function build(survey){
 const files=new Map();for(const file of survey.slice(0,MAX_FILES)){const rel=safeRelative(file?.path);if(rel&&!files.has(rel))files.set(rel,file);}
 return {files,analysed:new Map(),remaining:MAX_TOTAL_SOURCE};
}
function indexed(survey){let result=cache.get(survey);if(!result){result=build(survey);cache.set(survey,result);}return result;}
// Examine content only after Shadow Git's current inventory has admitted the
// path: the startup survey can include paths that the snapshot excludes.
function analyse(index,rel){
 if(index.analysed.has(rel))return index.analysed.get(rel);
 const file=index.files.get(rel);if(!file)return null;
 const symbols=Array.isArray(file.nodes)?file.nodes.slice(0,30).flatMap(node=>words(typeof node?.name==='string'?node.name:'',20)):[];
 const text=typeof file.content==='string'?file.content.slice(0,Math.min(MAX_SOURCE,index.remaining)):'';index.remaining-=text.length;
 const links=new Set();for(const ref of imports(text,rel))for(const candidate of candidates(rel,ref))if(index.files.has(candidate)&&candidate!==rel){links.add(candidate);break;}
 const data={symbolWords:new Set(symbols),contentWords:new Set(words(text,MAX_WORDS)),links};index.analysed.set(rel,data);return data;
}
/** Returns bounded rank hints. Never use as proof, and ignore changed files' survey content. */
export function surveyRanks(survey,task,inventory,changed){
 if(!Array.isArray(survey)||!survey.length)return new Map();const terms=words(task,40);if(!terms.length&&!changed.length)return new Map();
 const index=indexed(survey),eligible=new Map(inventory.filter(x=>x&&typeof x.path==='string').map(x=>[x.path,x]));const ranks=new Map(),seeds=new Set(changed.filter(x=>x&&x.status!=='D').map(x=>x.path));for(const x of changed)if(x&&x.status!=='D'&&!eligible.has(x.path))eligible.set(x.path,x);
 for(const [rel,current] of eligible){if(!current||current.status!=='unchanged')continue;const data=analyse(index,rel);if(!data)continue;
  let symbol=0,content=0;for(const term of terms){if([...data.symbolWords].some(word=>word.includes(term)))symbol++;if(data.contentWords.has(term))content++;}if(terms.some(term=>rel.toLowerCase().includes(term)))seeds.add(rel);
  const score=Math.min(20,symbol*6)+Math.min(8,content*2);if(score){ranks.set(rel,score);seeds.add(rel);}
 }
 for(const [from,source] of eligible){
  if(!source||source.status!=='unchanged')continue;const data=analyse(index,from);if(!data)continue;
  for(const target of data.links){const dest=eligible.get(target);if(!dest||dest.status==='D')continue;
   if(seeds.has(from))ranks.set(target,(ranks.get(target)||0)+3);
   if(seeds.has(target))ranks.set(from,(ranks.get(from)||0)+3);
  }
 }
 return ranks;
}
