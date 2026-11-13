const safeTools=new Set(['list_files','read_file','read_task_evidence','search_code','parse_ast','project_state','verify_task','module_map','write_file','patch_file','smart_edit','smart_edit_batch']);
export function recoveryPlan(run,workspace){
 if(!run||!['interrupted','cancelled','error'].includes(run.status))throw Error('Продолжить можно только прерванную или остановленную задачу.');
 if(run.profile!=='coding'||run.workspace!==workspace)throw Error('Для продолжения выберите исходный проект и профиль «Разработка».');
 const changed=new Map(),evidence=[];let pending=null,pendingArgs=null;
 for(const event of run.events){
  if(event.type==='tool_start'){if(pending)throw Error('Результат предыдущего инструмента неизвестен. Проверьте проект вручную.');pending=event.name;pendingArgs=event.args;if(!safeTools.has(pending))throw Error('Задача использовала команды или внешние инструменты; безопасное автоматическое продолжение недоступно.');}
  else if(event.type==='tool_result'){
   if(!pending||event.name!==pending)throw Error('Журнал вызовов неполон. Проверьте проект вручную.');const outcome=event.outcome;
   if(!outcome||['unknown','timeout'].includes(outcome.status))throw Error('Результат инструмента не подтверждён. Проверьте проект вручную.');
   if(['write_file','patch_file','smart_edit'].includes(pending)&&!(pending==='smart_edit'&&pendingArgs?.preview===true)){if(outcome.status!=='success'||!outcome.path||!/^[a-f0-9]{64}$/.test(outcome.verified_hash||''))throw Error('Результат записи не подтверждён. Проверьте проект вручную.');changed.set(outcome.path,outcome.verified_hash)}
   if(pending==='smart_edit_batch'&&pendingArgs?.preview!==true){if(outcome.status!=='success'||!Array.isArray(outcome.verified_hashes)||!outcome.verified_hashes.length||outcome.verified_hashes.length>10||outcome.verified_hashes.some(x=>typeof x.path!=='string'||!/^[a-f0-9]{64}$/.test(x.hash||'')))throw Error('Результат пакетной записи не подтверждён. Проверьте проект вручную.');for(const item of outcome.verified_hashes)changed.set(item.path,item.hash)}
   evidence.push(outcome);pending=null;pendingArgs=null;
  }
 }
 if(pending)throw Error('Результат последнего инструмента неизвестен. Проверьте проект вручную.');
 const memory=run.events.findLast(e=>e.type==='task_memory')?.memory;return {task:run.task,changed:[...changed].map(([path,hash])=>({path,hash})),evidence:evidence.slice(-30),...(memory&&typeof memory==='object'?{memory}: {})};
}
