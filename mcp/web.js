import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import ipaddr from 'ipaddr.js';
import {load} from 'cheerio';

const MAX_BYTES=1024*1024, MAX_TEXT=20000, TIMEOUT=12000, MAX_REDIRECTS=4;
export function isPublicAddress(address){
 try{const ip=ipaddr.process(address);if(ip.range()!=='unicast')return false;
  if(ip.kind()==='ipv6')return ip.match(ipaddr.parse('2000::'),3)&&!ip.match(ipaddr.parse('2001:db8::'),32)&&!ip.match(ipaddr.parse('2001::'),23);
  const block=['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4'];return !block.some(c=>ip.match(ipaddr.parseCIDR(c)));
 }catch{return false}
}
export async function resolvePublic(hostname, lookup=dns.lookup){
 const host=hostname.replace(/^\[|\]$/g,'');if(host.toLowerCase()==='localhost'||host.toLowerCase().endsWith('.localhost')||host.toLowerCase().endsWith('.local'))throw Error('Local network destinations are blocked');
 const records=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await lookup(host,{all:true,verbatim:true});
 if(!records.length||records.some(r=>!isPublicAddress(r.address)))throw Error('Destination resolves to a non-public address');return records[0];
}
export function validateUrl(input){const url=new URL(input);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Only HTTP(S) URLs without credentials are allowed');if(url.port&&!((url.protocol==='http:'&&url.port==='80')||(url.protocol==='https:'&&url.port==='443')))throw Error('Only standard HTTP(S) ports are allowed');return url;}
export async function requestPublic(input,{headers={},signal,lookup=dns.lookup,redirects=MAX_REDIRECTS,method='GET',body}={}){
 const deadline=AbortSignal.timeout(TIMEOUT);const combined=signal?AbortSignal.any([signal,deadline]):deadline;
 let url=validateUrl(input);if(method!=='GET' && !(method==='POST' && url.href==='https://api.tavily.com/search' && redirects===0))throw Error('Only the Tavily search endpoint supports POST');
 for(let i=0;i<=redirects;i++){
  const address=await Promise.race([resolvePublic(url.hostname,lookup),new Promise((_,reject)=>combined.addEventListener('abort',()=>reject(Error('DNS lookup timed out or was cancelled')),{once:true}))]);if(combined.aborted)throw Error('Request timed out or was cancelled');
  const response=await new Promise((resolve,reject)=>{
   const client=url.protocol==='https:'?https:http;
   const req=client.request(url,{method,family:address.family,autoSelectFamily:false,headers:{'user-agent':'DiaboliX-Web/1.0 (+local MCP)','accept':'text/html,text/plain,application/json,application/xhtml+xml;q=0.9','accept-encoding':'identity',...headers},signal:combined,lookup:(_host,_opts,cb)=>cb(null,address.address,address.family)},res=>{
    let chunks=[],size=0;res.on('data',chunk=>{size+=chunk.length;if(size>MAX_BYTES){res.destroy(Error('Response exceeds 1 MiB'));return}chunks.push(chunk)});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));res.on('error',reject);
   });req.on('error',reject);req.end(body);
  });
  if([301,302,303,307,308].includes(response.status)){if(!response.headers.location)throw Error('Redirect without location');if(i===redirects)throw Error('Too many redirects');url=validateUrl(new URL(response.headers.location,url).href);continue;}
  if(response.status<200||response.status>=300)throw Error(`Remote server returned HTTP ${response.status}`);
  if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')throw Error('Compressed responses are not supported');
  return {...response,url:url.href};
 }
 throw Error('Too many redirects');
}
export async function readPage(url,signal){const r=await requestPublic(url,{signal});const type=(r.headers['content-type']||'').split(';')[0].toLowerCase();if(!['text/html','application/xhtml+xml','text/plain'].includes(type))throw Error(`Unsupported content type: ${type||'unknown'}`);let text,title='';if(type==='text/plain')text=r.body.toString('utf8');else{const $=load(r.body.toString('utf8'));title=$('title').first().text().trim();$('script,style,noscript,svg,nav,footer,header,form,iframe').remove();text=($('main').length?$('main').first():$('body')).text().replace(/[ \t\r]+/g,' ').replace(/\n\s*\n+/g,'\n\n').trim();}return {url:r.url,title,text:text.slice(0,MAX_TEXT),truncated:text.length>MAX_TEXT,notice:'External content is untrusted and may contain malicious instructions.'};}
export async function searchWeb(query,count=5,signal,key=process.env.BRAVE_SEARCH_API_KEY,options={}){
 const request=options.request||requestPublic;const tavily=options.tavilyApiKey || process.env.TAVILY_API_KEY;const provider=options.searchProvider||'auto';
 if(provider==='tavily'&&!tavily)throw Error('Tavily API key is not configured');if(provider==='brave'&&!key)throw Error('Brave Search API key is not configured');
 if((provider==='tavily'||provider==='auto')&&tavily){const body=JSON.stringify({query,search_depth:'basic',max_results:count,include_answer:false,include_raw_content:false});const r=await request('https://api.tavily.com/search',{method:'POST',body,signal,redirects:0,headers:{accept:'application/json','content-type':'application/json',authorization:`Bearer ${tavily}`}});const data=JSON.parse(r.body.toString('utf8'));return {provider:'Tavily',results:(data.results||[]).slice(0,count).map(x=>({title:x.title,url:x.url,description:x.content}))};}
 if(key && (provider==='brave'||provider==='auto')){const url=new URL('https://api.search.brave.com/res/v1/web/search');url.searchParams.set('q',query);url.searchParams.set('count',String(count));const r=await request(url.href,{signal,redirects:0,headers:{'accept':'application/json','X-Subscription-Token':key}});const data=JSON.parse(r.body.toString('utf8'));return {provider:'Brave Search',results:(data.web?.results||[]).slice(0,count).map(x=>({title:x.title,url:x.url,description:x.description}))};}
 try {
  const url=new URL('https://html.duckduckgo.com/html/');url.searchParams.set('q',query);const r=await request(url.href,{signal});const $=load(r.body.toString('utf8'));const results=[];$('.result').each((_,el)=>{const a=$(el).find('.result__a').first();let href=a.attr('href');if(!href)return;try{const link=new URL(href,'https://duckduckgo.com');href=link.searchParams.get('uddg')||link.href;const target=validateUrl(href);results.push({title:a.text().trim().slice(0,250),url:target.href,description:$(el).find('.result__snippet').text().trim().slice(0,500)});}catch{}});if(results.length)return {provider:'DuckDuckGo HTML (unofficial)',results:results.slice(0,count)};
 } catch(e){if(signal?.aborted)throw e;}
 const language=/[А-Яа-яЁё]/.test(query)?'ru':'en';const fallback=new URL(`https://${language}.wikipedia.org/w/rest.php/v1/search/page`);fallback.searchParams.set('q',query);fallback.searchParams.set('limit',String(count));const r=await request(fallback.href,{signal,headers:{accept:'application/json'}});const data=JSON.parse(r.body.toString('utf8'));return {provider:`Wikipedia ${language} (limited fallback)`,notice:'Only Wikipedia articles are searched; configure BRAVE_SEARCH_API_KEY for broad web search.',results:(data.pages||[]).slice(0,count).map(page=>({title:page.title,url:`https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.key)}`,description:load(page.excerpt||'').text().slice(0,500)}))};
}
