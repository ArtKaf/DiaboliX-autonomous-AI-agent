import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import crypto from 'node:crypto';

export async function loadConfig(file, defaults) {
  let data;
  try { data=JSON.parse(await readFile(file,'utf8')); }
  catch(e) { if(e.code==='ENOENT') return {...defaults}; throw new Error(`Не удалось загрузить настройки: ${e.message}`); }
  if(!data || typeof data!=='object' || Array.isArray(data)) throw Error('Некорректный файл настроек');
  const c={...defaults};
  for(const key of ['endpoint','apiKey','braveApiKey','tavilyApiKey','model','plannerModel','workerModel','reviewerModel','mcpUrl']) if(typeof data[key]==='string')c[key]=data[key];
  if(['auto','tavily','brave'].includes(data.searchProvider))c.searchProvider=data.searchProvider;
  if(typeof data.mcpInitialized==='boolean')c.mcpInitialized=data.mcpInitialized;
  if(typeof data.workspaceDir==='string')c.workspace=data.workspaceDir;
  else if(typeof data.workspace==='string')c.workspace=data.workspace;
  if(Number.isInteger(data.maxSteps)&&data.maxSteps>=1&&data.maxSteps<=100)c.maxSteps=data.maxSteps;
  if(Number.isInteger(data.contextLimit)&&data.contextLimit>=1000&&data.contextLimit<=1000000)c.contextLimit=data.contextLimit;
  if(typeof data.unlimitedSteps==='boolean')c.unlimitedSteps=data.unlimitedSteps;
  c.saveApiKey=data.saveApiKey===true && typeof data.apiKey==='string';
  c.saveBraveApiKey=data.saveBraveApiKey===true && typeof data.braveApiKey==='string';
  c.saveTavilyApiKey=data.saveTavilyApiKey===true && typeof data.tavilyApiKey==='string';
  return c;
}
export async function saveConfig(file, config) {
  const data={endpoint:config.endpoint,model:config.model,plannerModel:config.plannerModel,workerModel:config.workerModel,reviewerModel:config.reviewerModel,workspaceDir:config.workspace,maxSteps:config.maxSteps,contextLimit:config.contextLimit,unlimitedSteps:config.unlimitedSteps,mcpUrl:config.mcpUrl,mcpInitialized:config.mcpInitialized,saveApiKey:config.saveApiKey,saveBraveApiKey:config.saveBraveApiKey,saveTavilyApiKey:config.saveTavilyApiKey,searchProvider:config.searchProvider};
  if(config.saveApiKey && config.apiKey)data.apiKey=config.apiKey;
  if(config.saveBraveApiKey && config.braveApiKey)data.braveApiKey=config.braveApiKey;
  if(config.saveTavilyApiKey && config.tavilyApiKey)data.tavilyApiKey=config.tavilyApiKey;
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';
  try {await writeFile(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,file);}
  finally {await unlink(tmp).catch(()=>{});}
}
