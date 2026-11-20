// Promote only bounded index hints that match an exact Shadow Git snapshot.
// This does not prove the snapshot is still current or that relationships in
// the index are semantically correct. No source contents are returned.
const MAX_CANDIDATES=20;
const validPath=value=>typeof value==='string'&&value.length>0&&value.length<=500&&!value.includes('\0')&&!value.includes('\\')&&!value.startsWith('/')&&!value.split('/').some(part=>!part||part==='.'||part==='..'||part.startsWith('.'));
const hashPattern=/^[a-f0-9]{64}$/;
const treePattern=/^[a-f0-9]{40,64}$/;
const notice='Navigation hints only, not evidence. Paths and content hashes matched the provided Shadow Git snapshot only; recheck current files before acting. Ranking and import relations remain approximate, and excluded files are not represented.';

export async function verifyIndexHints({hints,shadow,tree,limit=MAX_CANDIDATES,signal,timeoutMs=5000}={}){
 if(!Number.isInteger(limit)||limit<0||limit>MAX_CANDIDATES)throw new TypeError('Invalid index verification limit.');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new TypeError('Invalid index verification timeout.');
 if(signal?.aborted)throw signal.reason||new DOMException('Index verification cancelled','AbortError');
 const candidates=Array.isArray(hints?.files)?hints.files:[];
 const result={files:[],partial:!!hints?.partial||candidates.length>limit,notice};
 if(!treePattern.test(tree||'')||!shadow||typeof shadow.hashFileAtTree!=='function'){result.partial=true;return result;}
 const controller=new AbortController();const forward=()=>controller.abort(signal.reason||new DOMException('Index verification cancelled','AbortError'));
 signal?.addEventListener('abort',forward,{once:true});if(signal?.aborted)forward();
 const timer=setTimeout(()=>controller.abort(new DOMException('Index verification deadline exceeded','TimeoutError')),timeoutMs);
 const bounded=operation=>new Promise((resolve,reject)=>{
  if(controller.signal.aborted)return reject(controller.signal.reason);
  const cleanup=()=>controller.signal.removeEventListener('abort',onAbort);
  const onAbort=()=>{cleanup();reject(controller.signal.reason)};
  controller.signal.addEventListener('abort',onAbort,{once:true});
  Promise.resolve().then(operation).then(value=>{cleanup();resolve(value)},error=>{cleanup();reject(error)});
 });
 try{
  const seen=new Set();
  for(const item of candidates.slice(0,limit)){
   if(controller.signal.aborted){if(signal?.aborted)throw signal.reason||new DOMException('Index verification cancelled','AbortError');result.partial=true;break}
   if(!item||!validPath(item.path)||!hashPattern.test(item.hash||'')||!Number.isFinite(item.score)||item.score<=0||seen.has(item.path)){result.partial=true;continue;}
   seen.add(item.path);
   try{
    const hash=await bounded(()=>shadow.hashFileAtTree(item.path,tree,{signal:controller.signal}));
    if(hash!==item.hash){result.partial=true;continue;}
    result.files.push({path:item.path,score:Math.min(30,item.score),hash});
   }catch(error){if(signal?.aborted)throw signal.reason||error;result.partial=true;if(controller.signal.aborted)break;}
  }
  return result;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',forward);controller.abort();}
}
