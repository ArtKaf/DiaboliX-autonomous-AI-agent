import crypto from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clone=entry=>({...entry});

// A queue belongs to exactly one run. An accepted message is merely queued:
// callers claim it at a turn boundary, record the user message in history and
// the journal, and acknowledge only when they can honestly report it applied.
// JavaScript's synchronous calls make enqueue / claim / close atomic on the
// server event loop. No method interrupts an executing tool or replays it.
export class SteeringQueue {
 constructor({maxPending=64,maxAccepted=1000,maxLength=50000}={}){
  if(!Number.isInteger(maxPending)||maxPending<1||!Number.isInteger(maxAccepted)||maxAccepted<1||!Number.isInteger(maxLength)||maxLength<1)throw Error('Invalid steering queue limits.');
  this.maxPending=maxPending;this.maxAccepted=maxAccepted;this.maxLength=maxLength;this.pending=[];this.claimed=null;this.seen=new Map();this.closed=false;this.version=0;
 }
 enqueue(text,requestId=crypto.randomUUID()){
  if(this.closed)throw Error('Задача уже завершена; уточнение не принято.');
  if(typeof text!=='string'||!text.trim()||text.length>this.maxLength)throw Error('Уточнение должно содержать от 1 до '+this.maxLength+' символов.');
  if(typeof requestId!=='string'||!UUID.test(requestId))throw Error('Некорректный ID уточнения.');
  const id=requestId.toLowerCase(),prior=this.seen.get(id);
  if(prior){if(prior.text!==text)throw Error('ID уточнения уже использован с другим текстом.');return {...clone(prior),duplicate:true};}
  if(this.seen.size>=this.maxAccepted)throw Error('Превышено количество уточнений для этой задачи.');
  if(this.pending.length+(this.claimed?.length||0)>=this.maxPending)throw Error('Очередь уточнений заполнена. Дождитесь следующего шага агента.');
  const entry={id,text};this.seen.set(id,entry);this.pending.push(entry);this.version++;return {...clone(entry),duplicate:false};
 }
 hasPending(){return this.pending.length>0}
 hasClaimed(){return !!this.claimed?.length}
 revision(){return this.version}
 claim(){
  if(this.closed)throw Error('Задача уже завершена.');
  if(this.claimed)throw Error('Предыдущие уточнения ещё не подтверждены.');
  if(!this.pending.length)return [];
  this.claimed=this.pending;this.pending=[];return this.claimed.map(clone);
 }
 acknowledge(){if(!this.claimed)throw Error('Нет уточнений для подтверждения.');const result=this.claimed.map(clone);this.claimed=null;return result;}
 release(){if(!this.claimed)return false;this.pending=[...this.claimed,...this.pending];this.claimed=null;return true;}
 close(){
  if(this.closed)return {undelivered:[],unconfirmed:[]};
  this.closed=true;const result={undelivered:this.pending.map(clone),unconfirmed:(this.claimed||[]).map(clone)};
  this.pending=[];this.claimed=null;this.seen.clear();return result;
 }
}
