// A bounded, one-level MCTS: model-proposed branches, UCB selection and model rollouts.
export async function choosePlan(task, ask, iterations=4) {
 const proposal=await ask('Propose exactly two distinct implementation plans for the task. Return JSON only: {"plans":["...","..."]}. Include verification in each plan.',task);
 let plans;try{const match=proposal.match(/\{[\s\S]*\}/);plans=JSON.parse(match?.[0]||'').plans?.filter(p=>typeof p==='string'&&p.trim()).slice(0,2)}catch{}
 if(!plans?.length)return {plan:proposal||'',branches:[]};
 if(plans.length===1)return {plan:plans[0],branches:[]};
 const branches=plans.map(plan=>({plan,visits:0,total:0}));
 for(let i=0;i<iterations;i++){
   const chosen=branches.find(b=>!b.visits)||branches.reduce((a,b)=>{const score=x=>x.total/x.visits+Math.sqrt(2*Math.log(i)/x.visits);return score(a)>=score(b)?a:b});
   const raw=await ask('Simulate the proposed plan without tools. Rate feasibility, safety, and testability for this task. Return JSON only: {"score": number from 0 to 1, "reason": "..."}. Do not claim actual execution.',JSON.stringify({task,plan:chosen.plan}));
   let score;try{score=Number(JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]||'').score)}catch{};
   if(!Number.isFinite(score)) score=0.5;
   chosen.visits++;chosen.total+=Math.max(0,Math.min(1,score));
 }
 const winner=branches.reduce((a,b)=>a.total/a.visits>=b.total/b.visits?a:b);
 return {plan:winner.plan,branches};
}
