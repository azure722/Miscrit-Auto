import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
test('local server serves UI, validates browser session and rejects foreign origins and paths',async()=>{
  const engine={config:{},snapshot:()=>({connected:false}),tick:async()=>{},stop(){},updateConfig(){},metadata:new Map()};
  const app=await createApp({port:0,fetchData:false,engine});
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const root=await fetch(base);assert.equal(root.status,200);assert.match(await root.text(),/Field Station/);assert.match(root.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    const health=await fetch(base+'/api/health');assert.equal(health.status,200);
    assert.deepEqual(await health.json(),{app:'miscrits-browser',version:17,needsGame:false,connected:false,reconnecting:false,running:false,busy:false,activeBattle:false});
    assert.equal((await fetch(base+'/api/state')).status,403);
    assert.equal((await fetch(base+'/api/bootstrap',{headers:{Origin:'https://evil.example'}})).status,403);
    const boot=await fetch(base+'/api/bootstrap');const cookie=boot.headers.get('set-cookie').split(';')[0];const {csrf,catalog}=await boot.json();assert.ok(catalog.length>400);
    const headers={Cookie:cookie,'X-Miscrits-CSRF':csrf,'Content-Type':'application/json'};
    assert.equal((await fetch(base+'/api/state',{headers})).status,200);
    assert.equal((await fetch(base+'/api/settings',{method:'POST',headers,body:'{}'})).status,200);
    assert.equal((await fetch(base+'/api/settings',{method:'POST',headers:{...headers,'X-Miscrits-CSRF':'bad'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/lib/engine.mjs')).status,404);
    assert.equal((await fetch(base+'/data/settings.json')).status,404);
    assert.equal((await fetch(base+'/api/unknown',{method:'POST',headers,body:'{}'})).status,404);
    for(const asset of ['/app.js','/style.css','/mark.svg']) assert.equal((await fetch(base+asset)).status,200);
    assert.equal((await fetch(base+'/api/bootstrap')).status,403);
  }finally{await app.close();}
});

test('browser owner cookie persists across browser restarts, renews on reopen and preserves owner isolation',async()=>{
  const engine={snapshot:()=>({connected:true}),tick:async()=>{},stop(){},metadata:new Map()};
  const app=await createApp({port:0,fetchData:false,engine}),base='http://127.0.0.1:'+app.server.address().port;
  try{
    const boot=await fetch(base+'/api/bootstrap'),setCookie=boot.headers.get('set-cookie'),cookie=setCookie.split(';')[0],{csrf}=await boot.json();
    assert.match(setCookie,/Max-Age=604800/);assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);
    const reopened=await fetch(base+'/api/bootstrap',{headers:{Cookie:cookie}});
    assert.equal(reopened.status,200);assert.equal(reopened.headers.get('set-cookie').split(';')[0],cookie);assert.match(reopened.headers.get('set-cookie'),/Max-Age=604800/);
    assert.equal((await reopened.json()).csrf,csrf);
    assert.equal((await fetch(base+'/api/state',{headers:{Cookie:cookie,'X-Miscrits-CSRF':csrf}})).status,200);
    assert.equal((await fetch(base+'/api/bootstrap',{headers:{Cookie:'mc_owner=foreign'}})).status,403);
  }finally{await app.close();}
});
