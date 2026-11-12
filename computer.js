import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import {protectedConfigMount} from './workspace-config.js';
const image=process.env.DIABOLIX_COMPUTER_IMAGE||'diabolix-computer:local';
function command(args,{input,signal,timeout=20000,limit=3000000}={}){return new Promise((resolve,reject)=>{
 if(signal?.aborted)return reject(Error('Действие остановлено'));
 const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let chunks=[],errors=[],size=0,settled=false;
 const abort=()=>child.kill('SIGKILL');signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,timeout);
 child.stdout.on('data',data=>{size+=data.length;if(size>limit)abort();else chunks.push(data)});child.stderr.on('data',data=>{if(Buffer.concat(errors).length<8192)errors.push(data)});child.stdin.on('error',()=>{});child.stdin.end(input);
 function finish(error,code){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)return reject(error);if(signal?.aborted)return reject(Error('Действие остановлено'));if(code!==0)return reject(Error(Buffer.concat(errors).toString().slice(0,1000)||'Команда Docker завершилась с ошибкой'));resolve(Buffer.concat(chunks))}
 child.on('error',e=>finish(e));child.on('close',code=>finish(null,code));
});}
const coord=(v,max)=>{if(!Number.isInteger(v)||v<0||v>=max)throw Error('Координата вне экрана');return String(v)};
export function normalizeNavigationUrl(input){
 if(typeof input!=='string')throw Error('Укажите адрес сайта');let value=input.trim();
 const markdown=value.match(/^\[[^\]\r\n]*\]\((https?:\/\/[^\s()]+)\)$/i);if(markdown)value=markdown[1];
 if(value==='about:blank')return value;
 let url;try{url=new URL(value)}catch{throw Error('Укажите корректный HTTP(S) URL без форматирования')}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Поддерживаются только HTTP(S) URL без учётных данных');return url.href;
}
const allowedKeys=new Set(['Return','Tab','Escape','BackSpace','Delete','space','Up','Down','Left','Right','Home','End','Page_Up','Page_Down','ctrl+a','ctrl+c','ctrl+v','ctrl+x','ctrl+z','ctrl+y','ctrl+s','ctrl+f','ctrl+l','ctrl+r','alt+Left','alt+Right','alt+Tab']);
export class Computer {
 constructor(workspace,{networkEnabled=false}={}){this.workspace=workspace;this.networkEnabled=networkEnabled;this.name='diabolix-computer-'+crypto.randomUUID();this.started=false;}
 async start(signal){if(this.started)return;this.started=true;try{await command(['run','-d','--rm','--name',this.name,'--network',this.networkEnabled?'bridge':'none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--memory','2g','--cpus','2','--shm-size','256m','--tmpfs','/tmp:rw,nosuid,nodev,size=512m,mode=1777','--mount',`type=bind,src=${this.workspace},dst=/workspace`,...protectedConfigMount(this.workspace),image],{signal,timeout:30000});for(let i=0;i<30;i++){try{await this.exec(['xdotool','getdisplaygeometry'],{signal,timeout:2000});await this.exec(['xdotool','search','--onlyvisible','--class','chromium'],{signal,timeout:2000});return}catch{if(signal.aborted)throw Error('Остановлено');await new Promise(r=>setTimeout(r,200))}}throw Error('Рабочий стол не запустился')}catch(e){await this.close();throw e}}
 exec(args,options={}){return command(['exec','-i',this.name,...args],options)}
 async screenshot(signal){await this.exec(['scrot','-o','/tmp/diabolix-screen.png'],{signal});const data=await this.exec(['cat','/tmp/diabolix-screen.png'],{signal});if(data.length<8||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Не удалось получить снимок экрана');return data.toString('base64')}
 async act(args,signal){await this.start(signal);this.lastObservation=null;const {action}=args;const x=()=>coord(args.x,1280),y=()=>coord(args.y,800);
 if(action==='click'||action==='double_click'){const button=args.button??1;if(![1,2,3].includes(button))throw Error('Недопустимая кнопка мыши');await this.exec(['xdotool','mousemove','--sync',x(),y(),'click','--repeat',action==='double_click'?'2':'1',String(button)],{signal})}
 else if(action==='move')await this.exec(['xdotool','mousemove','--sync',x(),y()],{signal});
 else if(action==='drag'){const tx=coord(args.to_x,1280),ty=coord(args.to_y,800);await this.exec(['xdotool','mousemove','--sync',x(),y(),'mousedown','1','mousemove','--sync',tx,ty,'mouseup','1'],{signal})}
 else if(action==='scroll'){if(!['up','down','left','right'].includes(args.direction))throw Error('Недопустимое направление прокрутки');const n=Math.min(12,Math.max(1,Number(args.amount)||3));await this.exec(['xdotool','mousemove','--sync',x(),y(),'click','--repeat',String(n),{up:'4',down:'5',left:'6',right:'7'}[args.direction]],{signal})}
 else if(action==='key'){if(!allowedKeys.has(args.key))throw Error('Клавиша или сочетание не поддерживается');await this.exec(['xdotool','key','--clearmodifiers',args.key],{signal})}
 else if(action==='open_url'){const url=normalizeNavigationUrl(args.url);if(url!=='about:blank'&&!this.networkEnabled)throw Error('Интернет для рабочего стола отключён. Включите его в настройках и начните новую задачу.');let activated=false;for(let i=0;i<30&&!activated;i++){try{await this.exec(['xdotool','search','--onlyvisible','--class','chromium','windowactivate','--sync'],{signal});activated=true}catch(e){if(signal?.aborted)throw e;await new Promise(r=>setTimeout(r,200))}}if(!activated)throw Error('Окно Chromium недоступно');let previous;try{previous=JSON.parse((await this.exec(['node','/opt/diabolix/browser-state.cjs','probe'],{signal})).toString()).url}catch{throw Error('Не удалось проверить состояние вкладки Chromium; переход не выполнен')}await this.exec(['xdotool','key','--clearmodifiers','ctrl+l'],{signal});await this.exec(['xclip','-selection','clipboard','-in'],{signal,input:url});await this.exec(['xdotool','key','--clearmodifiers','ctrl+v','Return'],{signal});const state=await this.exec(['node','/opt/diabolix/browser-state.cjs','wait',url,previous],{signal,timeout:22000});try{this.lastObservation=JSON.parse(state.toString())}catch{throw Error('Не удалось определить результат загрузки страницы')}}
 else if(action==='type'){if(typeof args.text!=='string'||args.text.length>4000||args.text.includes('\0'))throw Error('Текст должен содержать не более 4000 символов');await this.exec(['xclip','-selection','clipboard','-in'],{signal,input:args.text});await this.exec(['xdotool','key','--clearmodifiers','ctrl+v'],{signal})}
 else if(action==='wait'){const ms=Math.max(100,Math.min(5000,Number(args.ms)||500));await new Promise((resolve,reject)=>{const id=setTimeout(done,ms);function done(){signal?.removeEventListener('abort',abort);resolve()}function abort(){clearTimeout(id);reject(Error('Остановлено'))}signal?.addEventListener('abort',abort,{once:true})})}
 else if(action!=='screenshot')throw Error('Неизвестное действие');
 await new Promise(r=>setTimeout(r,250));return this.screenshot(signal);
 }
 async close(){if(!this.started)return;this.started=false;await command(['rm','-f',this.name],{timeout:10000}).catch(()=>{})}
}
