const readOnlyTools=new Set(['list_files','read_file','read_task_evidence','search_code','parse_ast','project_state','verify_task','module_map','code_navigation','parallel_read','record_decision','declare_research_blocker']);
const nestedParallelTools=new Set(['list_files','read_file','search_code','parse_ast']);
const safeTools=new Set([...readOnlyTools,'write_file','patch_file','smart_edit','smart_edit_batch']);
const isReadOnly=(name,args)=>readOnlyTools.has(name)||(['smart_edit','smart_edit_batch'].includes(name)&&args?.preview===true);
export function recoveryPlan(run,workspace){
 if(!run)throw Error('Продолжить можно только прерванную или остановленную задачу.');
 if(run.journal_integrity&&run.journal_integrity!=='complete')throw Error('Журнал задачи повреждён или имеет несовместимый формат. Проверьте проект вручную; историю можно просмотреть.');
 if(!['interrupted','cancelled','error'].includes(run.status))throw Error('Продолжить можно только прерванную или остановленную задачу.');
 if(run.profile!=='coding'||run.workspace!==workspace)throw Error('Для продолжения выберите исходный проект и профиль «Разработка».');
 if(!Array.isArray(run.events))throw Error('Журнал вызовов неполон. Проверьте проект вручную.');
 const changed=new Map(),evidence=[];let pending=null,pendingArgs=null;
 for(const event of run.events){
  if(!event||typeof event!=='object')throw Error('Журнал вызовов неполон. Проверьте проект вручную.');
  if(event.type==='tool_start'){if(pending)throw Error('Результат предыдущего инструмента неизвестен. Проверьте проект вручную.');pending=event.name;pendingArgs=event.args;if(!safeTools.has(pending))throw Error('Задача использовала команды или внешние инструменты; безопасное автоматическое продолжение недоступно.');}
  else if(event.type==='tool_result'){
   // parallel_read emits separately journaled read-only observations before its own result.
   if(pending==='parallel_read'&&event.name!==pending&&nestedParallelTools.has(event.name)){if(event.outcome?.status==='success'||event.outcome?.status==='error')evidence.push(event.outcome);continue}
   if(!pending||event.name!==pending)throw Error('Журнал вызовов неполон. Проверьте проект вручную.');const outcome=event.outcome;
   if(!outcome||!['success','error','unknown','timeout','cached'].includes(outcome.status))throw Error('Результат инструмента не подтверждён. Проверьте проект вручную.');
   if(!isReadOnly(pending,pendingArgs)&&['unknown','timeout','cached'].includes(outcome.status))throw Error('Результат инструмента не подтверждён. Проверьте проект вручную.');
   if(['write_file','patch_file','smart_edit'].includes(pending)&&!(pending==='smart_edit'&&pendingArgs?.preview===true)){if(outcome.status!=='success'||!outcome.path||!/^[a-f0-9]{64}$/.test(outcome.verified_hash||''))throw Error('Результат записи не подтверждён. Проверьте проект вручную.');changed.set(outcome.path,outcome.verified_hash)}
   if(pending==='smart_edit_batch'&&pendingArgs?.preview!==true){if(outcome.status!=='success'||!Array.isArray(outcome.verified_hashes)||!outcome.verified_hashes.length||outcome.verified_hashes.length>10||outcome.verified_hashes.some(x=>typeof x.path!=='string'||!/^[a-f0-9]{64}$/.test(x.hash||'')))throw Error('Результат пакетной записи не подтверждён. Проверьте проект вручную.');for(const item of outcome.verified_hashes)changed.set(item.path,item.hash)}
   if(!['unknown','timeout','cached'].includes(outcome.status))evidence.push(outcome);pending=null;pendingArgs=null;
  }
 }
 if(pending&&!isReadOnly(pending,pendingArgs))throw Error('Результат последнего инструмента неизвестен. Проверьте проект вручную.');
 const memory=run.events.findLast(e=>e.type==='task_memory')?.memory;return {task:run.task,changed:[...changed].map(([path,hash])=>({path,hash})),evidence:evidence.slice(-30),...(pending?{interrupted_read:pending}:{}),...(memory&&typeof memory==='object'?{memory}: {})};
}

// A journal-only assessment for history views. It deliberately does not inspect
// the current workspace and is not authorization to replay an interrupted call.
export function assessRecovery(run){
 if(run?.journal_integrity&&run.journal_integrity!=='complete')return {status:'blocked',journal_eligible:false,reason:'Журнал задачи повреждён или несовместим; автоматическое продолжение недоступно.'};
 if(!run||!['interrupted','cancelled','error'].includes(run.status))return {status:'not_applicable',journal_eligible:false};
 if(typeof run.workspace!=='string'||!run.workspace)return {status:'blocked',journal_eligible:false,reason:'Исходная рабочая папка неизвестна.'};
 try{
  const plan=recoveryPlan(run,run.workspace);
  return {status:'requires_workspace_revalidation',journal_eligible:true,verified_write_count:plan.changed.length,...(plan.interrupted_read?{interrupted_read:plan.interrupted_read}:{}),notice:'Оценён только журнал. Перед продолжением необходимо заново проверить хеши файлов; внешнее состояние и неотслеживаемые файлы не проверены.'};
 }catch(error){return {status:'blocked',journal_eligible:false,reason:String(error?.message||'Продолжение требует ручной проверки.').slice(0,500)};}
}
