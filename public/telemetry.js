// Only sum costs actually reported by the provider. Different or unknown
// currencies remain separate; token prices are never inferred.
export function formatTelemetry(usage={},language='ru'){
 const data=usage&&typeof usage==='object'?usage:{},roles=['planner','worker','reviewer'];
 const count=key=>roles.reduce((sum,role)=>sum+(Number.isFinite(data[role]?.[key])&&data[role][key]>=0?data[role][key]:0),0);
 const elapsed=count('elapsed_ms'),groups=new Map();
 for(const role of roles){const item=data[role],cost=item?.provider_cost;if(!Number.isFinite(cost)||cost<0)continue;const currency=typeof item.provider_currency==='string'?item.provider_currency.trim().slice(0,20):'';groups.set(currency,(groups.get(currency)||0)+cost)}
 return {
  prompt:count('prompt').toLocaleString(language),
  cached:count('cached').toLocaleString(language),
  completion:count('completion').toLocaleString(language),
  latency:(elapsed/1000).toLocaleString(language,{maximumFractionDigits:1})+' '+(language==='ru'?'с':'s'),
  cost:groups.size?[...groups].map(([currency,total])=>total.toLocaleString(language,{maximumFractionDigits:6})+(currency?' '+currency:'')).join(' / '):'—',
  steps:Number.isFinite(data.steps)&&data.steps>=0?data.steps:0
 };
}
