import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createApp} from '../server.mjs';
const source=readFileSync(new URL('../src/controller.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('let bootstrapRequest='),source.indexOf('async function post('));
const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
function browser(fetcher,csrf='old'){
  let fills=0;const context=vm.createContext({csrf,catalog:[{name:'Loaded'}],fetch:fetcher,fillCatalog:()=>fills++});vm.runInContext(helpers,context);return {context,fills:()=>fills};
}

test('expired browser checks reject before login, then a new bootstrap reconnects without admitting other browser owners',async()=>{
  let logins=0;const engine={metadata:new Map(),tick:async()=>{},stop(){},snapshot:()=>({}),login:async()=>logins++};
  const first=await createApp({port:0,fetchData:false,engine}),oldBase='http://127.0.0.1:'+first.server.address().port;
  let oldCookie,oldToken;
  try{const boot=await fetch(oldBase+'/api/bootstrap');oldCookie=boot.headers.get('set-cookie').split(';')[0];oldToken=(await boot.json()).csrf;}finally{await first.close();}
  const app=await createApp({port:0,fetchData:false,engine}),base='http://127.0.0.1:'+app.server.address().port;
  try{
    const old=await fetch(base+'/api/login',{method:'POST',headers:{Cookie:oldCookie,'X-Miscrits-CSRF':oldToken,'Content-Type':'application/json'},body:'{}'});
    assert.equal(old.status,403);assert.equal((await old.json()).code,'BROWSER_SESSION_STALE');assert.equal(logins,0);
    const boot=await fetch(base+'/api/bootstrap',{headers:{Cookie:oldCookie}}),cookie=boot.headers.get('set-cookie').split(';')[0],{csrf}=await boot.json();
    assert.notEqual(csrf,oldToken);const headers={Cookie:cookie,'X-Miscrits-CSRF':csrf,'Content-Type':'application/json'};
    assert.equal((await fetch(base+'/api/login',{method:'POST',headers,body:'{}'})).status,200);assert.equal(logins,1);
    const conflict=await fetch(base+'/api/bootstrap',{headers:{Cookie:oldCookie}});assert.equal(conflict.status,403);assert.equal((await conflict.json()).code,'BROWSER_OWNER_CONFLICT');
    assert.equal((await fetch(base+'/api/state',{headers})).status,200);
  }finally{await app.close();}
});

test('stale modern or legacy tabs refresh once, coalesce simultaneous recovery and keep the submitted form unchanged',async()=>{
  for(const legacy of [false,true]){
    const calls=[];let release;const gate=new Promise(resolve=>release=resolve);
    const {context}=browser(async(path,options)=>{
      calls.push([path,options]);
      if(path==='/api/bootstrap'){await gate;return response(200,{csrf:'fresh',catalog:[]});}
      return options.headers['X-Miscrits-CSRF']==='old'?response(403,legacy?{error:'Reopen the website to connect this browser session.'}:{code:'BROWSER_SESSION_STALE'}):response(200,{ok:true});
    });
    const one=context.api('settings',{names:['Flue']}),two=context.api('start',{});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.filter(c=>c[0]==='/api/bootstrap').length,1);release();await Promise.all([one,two]);
    const saves=calls.filter(c=>c[0]==='/api/settings');assert.equal(saves.length,2);assert.equal(saves[0][1].body,saves[1][1].body);assert.equal(saves[1][1].headers['X-Miscrits-CSRF'],'fresh');assert.equal(context.csrf,'fresh');
  }
});

test('network failures, game errors, foreign-origin rejection and repeated local rejection are not replayed in a loop',async()=>{
  for(const kind of ['network','game','foreign','still-stale']){
    let requests=0,boots=0;const {context}=browser(async(path)=>{
      if(path==='/api/bootstrap'){boots++;return response(200,{csrf:'fresh',catalog:[]});}
      requests++;if(kind==='network')throw new Error('Connection lost');
      if(kind==='game')return response(400,{error:'Game request timed out.'});
      if(kind==='foreign')return response(403,{error:'Local access only.'});
      return response(403,{code:'BROWSER_SESSION_STALE',error:'Still stale'});
    });
    await assert.rejects(()=>context.api('action',{kind:'capture'}));assert.equal(requests,kind==='still-stale'?2:1);assert.equal(boots,kind==='still-stale'?1:0);
  }
});

test('another browser owner yields actionable help and never takes over or sends login again',async()=>{
  let logins=0,boots=0;const {context}=browser(async(path)=>{
    if(path==='/api/bootstrap'){boots++;return response(403,{error:'This backend is already open in another browser session. Use that window or restart the website backend.'});}
    logins++;return response(403,{code:'BROWSER_SESSION_STALE'});
  });
  await assert.rejects(()=>context.api('login',{identity:'Example',password:'dummy value'}),/original window.*Stop Miscrits Website/);
  assert.equal(logins,1);assert.equal(boots,1);assert.equal(context.csrf,'old');
});

test('a failed first bootstrap can recover on a later login attempt and populates the species catalog once',async()=>{
  let boots=0,logins=0;const b=browser(async(path)=>{
    if(path==='/api/bootstrap'){boots++;return boots===1?response(503,{error:'Starting'}):response(200,{csrf:'fresh',catalog:[{name:'Flue'}]});}
    logins++;return response(200,{ok:true});
  },'');b.context.catalog=[];
  await assert.rejects(()=>b.context.bootstrapBrowser(),/Starting/);await b.context.api('login',{});await b.context.bootstrapBrowser();
  assert.equal(logins,1);assert.equal(b.fills(),1);assert.equal(b.context.catalog[0].name,'Flue');assert.equal(b.context.csrf,'fresh');
});

test('incomplete bootstrap never replaces the current token or submits an action',async()=>{
  let actions=0;const {context}=browser(async(path)=>{if(path==='/api/bootstrap')return response(200,{catalog:[]});actions++;return response(200,{ok:true});},'');
  await assert.rejects(()=>context.api('start',{}),/incomplete browser session/);assert.equal(context.csrf,'');assert.equal(actions,0);
});
