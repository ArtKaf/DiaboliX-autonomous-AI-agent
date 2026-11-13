// Validate the deliberately small JSON-schema subset used by built-in tools.
export function validateToolArguments(schema,value){
 const errors=[];let visited=0;
 function visit(rule,v,location,depth=0){
  if(!rule)return;if(depth>12||++visited>1000){errors.push(`${location}: schema nesting or size limit exceeded`);return;}
  const types=Array.isArray(rule.type)?rule.type:[rule.type];
  const matches=t=>t==='null'?v===null:t==='object'?v!==null&&typeof v==='object'&&!Array.isArray(v):t==='array'?Array.isArray(v):t==='integer'?Number.isSafeInteger(v):t==='number'?typeof v==='number'&&Number.isFinite(v):typeof v===t;
  if(rule.type&&!types.some(matches)){errors.push(`${location}: expected ${types.join(' or ')}`);return}
  if(rule.enum&&!rule.enum.includes(v))errors.push(`${location}: choose one of ${rule.enum.map(x=>JSON.stringify(x)).join(', ')}`);
  if(typeof v==='number'){if(rule.minimum!==undefined&&v<rule.minimum)errors.push(`${location}: minimum ${rule.minimum}`);if(rule.maximum!==undefined&&v>rule.maximum)errors.push(`${location}: maximum ${rule.maximum}`)}
  if(typeof v==='string'){if(rule.minLength!==undefined&&v.length<rule.minLength)errors.push(`${location}: too short`);if(rule.maxLength!==undefined&&v.length>rule.maxLength)errors.push(`${location}: too long`)}
  if(Array.isArray(v)){if(rule.maxItems!==undefined&&v.length>rule.maxItems)errors.push(`${location}: at most ${rule.maxItems} items`);v.slice(0,100).forEach((x,i)=>visit(rule.items,x,`${location}[${i}]`,depth+1))}
  else if(v&&typeof v==='object'){for(const name of rule.required||[])if(!(name in v))errors.push(`${location}.${name}: required`);for(const [name,child] of Object.entries(rule.properties||{}))if(name in v)visit(child,v[name],`${location}.${name}`,depth+1)}
 }
 visit(schema,value,'arguments');return errors.slice(0,8);
}
