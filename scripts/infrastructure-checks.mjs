import tls from 'node:tls';

export function expiryCheck(key, expiresAt, now=new Date()) {
 const end=Date.parse(expiresAt), days=(end-now.getTime())/86400000;
 if(!Number.isFinite(days)) return {key,state:'unknown'};
 return {key,state:days<=7?'failed':days<=30?'degraded':'healthy',expires_at:new Date(end).toISOString()};
}
export function domainExpiry(record,now=new Date()) {
 if(record?.ldhName?.toLowerCase()!=='bjjtournaments.net' || !Array.isArray(record.events)) return {key:'domain_expiry',state:'unknown'};
 const dates=record.events.filter(e=>e.eventAction==='expiration').map(e=>Date.parse(e.eventDate));
 if(!dates.length || dates.some(d=>!Number.isFinite(d))) return {key:'domain_expiry',state:'unknown'};
 return expiryCheck('domain_expiry',new Date(Math.min(...dates)).toISOString(),now);
}
export function certificateExpiry(host,now=new Date()) {
 return new Promise(resolve=>{
  let done=false;
  const finish=result=>{if(done)return;done=true;socket.destroy();resolve(result);};
  const socket=tls.connect({host,port:443,servername:host,rejectUnauthorized:true});
  socket.setTimeout(10000,()=>finish({key:'certificate_expiry',state:'unknown'}));
  socket.once('secureConnect',()=>finish(expiryCheck('certificate_expiry',socket.getPeerCertificate().valid_to,now)));
  socket.once('error',error=>finish({key:'certificate_expiry',state:['CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','CERT_NOT_YET_VALID','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(error.code)?'failed':'unknown'}));
 });
}
export async function infrastructureChecks(site) {
 if(!['https://staging.bjjtournaments.net','https://bjjtournaments.net'].includes(site)) throw new Error('Unapproved site');
 return Promise.all([
  certificateExpiry(new URL(site).hostname),
  (async()=>{
   try {
    const response=await fetch('https://rdap.verisign.com/net/v1/domain/bjjtournaments.net',{signal:AbortSignal.timeout(10000)});
    return response.ok?domainExpiry(await response.json()):{key:'domain_expiry',state:'unknown'};
   } catch {return {key:'domain_expiry',state:'unknown'};}
  })()
 ]);
}
