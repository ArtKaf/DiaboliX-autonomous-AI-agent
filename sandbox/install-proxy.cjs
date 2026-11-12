'use strict';
const http=require('node:http');
const net=require('node:net');
const dns=require('node:dns').promises;
const crypto=require('node:crypto');

const allowed=new Set(['registry.npmjs.org','pypi.org','files.pythonhosted.org']);
const blocked=new net.BlockList();
for(const [address,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(address,bits,'ipv4');
function isPublic(address){return net.isIP(address)===4&&!blocked.check(address,'ipv4')}
function createProxy(secret,{lookup=dns.lookup,connect=net.connect}={}){
 if(!/^[a-f0-9]{64}$/.test(secret||''))throw Error('Package proxy secret is missing.');
 const expected=Buffer.from('Basic '+Buffer.from('diabolix:'+secret).toString('base64'));
 const server=http.createServer((req,res)=>{res.writeHead(403,{'Connection':'close'});res.end('HTTPS registry proxy only')});server.maxConnections=128;
 server.on('connect',async(req,socket,head)=>{
  const deny=()=>{if(!socket.destroyed)socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')};socket.on('error',()=>{});socket.setTimeout(90000,()=>socket.destroy());
  const auth=Buffer.from(req.headers['proxy-authorization']||'');if(auth.length!==expected.length||!crypto.timingSafeEqual(auth,expected))return deny();
  const match=/^([a-z0-9.-]+):443$/i.exec(req.url||'');if(!match||!allowed.has(match[1].toLowerCase()))return deny();
  try{const addresses=await lookup(match[1],{family:4,all:true});if(!addresses.length||addresses.some(x=>!isPublic(x.address)))return deny();if(socket.destroyed)return;const upstream=connect({host:addresses[0].address,port:443});upstream.setTimeout(90000,()=>upstream.destroy());upstream.on('error',()=>socket.destroy());socket.on('close',()=>upstream.destroy());upstream.on('connect',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket)})}catch{return deny()}
 });
 return server;
}
if(require.main===module)createProxy(process.env.DIABOLIX_PROXY_SECRET).listen(3128,'0.0.0.0');
module.exports={createProxy,isPublic};
