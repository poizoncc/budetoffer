import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installPairedCompanion } from '../apps/chrome-companion/background/bootstrap.js';
import { LOGIN_KEY, LOGIN_ALARM } from '../apps/chrome-companion/background/device-login.js';
import { ONBOARDING_KEY } from '../apps/chrome-companion/background/onboarding.js';
import { localControllerFactory } from '../apps/chrome-companion/src/popup/local-client.ts';

const ORIGIN = 'http://127.0.0.1:6971';
const DEVICE_KEY = 'chairs-companion-device-v1';
const CHECKPOINT_KEY = 'chairs-companion-checkpoint-v1';
const legal = {version:'2026-10-10',termsUrl:`${ORIGIN}/legal/terms`,privacyUrl:`${ORIGIN}/legal/privacy`};
const agreements = {adult:true,terms:true,privacy:true,computerAwake:true,version:'2026-10-10'};
const flush = async () => { for (let i=0;i<6;i++) await new Promise(resolve=>setImmediate(resolve)); };

function fixture() {
  let time = Date.parse('2026-10-10T10:00:00.000Z');
  const data: Record<string, any> = {};
  const alarms = new Map<string, object>();
  const requests: {url:string;options:RequestInit}[] = [];
  let onAlarm: Function, onStartup: Function, onMessage: Function;
  let approved = false, offline = false, expired = false, deviceId = 'device-first';
  let authenticatedStatus = 200;
  let startGate: Promise<void> | undefined, releaseStart: (() => void) | undefined;
  const chrome = {
    storage:{local:{async get(key:string){return {[key]:data[key]};},async set(value:object){Object.assign(data,value);},
      async remove(keys:string|string[]){for(const key of Array.isArray(keys)?keys:[keys])delete data[key];},
      async setAccessLevel(value:object){assert.deepEqual(value,{accessLevel:'TRUSTED_CONTEXTS'});}}},
    alarms:{async get(name:string){return alarms.get(name);},async create(name:string,value:object){alarms.set(name,value);},
      async clear(name:string){return alarms.delete(name);},onAlarm:{addListener(value:Function){onAlarm=value;}}},
    runtime:{id:'trusted-extension',getURL:(path:string)=>`chrome-extension://trusted-extension/${path}`,
      onStartup:{addListener(value:Function){onStartup=value;}},onInstalled:{addListener(){}},
      onMessage:{addListener(value:Function){onMessage=value;}}}
  };
  const credentials = () => ({deviceId,accessToken:'a'.repeat(43),expiresAt:new Date(time+86400000).toISOString()});
  const fetcher = async (url:unknown, options:RequestInit) => {
    requests.push({url:String(url),options});
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    if(offline)throw new Error('synthetic transport failure with no private data');
    if(String(url).endsWith('/start')) {
      if(startGate)await startGate;
      return Response.json({deviceCode:'d'.repeat(43),userCode:'4GN-5TY',expiresAt:new Date(time+600000).toISOString(),intervalSeconds:5});
    }
    if(String(url).endsWith('/poll'))return Response.json(expired?{state:'expired'}:approved?{state:'approved',...credentials()}:{state:'pending'});
    if(String(url).endsWith('/redeem'))return Response.json(credentials());
    if(authenticatedStatus!==200)return Response.json({error:'synthetic_auth_failure'},{status:authenticatedStatus});
    if(String(url).endsWith('/lease'))return Response.json({job:null});
    return Response.json({ready:false});
  };
  const install = (config:any=legal) => installPairedCompanion(chrome,fetcher as typeof fetch,{now:()=>time,onboardingConfig:config});
  const trusted = {id:'trusted-extension',url:chrome.runtime.getURL('popup/index.html')};
  return {data,alarms,requests,install,credentials,
    advance(ms:number){time+=ms;},approve(){approved=true;},offline(value:boolean){offline=value;},expire(){expired=true;},replace(){deviceId='device-replacement';},
    holdStart(){startGate=new Promise(resolve=>{releaseStart=resolve;});},releaseStart(){releaseStart?.();},
    authenticatedStatus(status:number){authenticatedStatus=status;},
    wake(name:string){onAlarm({name});},startup(){onStartup();},
    message(message:object,sender:object=trusted){return new Promise<any>((resolve,reject)=>{if(!onMessage(message,sender,resolve))reject(new Error('untrusted_message'));});}
  };
}

test('device login completes on an alarm without a popup, but cannot start HH work before all agreements',async()=>{
  const f=fixture(),worker=f.install();await flush();
  const result=await f.message({type:'chairs:start-device-login',origin:ORIGIN,label:'Synthetic Chrome'});
  assert.equal(result.paired,false);assert.deepEqual(result.pendingLogin,{userCode:'4GN-5TY',verificationUri:`${ORIGIN}/#companion-connect=4GN-5TY`,expiresAt:f.data[LOGIN_KEY].expiresAt,phoneReachable:false});
  assert.ok(!JSON.stringify(result).includes('d'.repeat(43)));assert.deepEqual(f.alarms.get(LOGIN_ALARM),{periodInMinutes:0.5});
  f.approve();f.advance(30000);f.wake(LOGIN_ALARM);await flush();
  assert.equal(f.data[DEVICE_KEY].deviceId,'device-first');assert.equal(f.alarms.has(LOGIN_ALARM),false);
  const status=await worker.status();assert.equal(status.paired,true);assert.equal(status.onboardingRequired,true);
  assert.ok(!JSON.stringify(status).includes('a'.repeat(43)));
  f.wake('chairs-companion-poll');await flush();assert.equal(f.requests.length,2);
  await assert.rejects(worker.acceptOnboarding({...agreements,adult:false}),/onboarding_required/);
  await assert.rejects(worker.acceptOnboarding({...agreements,computerAwake:false}),/onboarding_required/);
  await assert.rejects(worker.acceptOnboarding({...agreements,version:'2026-10-09'}),/onboarding_required/);
  assert.equal(f.data[ONBOARDING_KEY],null);
  await worker.acceptOnboarding(agreements);f.wake('chairs-companion-poll');await flush();
  assert.equal((await worker.status()).onboardingRequired,false);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/heartbeat')).length,1);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/lease')).length,1);
  assert.equal(f.requests.some(r=>r.url.endsWith('/authorize-mutation')),false);
});

test('pending challenge and alarms survive worker recreation; status refresh respects the persisted poll interval',async()=>{
  const f=fixture();f.install();await flush();await f.message({type:'chairs:start-device-login',origin:ORIGIN,label:'Synthetic Chrome'});
  await f.message({type:'chairs:device-status'});assert.equal(f.requests.length,1);
  f.alarms.clear();f.advance(30000);const replacement=f.install();await flush();
  assert.ok(f.alarms.has(LOGIN_ALARM));assert.ok(f.alarms.has('chairs-companion-poll'));
  assert.equal(f.requests.filter(r=>r.url.endsWith('/poll')).length,1);
  await f.message({type:'chairs:device-status'});await f.message({type:'chairs:device-status'});
  assert.equal(f.requests.filter(r=>r.url.endsWith('/poll')).length,1);
  f.approve();f.advance(5000);await f.message({type:'chairs:device-status'});
  assert.equal((await replacement.status()).onboardingRequired,true);
  assert.equal(f.requests.some(r=>r.url.endsWith('/lease')),false);
});

test('short manual code excludes ambiguous characters, supports lowercase, and retains legacy 43-character redemption',async()=>{
  const f=fixture(),worker=f.install();await flush();
  for(const code of ['0GN-5TY','OGN-5TY','1GN-5TY','IGN-5TY','LGN-5TY','4GN--5TY','4GN 5TY']) {
    await assert.rejects(worker.pair({origin:ORIGIN,code,label:'Synthetic'}),/invalid_pairing/);
  }
  await worker.pair({origin:ORIGIN,code:'4gn5ty',label:'Synthetic'});
  assert.equal(JSON.parse(String(f.requests[0].options.body)).code,'4GN-5TY');
  await worker.pair({origin:ORIGIN,code:'l'.repeat(43),label:'Legacy'});
  assert.equal(JSON.parse(String(f.requests[1].options.body)).code,'l'.repeat(43));
  assert.equal(f.requests.length,2);
});

test('each replacement requires fresh agreements and never clears an uncertain mutation checkpoint',async()=>{
  const f=fixture(),worker=f.install();await flush();
  const checkpoint={jobId:'uncertain',phase:'authorized',leaseToken:'old-secret',payloadHash:'a'.repeat(64),deviceId:'old',origin:ORIGIN};
  f.data[CHECKPOINT_KEY]=checkpoint;
  await worker.pair({origin:ORIGIN,code:'4GN-5TY',label:'Synthetic'});await worker.acceptOnboarding(agreements);
  f.replace();await worker.pair({origin:ORIGIN,code:'4GN-5TY',label:'Replacement'});
  assert.deepEqual(f.data[CHECKPOINT_KEY],checkpoint);assert.equal((await worker.status()).onboardingRequired,true);
  assert.equal((await worker.status()).requiresReconciliation,true);await worker.tick();assert.equal(f.requests.length,2);
  await f.message({type:'chairs:disconnect-device'});
  assert.deepEqual(f.data[CHECKPOINT_KEY],checkpoint);assert.equal(f.data[DEVICE_KEY],undefined);assert.equal(f.data[ONBOARDING_KEY],undefined);
});

test('only the exact extension popup can start login, accept onboarding, or read status',async()=>{
  const f=fixture();f.install();await flush();
  for(const sender of [{id:'foreign-extension',url:'chrome-extension://trusted-extension/popup/index.html'},
    {id:'trusted-extension',url:'https://hh.ru/vacancy/123'}, {id:'trusted-extension',url:'chrome-extension://trusted-extension/popup/index.html#forged'}]) {
    for(const type of ['chairs:start-device-login','chairs:accept-onboarding','chairs:device-status'])await assert.rejects(f.message({type,origin:ORIGIN,label:'Synthetic',...agreements},sender),/untrusted_message/);
  }
  assert.equal(f.requests.length,0);
});

test('offline pending login reports a safe error and resumes from the alarm; an expired challenge requires a new code',async()=>{
  const f=fixture(),worker=f.install();await flush();await worker.startLogin({origin:ORIGIN,label:'Synthetic'});
  f.offline(true);f.advance(30000);f.wake(LOGIN_ALARM);await flush();
  assert.match((await worker.status()).backgroundError,/Сервер недоступен/);assert.ok(f.data[LOGIN_KEY]);
  f.offline(false);f.approve();f.advance(30000);f.wake(LOGIN_ALARM);await flush();
  assert.equal((await worker.status()).paired,true);assert.equal((await worker.status()).backgroundError,undefined);
  await f.message({type:'chairs:disconnect-device'});await worker.startLogin({origin:ORIGIN,label:'Another synthetic'});
  f.expire();f.advance(30000);f.wake(LOGIN_ALARM);await flush();
  assert.equal((await worker.status()).pendingLogin,undefined);assert.match((await worker.status()).backgroundError,/истёк/);assert.equal(f.alarms.has(LOGIN_ALARM),false);
});

test('unconfigured legal texts cannot be accepted, and a connected device cannot silently be replaced by QR login',async()=>{
  const f=fixture(),worker=f.install({...legal,termsUrl:null});await flush();await worker.pair({origin:ORIGIN,code:'4GN-5TY',label:'Synthetic'});
  await assert.rejects(worker.acceptOnboarding(agreements),/onboarding_required/);
  await assert.rejects(worker.startLogin({origin:ORIGIN,label:'Replacement'}),/companion_busy/);
  assert.equal((await worker.status()).onboardingRequired,true);assert.equal(f.requests.length,1);
});
test('simultaneous popup login requests create only one durable challenge',async()=>{
  const f=fixture(),worker=f.install();await flush();f.holdStart();
  const first=worker.startLogin({origin:ORIGIN,label:'First'});
  const second=assert.rejects(worker.startLogin({origin:ORIGIN,label:'Second'}),/companion_busy/);
  await flush();assert.equal(f.requests.length,1);f.releaseStart();await first;await second;
  assert.equal(f.requests.length,1);assert.equal(f.data[LOGIN_KEY].userCode,'4GN-5TY');
});
test('server authentication revocation removes pairing and agreements while preserving the uncertain checkpoint',async()=>{
  const f=fixture(),worker=f.install();await flush();await worker.pair({origin:ORIGIN,code:'4GN-5TY',label:'Synthetic'});await worker.acceptOnboarding(agreements);
  let localReads=0;
  const localApi={runtime:{getURL:(path:string)=>new URL(`../apps/chrome-companion/${path}`,import.meta.url).href,
    sendMessage:async()=>({ok:true,...await worker.status()})},tabs:{query:async()=>[{id:1,url:'https://hh.ru/vacancy/123'}],sendMessage:async()=>({url:'https://hh.ru/vacancy/123'})},scripting:{executeScript:async()=>{throw new Error('unexpected_local_injection');}}};
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{localReads++;return Response.json({applications:[]});};
  let local;
  try {local=await localControllerFactory(localApi,ORIGIN)(()=>{});} finally {globalThis.fetch=originalFetch;}
  const checkpoint={jobId:'uncertain',phase:'authorized',leaseToken:'old-secret',payloadHash:'a'.repeat(64),deviceId:'device-first',origin:ORIGIN};
  f.data[CHECKPOINT_KEY]=checkpoint;f.authenticatedStatus(401);await worker.tick();
  const status=await worker.status();assert.equal(status.paired,false);assert.equal(status.origin,null);assert.equal(status.requiresReconciliation,true);assert.match(status.backgroundError,/отозвано/);
  assert.equal(f.data[DEVICE_KEY],undefined);assert.equal(f.data[ONBOARDING_KEY],undefined);assert.deepEqual(f.data[CHECKPOINT_KEY],checkpoint);
  await assert.rejects(worker.acceptOnboarding(agreements),/device_not_paired/);
  await assert.rejects(local.load(),/подтвердите условия/);assert.equal(localReads,0);
  const requests=f.requests.length;await worker.tick();assert.equal(f.requests.length,requests);
  assert.equal(f.requests.some(request=>request.url.endsWith('/lease')||request.url.endsWith('/receipts')),false);
});
test('missing execution rights do not revoke pairing or inherit a terminal checkpoint state',async()=>{
  const f=fixture(),worker=f.install();await flush();await worker.pair({origin:ORIGIN,code:'4GN-5TY',label:'Synthetic'});await worker.acceptOnboarding(agreements);
  f.authenticatedStatus(403);await assert.rejects(worker.tick(),/companion_http_403/);
  assert.equal((await worker.status()).paired,true);assert.equal((await worker.status()).onboardingRequired,false);
  assert.ok(f.data[DEVICE_KEY]);assert.ok(f.data[ONBOARDING_KEY]);
});
