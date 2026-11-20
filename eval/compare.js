import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const roles=['planner','worker','reviewer'];
const nonnegative=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const sum=(items)=>items.reduce((total,value)=>total+value,0);
const percentile=(numbers,p)=>{if(!numbers.length)return null;const sorted=[...numbers].sort((a,b)=>a-b);return Math.round(sorted[Math.max(0,Math.ceil(sorted.length*p)-1)])};
const entries=result=>roles.map(role=>result.usage?.[role]).filter(item=>item&&typeof item==='object');
const used=item=>['prompt','completion','requests','elapsed_ms'].some(key=>nonnegative(item[key])&&item[key]>0);

export function summarize(report){
 const results=Array.isArray(report?.results)?report.results.map(r=>r&&typeof r==='object'?r:{id:'[invalid]',status:'unknown'}):[],durations=results.map(r=>r.duration_ms).filter(nonnegative),withUsage=results.filter(r=>entries(r).length),perCase=Object.create(null),failureCounts=Object.create(null),toolErrors=Object.create(null);
 for(const r of results){const item=perCase[r.id]??={attempts:0,passed:0,timeouts:0};item.attempts++;if(r.status==='passed')item.passed++;else failureCounts[String(r.status||'unknown')]=(failureCounts[String(r.status||'unknown')]||0)+1;if(r.status==='timeout')item.timeouts++;for(const event of Array.isArray(r.events)?r.events:[])if(event?.type==='tool_result'&&['error','timeout'].includes(event.outcome?.status)){const key=String(event.name||'unknown').slice(0,100);toolErrors[key]??={error:0,timeout:0};toolErrors[key][event.outcome.status]++}}
 const total=(role,key)=>sum(results.map(r=>r.usage?.[role]?.[key]).filter(nonnegative));
 const roleUsage=withUsage.length?Object.fromEntries(roles.map(role=>[role,{prompt:total(role,'prompt'),cached:total(role,'cached'),completion:total(role,'completion'),requests:total(role,'requests'),elapsed_ms:total(role,'elapsed_ms') }])):null;
 const costs=new Map();let costCases=0,mixedCost=false;for(const result of results){let haveCost=false;for(const role of entries(result)){if(role.provider_cost_mixed)mixedCost=true;if(nonnegative(role.provider_cost)){haveCost=true;const currency=typeof role.provider_currency==='string'&&role.provider_currency.trim()?role.provider_currency.trim().slice(0,20):'unspecified';costs.set(currency,(costs.get(currency)||0)+role.provider_cost)}}if(haveCost)costCases++}
 const incompleteCost=mixedCost||results.some(result=>!entries(result).some(item=>nonnegative(item.provider_cost))||entries(result).some(item=>used(item)&&!nonnegative(item.provider_cost)));
 return {model:report?.model,engine:report?.engine||report?.execution_mode||'unknown',cases:results.map(r=>r.id).sort(),fixture_hashes:results.map(r=>({id:r.id,hash:r.fixture_hash||null})).sort((a,b)=>a.id.localeCompare(b.id)),passed:results.filter(r=>r.status==='passed').length,total:results.length,timeouts:results.filter(r=>r.status==='timeout').length,failures_by_status:{...failureCounts},mean_duration_ms:durations.length?Math.round(sum(durations)/durations.length):null,p50_duration_ms:percentile(durations,0.50),p95_duration_ms:percentile(durations,0.95),duration_samples:durations.length,usage_cases:withUsage.length,prompt_tokens:withUsage.length?roles.reduce((s,r)=>s+total(r,'prompt'),0):null,cached_tokens:withUsage.length?roles.reduce((s,r)=>s+total(r,'cached'),0):null,completion_tokens:withUsage.length?roles.reduce((s,r)=>s+total(r,'completion'),0):null,role_usage:roleUsage,provider_cost:{reported_by_currency:Object.fromEntries([...costs.entries()].sort()),cases_with_reported_cost:costCases,incomplete:incompleteCost,notice:'Provider-reported values only; missing data and mixed currencies are not estimated.'},tool_calls:sum(results.map(r=>r.tool_calls).filter(nonnegative)),tool_errors_by_name:{...toolErrors},unrequested_test_calls:sum(results.map(r=>r.unrequested_test_calls).filter(nonnegative)),per_case:{...perCase}};
}

function known(value){return value!==null&&value!==undefined&&value!==''}
const conditions=['model','model_revision','endpoint_sha256','timeout_ms','repeats','max_steps','profile','mcp','computer','network','node','platform','architecture','kernel','host_cpu_model','host_cpu_count','host_memory_bytes','sandbox_engine_version','sandbox_image_id'];
function validateReport(report){
 const m=report?.manifest,reasons=[];if(!m||m.version!==1||m.kind!=='synthetic-coding-fixtures'||!Array.isArray(m.fixtures)||!m.conditions||typeof m.conditions!=='object'||!m.harness)return ['missing or unsupported evaluation manifest'];
 if(!m.fixtures.length||m.fixtures.some(x=>typeof x?.id!=='string'||!/^[a-f0-9]{64}$/.test(x?.sha256||''))||new Set(m.fixtures.map(x=>x.id)).size!==m.fixtures.length)return ['invalid or missing fixture fingerprints'];
 for(const key of conditions)if(!known(m.conditions[key]))reasons.push('unknown condition: '+key);
 if(report.model!==m.conditions.model)reasons.push('report model differs from manifest');
 if(!/^[a-f0-9]{64}$/.test(m.conditions.endpoint_sha256||''))reasons.push('invalid endpoint fingerprint');
 if(!/^sha256:[a-f0-9]{64}$/.test(m.conditions.sandbox_image_id||''))reasons.push('invalid sandbox image fingerprint');
 for(const key of ['timeout_ms','repeats','max_steps','host_cpu_count','host_memory_bytes'])if(!Number.isSafeInteger(m.conditions[key])||m.conditions[key]<=0)reasons.push('invalid condition: '+key);
 if(!/^[a-f0-9]{64}$/.test(m.harness.source_sha256||''))reasons.push('unknown harness source fingerprint');
 if(typeof m.harness.fingerprint_scope!=='string'||!m.harness.fingerprint_scope)reasons.push('unknown source fingerprint scope');
 if(m.harness.source_changed_during_run!==false)reasons.push('harness source changed during the run or was not checked');
 const results=Array.isArray(report.results)?report.results:[],repeats=m.conditions.repeats,expected=m.fixtures.length*repeats,seen=new Set();if(!Number.isInteger(repeats)||repeats<1||results.length!==expected)reasons.push('incomplete attempts');
 const fixtures=new Map(m.fixtures.map(x=>[x.id,x.sha256]));for(const r of results){if(!r||typeof r!=='object'){reasons.push('invalid attempt');break}const key=JSON.stringify([r.id,r.attempt]);if(!fixtures.has(r.id)||fixtures.get(r.id)!==r.fixture_hash||!Number.isInteger(r.attempt)||r.attempt<1||r.attempt>repeats||seen.has(key)){reasons.push('invalid, duplicated or mismatched attempt');break}seen.add(key)}
 return reasons;
}

// Describes whether recorded controls match. It cannot prove that two external
// providers actually served identical weights, or remove stochastic variation.
export function compareReports(reports){
 if(!Array.isArray(reports)||reports.length<2)throw Error('At least two reports are required.');
 const summaries=reports.map(summarize),reasons=[];reports.forEach((report,index)=>{for(const issue of validateReport(report))reasons.push(`report ${index+1}: ${issue}`)});
 const baseline=reports[0]?.manifest;if(baseline?.conditions)for(let i=1;i<reports.length;i++){const current=reports[i]?.manifest;if(!current?.conditions)continue;if(known(baseline.harness?.fingerprint_scope)&&known(current.harness?.fingerprint_scope)&&baseline.harness.fingerprint_scope!==current.harness.fingerprint_scope)reasons.push(`report ${i+1}: source fingerprint scope differs`);for(const key of conditions)if(known(baseline.conditions[key])&&known(current.conditions[key])&&baseline.conditions[key]!==current.conditions[key])reasons.push(`report ${i+1}: condition differs: ${key}`);const canon=items=>JSON.stringify([...items].sort((a,b)=>a.id.localeCompare(b.id)));if(Array.isArray(baseline.fixtures)&&Array.isArray(current.fixtures)&&baseline.fixtures.every(x=>x&&typeof x.id==='string')&&current.fixtures.every(x=>x&&typeof x.id==='string')&&canon(baseline.fixtures)!==canon(current.fixtures))reasons.push(`report ${i+1}: fixture fingerprints differ`)}
 const comparable=reasons.length===0,sourceHashes=reports.map(report=>report?.manifest?.harness?.source_sha256||null);
 const pairwise=[];if(comparable){const first=new Map(reports[0].results.map(r=>[JSON.stringify([r.id,r.attempt]),r]));for(let i=1;i<reports.length;i++){let improved=0,regressed=0,unchanged=0;for(const item of reports[i].results){const before=first.get(JSON.stringify([item.id,item.attempt]));const was=before.status==='passed',now=item.status==='passed';if(!was&&now)improved++;else if(was&&!now)regressed++;else unchanged++}pairwise.push({report:i+1,improved,regressed,unchanged,passed_delta:summaries[i].passed-summaries[0].passed,mean_duration_delta_ms:summaries[i].duration_samples===summaries[i].total&&summaries[0].duration_samples===summaries[0].total&&summaries[i].mean_duration_ms!==null&&summaries[0].mean_duration_ms!==null?summaries[i].mean_duration_ms-summaries[0].mean_duration_ms:null})}}
 return {comparable,reasons:[...new Set(reasons)],notice:comparable?'Recorded conditions and fixture fingerprints match; source fingerprints exclude paths and do not establish identical runtime or dependencies. Provider identity is self-reported; ordinal attempts are not matched randomness, results are stochastic and require repeated independent runs.':'No direct A/B conclusion: resolve mismatched or unknown conditions and incomplete attempts.',harness_source_sha256:sourceHashes,source_changed_between_reports:new Set(sourceHashes).size>1,pairwise,reports:summaries};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){const files=process.argv.slice(2);if(files.length<2){console.error('Usage: node eval/compare.js report1.json report2.json');process.exit(2)}const reports=[];for(const file of files)reports.push(JSON.parse(await readFile(file,'utf8')));console.log(JSON.stringify(compareReports(reports),null,2))}
