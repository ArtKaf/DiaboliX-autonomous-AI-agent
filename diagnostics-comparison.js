// Compare actual observations, without attributing a newly observed issue to an edit.
export function compareDiagnostics(previous,current){
 if(!previous)return {available:false,notice:'No earlier diagnostic observation is available.'};
 const key=p=>JSON.stringify([p.path||'',p.source||'',String(p.message||'').trim()]);
 const old=new Map((previous.problems||[]).map(p=>[key(p),p])),now=new Map((current.problems||[]).map(p=>[key(p),p]));
 const oldChecked=new Set((previous.checked||[]).map(x=>x.path)),newChecked=new Set((current.checked||[]).map(x=>x.path));
 const comparable=p=>p.path?oldChecked.has(p.path)&&newChecked.has(p.path):p.source==='typescript'&&previous.typecheck!=='not_available'&&current.typecheck!=='not_available';
 const list=(entries,predicate)=>[...entries].filter(([k,p])=>comparable(p)&&predicate(k)).map(([,p])=>p);
 const unknown=[...now.values()].filter(p=>!comparable(p));
 return {available:true,previous_tree:previous.tree||null,current_tree:current.tree||null,persisting:list(now,k=>old.has(k)),newly_observed:list(now,k=>!old.has(k)),no_longer_observed:list(old,k=>!now.has(k)),not_comparable:unknown,notice:'Exact diagnostic messages are compared only for checks run in both observations; newly observed does not prove the edit caused the issue. Skipped, truncated and unexamined files may contain other problems.'};
}
