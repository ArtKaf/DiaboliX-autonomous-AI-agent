import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import crypto from 'node:crypto';
import {validEffort} from './reasoning.js';
import {PROFILES} from './profiles.js';

export async function loadConfig(file, defaults) {
  const migratedDefaults={profile:'coding',...defaults};
  for(const key of ['executionMode','frontierMcts','plannerModel','workerModel','plannerReasoningEffort','workerReasoningEffort'])delete migratedDefaults[key];
  let data;
  try { data=JSON.parse(await readFile(file,'utf8')); }
  catch(e) { if(e.code==='ENOENT') return migratedDefaults; throw new Error(`Не удалось загрузить настройки: ${e.message}`); }
  if(!data || typeof data!=='object' || Array.isArray(data)) throw Error('Некорректный файл настроек');
  const c=migratedDefaults;
  if(PROFILES.includes(data.profile))c.profile=data.profile;
  for(const key of ['endpoint','apiKey','braveApiKey','tavilyApiKey','model','reviewerModel','mcpUrl']) if(typeof data[key]==='string')c[key]=data[key];
  // The former worker was the primary model in Frontier: preserve that choice.
  if(typeof data.workerModel==='string'&&data.workerModel.trim())c.model=data.workerModel.trim();
  if(validEffort(data.reasoningEffort))c.reasoningEffort=data.reasoningEffort;
  if(validEffort(data.reviewerReasoningEffort,true))c.reviewerReasoningEffort=data.reviewerReasoningEffort;
  if(data.workerReasoningEffort==='default')c.reasoningEffort='';
  else if(typeof data.workerReasoningEffort==='string'&&data.workerReasoningEffort&&validEffort(data.workerReasoningEffort))c.reasoningEffort=data.workerReasoningEffort;
  if(typeof data.telegramUserId==='string')c.telegramUserId=data.telegramUserId;
  if(typeof data.telegramEnabled==='boolean')c.telegramEnabled=data.telegramEnabled;
  if(typeof data.saveTelegramToken==='boolean')c.saveTelegramToken=data.saveTelegramToken;
  if(data.saveTelegramToken===true&&typeof data.telegramToken==='string')c.telegramToken=data.telegramToken;
  if(['auto','tavily','brave'].includes(data.searchProvider))c.searchProvider=data.searchProvider;
  if(typeof data.mcpInitialized==='boolean')c.mcpInitialized=data.mcpInitialized;
  if(typeof data.workspaceDir==='string')c.workspace=data.workspaceDir;
  else if(typeof data.workspace==='string')c.workspace=data.workspace;
  if(Number.isInteger(data.maxSteps)&&data.maxSteps>=1&&data.maxSteps<=100)c.maxSteps=data.maxSteps;
  if(Number.isInteger(data.contextLimit)&&data.contextLimit>=1000&&data.contextLimit<=1000000)c.contextLimit=data.contextLimit;
  if(typeof data.mcpReadOnly==='boolean')c.mcpReadOnly=data.mcpReadOnly;
  if(typeof data.computerNetworkEnabled==='boolean')c.computerNetworkEnabled=data.computerNetworkEnabled;
  if(typeof data.computerEnabled==='boolean')c.computerEnabled=data.computerEnabled;
  if(typeof data.unlimitedSteps==='boolean')c.unlimitedSteps=data.unlimitedSteps;
  if(typeof data.strategySearch==='boolean')c.strategySearch=data.strategySearch;
  c.saveApiKey=data.saveApiKey===true && typeof data.apiKey==='string';
  c.saveBraveApiKey=data.saveBraveApiKey===true && typeof data.braveApiKey==='string';
  c.saveTavilyApiKey=data.saveTavilyApiKey===true && typeof data.tavilyApiKey==='string';
  return c;
}
export async function saveConfig(file, config) {
  const data={profile:PROFILES.includes(config.profile)?config.profile:'coding',endpoint:config.endpoint,model:config.model,reviewerModel:config.reviewerModel,workspaceDir:config.workspace,maxSteps:config.maxSteps,contextLimit:config.contextLimit,computerEnabled:config.computerEnabled,computerNetworkEnabled:config.computerNetworkEnabled,unlimitedSteps:config.unlimitedSteps,mcpReadOnly:config.mcpReadOnly,mcpUrl:config.mcpUrl,mcpInitialized:config.mcpInitialized,saveApiKey:config.saveApiKey,saveBraveApiKey:config.saveBraveApiKey,saveTavilyApiKey:config.saveTavilyApiKey,searchProvider:config.searchProvider};
  if(typeof config.strategySearch==='boolean')data.strategySearch=config.strategySearch;
  for(const key of ['reasoningEffort','reviewerReasoningEffort'])if(config[key]!==undefined)data[key]=config[key];
  for(const key of ['telegramUserId','telegramEnabled','saveTelegramToken'])if(config[key]!==undefined)data[key]=config[key];
  if(config.saveTelegramToken&&config.telegramToken)data.telegramToken=config.telegramToken;
  if(config.saveApiKey && config.apiKey)data.apiKey=config.apiKey;
  if(config.saveBraveApiKey && config.braveApiKey)data.braveApiKey=config.braveApiKey;
  if(config.saveTavilyApiKey && config.tavilyApiKey)data.tavilyApiKey=config.tavilyApiKey;
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';
  try {await writeFile(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,file);}
  finally {await unlink(tmp).catch(()=>{});}
}
