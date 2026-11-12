const safeTools=new Set(['list_files','read_file','read_task_evidence','search_code','parse_ast','write_file','patch_file']);
export function recoveryPlan(run,workspace){
 if(!run||!['interrupted','cancelled','error'].includes(run.status))throw Error('Продолжить можно только прерванную или остановленную задачу.');
 if(run.profile!=='coding'||run.workspace!==workspace)throw Error('Для продолжения выберите исходный проект и профиль «Разработка».');
 const changed=new Map(),evidence=[];let pending=null;
 for(const event of run.events){
  if(event.type==='tool_start'){if(pending)throw Error('Результат предыдущего инструмента неизвестен. Проверьте проект вручную.');pending=event.name;if(!safeTools.has(pending))throw Error('Задача использовала команды или внешние инструменты; безопасное автоматическое продолжение недоступно.');}
  else if(event.type==='tool_result'){
   if(!pending||event.name!==pending)throw Error('Журнал вызовов неполон. Проверьте проект вручную.');const outcome=event.outcome;
   if(!outcome||['unknown','timeout'].includes(outcome.status))throw Error('Результат инструмента не подтверждён. Проверьте проект вручную.');
   if(['write_file','patch_file'].includes(pending)){if(outcome.status!=='success'||!outcome.path||!/^[a-f0-9]{64}$/.test(outcome.verified_hash||''))throw Error('Результат записи не подтверждён. Проверьте проект вручную.');changed.set(outcome.path,outcome.verified_hash)}
   evidence.push(outcome);pending=null;
  }
 }
 if(pending)throw Error('Результат последнего инструмента неизвестен. Проверьте проект вручную.');
 return {task:run.task,changed:[...changed].map(([path,hash])=>({path,hash})),evidence:evidence.slice(-30)};
}
