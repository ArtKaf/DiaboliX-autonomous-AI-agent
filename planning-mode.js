// Conservative, opt-in routing; heuristic estimates are not measured difficulty.
export function selectPlanningMode(requested,task){
 if(requested!=='auto')return requested;
 const text=String(task||'').trim().toLowerCase();
 if(text.length>700||/(?:architect|migration|refactor|across (?:multiple|several)|multi.file|multiple (?:files|modules)|архитектур|миграц|рефактор|нескольк.{0,20}(?:файл|модул)|многофайл)/i.test(text))return 'deep';
 if(text.length<220&&/(?:\b(?:read|show|inspect|rename)\b|прочитай|покажи|посмотри|переименуй)/i.test(text)&&!/(?:all files|whole project|все файлы|весь проект)/i.test(text))return 'quick';
 return 'standard';
}
