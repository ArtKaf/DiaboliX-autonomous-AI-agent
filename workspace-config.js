import {existsSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
export function configPath(){return path.resolve(process.env.DIABOLIX_CONFIG_PATH||path.join(root,'config.local.json'));}
export function paperJournalDir(){return path.join(path.dirname(configPath()),'.diabolix-orders');}
export function paperJournalPath(){return path.join(paperJournalDir(),'journal.json');}
export function taskJournalDir(){return path.join(path.dirname(configPath()),'.diabolix-sessions');}
function resolved(p){try{return realpathSync(p)}catch{return path.resolve(p)}}
function relativeIfInside(workspace,file){
 const base=resolved(workspace),relative=path.relative(base,resolved(file));
 return relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)?relative:null;
}
export function protectedConfigRelative(workspace){return relativeIfInside(workspace,configPath());}
// Bind-mount an empty read-only device over the real config if the workspace contains it.
export function protectedConfigMount(workspace){
 const mounts=[],relative=relativeIfInside(workspace,configPath());if(relative&&existsSync(configPath()))mounts.push('--mount',`type=bind,src=/dev/null,dst=/workspace/${relative.split(path.sep).join('/')},readonly`);for(const protectedDir of [paperJournalDir(),taskJournalDir()]){const dir=relativeIfInside(workspace,protectedDir);if(dir&&existsSync(protectedDir))mounts.push('--tmpfs',`/workspace/${dir.split(path.sep).join('/')}:ro,nosuid,nodev,size=1m,mode=0755`)}return mounts;
}
