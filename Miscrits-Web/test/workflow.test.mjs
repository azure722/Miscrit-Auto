import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Engine} from '../lib/engine.mjs';
import {GameError} from '../lib/transport.mjs';
import {settings} from '../lib/model.mjs';
import {SessionStats,targetQueue,nextSearchStop,huntNames,stopAdvice} from '../lib/workflow.mjs';
import {createApp} from '../server.mjs';
const catalog={teleports:{forest:{},moon:{ticket:'moon'}},species:[{id:1,name:'Flue',rarity:'Exotic',stops:[{location:'forest',area_id:1,object_id:1,days:[]}]},{id:2,name:'Moon target',rarity:'Rare',stops:[{location:'moon',area_id:1,object_id:2,days:[]}]}]};
const protocol=JSON.parse(readFileSync(new URL('../data/protocol.json',import.meta.url)));
const crit=(id,exp=0)=>({id,mId:1,level:1,exp,hp:3,spd:3,ea:3,ed:3,pa:3,pd:3,chp:40});
function harness(config={}){
  const player={user_id:'me',team_order:[1,2],miscrits:[crit(1),crit(2)],virtue:100,level:1000,left_traits:[],area:{area_id:1,location:{name:'Forest'}},battle:''};
  const calls=[],responses={},savedProfiles=[];
  const engine=new Engine({catalog,protocol,config:{names:['Flue'],mode:'capture_any',...config},saveProfiles:value=>savedProfiles.push(structuredClone(value))});
  engine.player=structuredClone(player);engine.running=true;
  engine.transport={connected:true,rpc:async(id,payload)=>{calls.push([id,payload]);if(responses[id])return responses[id](payload);if(id==='get_player')return structuredClone(player);if(id==='heal_team'){player.virtue-=10;player.miscrits.forEach(m=>m.chp=40);}return {};},join:async()=>{},leave:async()=>{},send(...args){calls.push(['send',...args]);}};
  return {engine,player,calls,responses,savedProfiles};
}
test('wild healing options are bounded, opt-in and notification preferences validated',()=>{
  const value=settings({},catalog);assert.equal(value.wildAutoHeal,false);assert.equal(value.wildHealBudget,30);assert.equal(value.notifyEvents,true);
  for(const config of [{wildAutoHeal:'yes'},{wildHealBudget:-1},{wildHealBudget:1001},{wildHealBudget:9.5},{notifyEvents:'yes'}])assert.throws(()=>settings(config,catalog));
});

test('manual priority persists canonically in settings and profiles; removed names clear the primary target',()=>{
  const value=settings({names:['Moon target','Flue'],primaryTarget:'flue'},catalog);
  assert.equal(value.primaryTarget,'Flue');assert.deepEqual(value.names,['Moon target','Flue']);
  assert.equal(settings({...value,names:['Moon target']},catalog).primaryTarget,'');
  assert.equal(settings({},catalog).primaryTarget,'');assert.throws(()=>settings({primaryTarget:17},catalog));
  const {engine}=harness();engine.stop();engine.saveProfile('Priority',value);engine.loadProfile('Priority');
  assert.equal(engine.config.primaryTarget,'Flue');assert.deepEqual(engine.config.names,value.names);
  assert.deepEqual(huntNames({...value,replacementNames:['Flue']},{needsCapture:['Flue','Other']}),['Moon target','Flue','Other']);
});

test('primary searches take priority across the cursor but yield to ready fallback objects during cooldown',()=>{
  const config={primaryTarget:'Flue'},stops=[{key:'fallback',targets:[2]},{key:'main-a',targets:[1]},{key:'main-b',targets:[1]}],cooldowns=new Map();
  const args={config,catalog,stops,cooldowns,cursor:0,now:1000};
  let next=nextSearchStop(args);assert.equal(next.stop.key,'main-a');assert.equal(next.nextCursor,2);
  cooldowns.set('main-a',2000);next=nextSearchStop({...args,cursor:next.nextCursor});assert.equal(next.stop.key,'main-b');
  cooldowns.set('main-b',2000);assert.equal(nextSearchStop(args).stop.key,'fallback');
  cooldowns.set('fallback',2000);assert.equal(nextSearchStop(args).stop,null);
  assert.equal(nextSearchStop({...args,now:2000}).stop.key,'main-a');
  assert.equal(nextSearchStop({...args,config:{primaryTarget:''},cooldowns:new Map()}).stop.key,'fallback');
  assert.equal(nextSearchStop({...args,stops:[]}).stop,null);
});

test('saved target ordering and primary flag predict the actual next search and clear after confirmed keep',async()=>{
  const {engine,player,calls}=harness({names:['Moon target','Flue'],primaryTarget:'Flue',replacementNames:['Flue']});player.tickets={moon:1};engine.player.tickets={moon:1};
  assert.equal(engine.snapshot().queue.next.object,1);assert.equal(engine.snapshot().queue.targets.find(t=>t.name==='Flue').primary,true);
  await engine.tick();assert.equal(calls.find(c=>c[0]==='create_battle')[1].payload.objectId,1);
  assert.equal(engine.snapshot().queue.next.object,2);
  engine.removeCapturedTarget({mId:1});assert.equal(engine.config.primaryTarget,'');assert.deepEqual(engine.config.names,['Moon target']);assert.deepEqual(engine.config.replacementNames,['Flue']);
  const reordered=harness({names:['Moon target','Flue']});reordered.player.tickets={moon:1};reordered.engine.player.tickets={moon:1};
  await reordered.engine.tick();assert.equal(reordered.calls.find(c=>c[0]==='create_battle')[1].payload.objectId,2);
});

test('stop reports retain raw reason and request context after status changes and a later restart',()=>{
  const {engine}=harness();engine.currentSearch={location:'forest',area_id:1,object_id:1};
  const error=new GameError('The game server rejected the request.');error.rpcId='create_battle';engine.fail(error);
  assert.equal(engine.running,false);const report=structuredClone(engine.snapshot().lastStop);
  assert.equal(report.message,error.message);assert.equal(report.rpcId,'create_battle');assert.deepEqual(report.location,{map:'forest',area:1,object:1});assert.ok(report.action);assert.equal(report.resumedAt,null);
  engine.log('Account refreshed.');assert.deepEqual(engine.snapshot().lastStop,report);
  engine.start();assert.equal(engine.lastStop.message,error.message);assert.ok(engine.lastStop.resumedAt);
  engine.stop();assert.equal(engine.lastStop.category,'Paused by user');assert.equal(engine.lastStop.resumedAt,null);
});

test('failed map movement reports the attempted destination instead of the previous search',async()=>{
  const {engine,player,responses}=harness();player.area={area_id:9,location:{name:'Moon'}};engine.player.area=player.area;engine.currentSearch={location:'moon',area_id:9,object_id:9};
  responses.update_location=()=>{const error=new GameError('Map unavailable');error.rpcId='update_location';throw error;};
  await engine.tick();assert.equal(engine.running,false);assert.equal(engine.lastStop.category,'Search location');
  assert.deepEqual(engine.lastStop.location,{map:'forest',area:1,object:1});assert.match(engine.lastStop.message,/Moving to forest/);
});

test('stop advice distinguishes manual pause, known recovery steps and unresolved actions without replay',()=>{
  for(const [message,category]of [['Wild healing budget exhausted','Healing budget'],['Insufficient virtue','Insufficient virtue'],['Session expired. Sign in again.','Account session'],['Connection closed','Connection'],['Selected Miscrit found. Battle paused for manual play.','Manual battle needed'],['No available search locations today','Search location'],['Unable to load collection index','Collection index'],['All hunt targets collected','Run complete or limit reached']])assert.equal(stopAdvice(message).category,category);
  const {engine}=harness();engine.battle={type:'Wild',awaitingAction:true};engine.player=null;engine.disconnected('Connection closed');
  assert.equal(engine.lastStop.category,'Uncertain action');assert.equal(engine.lastStop.uncertain,true);assert.match(engine.lastStop.action,/Do not repeat/);assert.equal(engine.lastStop.battle,'Wild');
  assert.throws(()=>engine.start());
});

test('target controls reorder unsaved choices, toggle the primary and preserve the training list',()=>{
  const source=readFileSync(new URL('../src/controller.js',import.meta.url),'utf8');
  const helpers=source.slice(source.indexOf('function removeName('),source.indexOf('function renderLists('));let renders=0;
  const ctx=vm.createContext({draft:{names:['Flue','Moon target'],primaryTarget:'',replacementNames:['Flue']},dirty:false,renderLists:()=>renders++,document:{querySelector:()=>null}});
  vm.runInContext(helpers,ctx);ctx.togglePrimary('Flue');ctx.moveTarget('Flue',1);
  assert.deepEqual([...ctx.draft.names],['Moon target','Flue']);assert.equal(ctx.draft.primaryTarget,'Flue');assert.equal(ctx.dirty,true);
  ctx.moveTarget('Flue',1);assert.equal(renders,2);ctx.togglePrimary('Flue');assert.equal(ctx.draft.primaryTarget,'');
  ctx.togglePrimary('Flue');ctx.removeName('names','Flue');assert.equal(ctx.draft.primaryTarget,'');assert.deepEqual([...ctx.draft.replacementNames],['Flue']);
});

test('stop report renders exact reasons safely as text with separate guidance and resumed status',()=>{
  const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{textContent:'',classList:{toggle(){}}});return elements.get(id);};
  const source=readFileSync(new URL('../src/controller.js',import.meta.url),'utf8'),helper=source.slice(source.indexOf('function renderStopReport('),source.indexOf('function renderWorkflow('));
  const ctx=vm.createContext({$,state:{lastStop:null}});vm.runInContext(helper,ctx);ctx.renderStopReport();assert.equal($('stop-report-details').hidden,true);
  ctx.state.lastStop={time:new Date().toISOString(),message:'<img src=x> rejected',category:'Game request failed',action:'Check Live battle',rpcId:'create_battle',activity:'wild',location:{map:'forest',area:1,object:0},resumedAt:'now'};
  ctx.renderStopReport();assert.equal($('stop-report-reason').textContent,'<img src=x> rejected');assert.equal($('stop-report-state').textContent,'Resumed since this stop');assert.match($('stop-report-context').textContent,/object 0.*create_battle/);assert.equal($('stop-report-action').textContent,'Check Live battle');
});
test('wild healing occurs once before another search, confirms HP and preserves late pause',async()=>{
  const {engine,player,calls,responses}=harness({wildAutoHeal:true,wildHealBudget:10});player.miscrits[0].chp=0;let release;
  responses.heal_team=()=>new Promise(resolve=>release=()=>{player.miscrits[0].chp=40;player.virtue-=10;resolve({});});
  const pending=engine.tick();await new Promise(resolve=>setImmediate(resolve));await engine.tick();engine.stop();release();await pending;
  assert.equal(calls.filter(c=>c[0]==='heal_team').length,1);assert.equal(calls.some(c=>c[0]==='create_battle'),false);assert.equal(engine.player.miscrits[0].chp,40);
  assert.equal(engine.wildHealingSpent,10);assert.equal(engine.stats.heals,1);assert.equal(engine.running,false);
});
test('healthy team, insufficient virtue and exhausted wild budgets never send an unintended heal',async()=>{
  for(const scenario of ['healthy','virtue','budget']){
    const {engine,player,calls}=harness({wildAutoHeal:true,wildHealBudget:scenario==='budget'?9:30});
    if(scenario!=='healthy')player.miscrits[0].chp=0;if(scenario==='virtue')player.virtue=9;
    await engine.tick();assert.equal(calls.some(c=>c[0]==='heal_team'),false);if(scenario!=='healthy'){assert.equal(engine.running,false);assert.equal(calls.some(c=>c[0]==='create_battle'),false);}
  }
});
test('uncertain healing reserves budget without replay; rejected healing releases reservation; stale HP blocks restarting',async()=>{
  for(const scenario of ['uncertain','reject','stale']){
    const {engine,player,calls,responses}=harness({wildAutoHeal:true,wildHealBudget:10});player.miscrits[0].chp=0;
    responses.heal_team=()=>{if(scenario==='stale')return {};throw new GameError('Heal failed',scenario==='uncertain');};
    await engine.tick();await engine.tick();assert.equal(calls.filter(c=>c[0]==='heal_team').length,1);assert.equal(engine.running,false);
    assert.equal(engine.wildHealingSpent,scenario==='reject'?0:10);assert.equal(engine.uncertain,scenario!=='reject');
    assert.equal(calls.some(c=>c[0]==='create_battle'),false);
  }
});
test('resetting session counters does not restore the virtue budget and is blocked during activity',()=>{
  const {engine}=harness();engine.wildHealingSpent=20;assert.throws(()=>engine.resetStats(),/Pause/);
  engine.stop();engine.stats.captures=5;engine.resetStats();assert.equal(engine.stats.captures,0);assert.equal(engine.wildHealingSpent,20);
  engine.battle={};assert.throws(()=>engine.resetStats(),/finish the battle/);
});
test('profiles save independent preferences, overwrite by name, survive reload and never auto-start',()=>{
  const {engine,savedProfiles}=harness();engine.stop();engine.saveProfile('  Exotic hunt  ',{...engine.config,wildHealBudget:20});
  engine.saveProfile('exotic HUNT',{...engine.config,wildHealBudget:10});assert.equal(engine.profiles.length,1);assert.equal(savedProfiles.length,2);
  engine.loadProfile('exotic HUNT');assert.equal(engine.config.wildHealBudget,10);assert.equal(engine.running,false);
  const restored=new Engine({catalog,protocol,profiles:engine.profiles});assert.equal(restored.profiles[0].config.wildHealBudget,10);
  engine.profiles[0].config.names.push('Moon target');assert.deepEqual(engine.config.names,['Flue']);
  engine.deleteProfile('exotic HUNT');assert.equal(engine.profiles.length,0);
});
test('profile validation, limits, load guards and failed writes preserve the current configuration',()=>{
  const {engine}=harness();for(const name of ['', 'x'.repeat(49),'bad\nname'])assert.throws(()=>engine.saveProfile(name));
  engine.saveProfile('A');assert.throws(()=>engine.loadProfile('A'),/Pause/);engine.stop();
  engine.battle={};assert.throws(()=>engine.loadProfile('A'),/Finish/);engine.battle=null;
  for(let i=1;i<20;i++)engine.saveProfile('Profile '+i);assert.throws(()=>engine.saveProfile('Overflow'),/20/);
  engine.saveProfiles=()=>{throw new Error('Disk full');};assert.throws(()=>engine.deleteProfile('A'),/Disk full/);assert.equal(engine.profiles.length,20);
});
test('target queue predicts the same next object without changing cursor or cooldowns and explains unavailable targets',()=>{
  const {engine,player}=harness({names:['Flue','Moon target']});
  const args={config:engine.config,player,catalog,metadata:engine.metadata,index:{},cooldowns:engine.cooldowns,cursor:0,now:1000};
  let queue=targetQueue(args);assert.equal(queue.next.object,1);assert.equal(queue.targets.find(t=>t.name==='Moon target').status,'unavailable');
  engine.cooldowns.set('forest:1:1',9000);queue=targetQueue(args);assert.equal(queue.next,null);assert.equal(queue.targets[0].waitSeconds,8);
  assert.equal(engine.cursor,0);assert.equal(engine.cooldowns.get('forest:1:1'),9000);
  queue=targetQueue({...args,config:{...engine.config,activity:'campaign'}});assert.match(queue.message,/Campaign/);
});
test('capture stats count confirmed keeps once, classify duplicates and alert on 17+ only',async()=>{
  const {engine}=harness();await engine.join('b');
  const data={type:'Wild',player1:{user_id:'me',miscrits:[{id:1,mId:1,name:'Flue',level:1,hp:100,chp:100}]},player2:{user_id:'Wild',miscrits:[{id:9,mId:1,name:'Flue',level:1,hp:100,chp:100,rating:17}]},next_turn:'me',capture_chance:90};
  engine.running=false;await engine.receive('b',0,data);await engine.receive('b',0,data);assert.equal(engine.stats.encounters,1);
  await engine.receive('b',10,{user_id:'me',captured:true,pending:true});assert.equal(engine.stats.captures,0);
  await engine.receive('b',11,{user_id:'me',actions:[]});await engine.receive('b',11,{user_id:'me',actions:[]});
  assert.equal(engine.stats.captures,1);assert.equal(engine.stats.duplicates,1);assert.equal(engine.stats.qualifiedCaptures,1);assert.equal(engine.alerts.filter(a=>a.kind==='capture').length,1);
});
test('battle statistics use only own authoritative team XP and count a finished battle once',async()=>{
  const {engine}=harness();engine.battle={id:'b',type:'Wild',winner:'me',player:{miscrits:[{id:1},{id:2}]} };
  await engine.finish('ended',{me:{updates:{1:10,2:5,999:999}},opponent:{updates:{1:500}}});await engine.finish('ended',{});
  assert.equal(engine.stats.xpAwarded,15);assert.equal(engine.stats.battlesWon,1);
});
test('notifications are bounded and disabled preferences suppress further backend alerts',()=>{
  const {engine}=harness();for(let i=0;i<110;i++)engine.notify('test','Message '+i);assert.equal(engine.alerts.length,100);assert.equal(engine.alerts[0].id,110);
  engine.config.notifyEvents=false;engine.notify('test','Muted');assert.equal(engine.alerts[0].id,110);
  const stats=new SessionStats();assert.equal(stats.snapshot().captures,0);assert.ok(stats.snapshot().elapsedSeconds>=0);
});
test('frontend notification polling does not replay historic alerts and emits each new ID once',()=>{
  const source=readFileSync(new URL('../src/controller.js',import.meta.url),'utf8');const helper=source.slice(source.indexOf('function freshAlerts('),source.indexOf('function consumeAlerts('));
  const ctx=vm.createContext({});vm.runInContext(helper,ctx);const next={config:{notifyEvents:true},alerts:[{id:2},{id:1}]};
  assert.equal(ctx.freshAlerts(null,next).length,0);assert.deepEqual([...ctx.freshAlerts({alerts:[{id:1}]},next)].map(a=>a.id),[2]);
  assert.equal(ctx.freshAlerts(next,next).length,0);next.config.notifyEvents=false;assert.equal(ctx.freshAlerts({alerts:[]},next).length,0);
});
test('workflow HTTP actions keep the same owner cookie, CSRF and origin checks',async()=>{
  const actions=[];const engine={snapshot:()=>({}),tick:async()=>{},stop(){},metadata:new Map(),saveProfile:(...args)=>actions.push(['save',...args]),loadProfile:name=>actions.push(['load',name]),deleteProfile:name=>actions.push(['delete',name]),resetStats:()=>actions.push(['reset'])};
  const app=await createApp({port:0,fetchData:false,engine}),base='http://127.0.0.1:'+app.server.address().port;
  try{
    const boot=await fetch(base+'/api/bootstrap'),cookie=boot.headers.get('set-cookie').split(';')[0],{csrf}=await boot.json();const headers={Cookie:cookie,'X-Miscrits-CSRF':csrf,'Content-Type':'application/json'};
    for(const endpoint of ['profiles/save','profiles/load','profiles/delete','stats/reset']){assert.equal((await fetch(base+'/api/'+endpoint,{method:'POST',headers,body:JSON.stringify({name:'Example',config:{}})})).status,200);}
    assert.equal(actions.length,4);assert.equal((await fetch(base+'/api/profiles/save',{method:'POST',headers:{...headers,'X-Miscrits-CSRF':'invalid'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/data/profiles.json')).status,404);
  }finally{await app.close();}
});
test('notification polling sends only newly arrived alerts after explicit browser enablement and never requests permission itself',()=>{
  const source=readFileSync(new URL('../src/controller.js',import.meta.url),'utf8');const helpers=source.slice(source.indexOf('function freshAlerts('),source.indexOf("$('profile-list').addEventListener"));
  const popped=[],toasts=[];class Notification{static permission='granted';constructor(title,options){popped.push(options.body);}}
  const context=vm.createContext({browserAlertsEnabled:false,Notification,toast:message=>toasts.push(message)});vm.runInContext(helpers,context);
  const previous={alerts:[{id:1}]},next={config:{notifyEvents:true},alerts:[{id:2,message:'Capture kept'}]};
  context.consumeAlerts(previous,next);assert.equal(popped.length,0);assert.deepEqual(toasts,['Capture kept']);
  context.browserAlertsEnabled=true;context.consumeAlerts(previous,next);assert.deepEqual(popped,['Capture kept']);
  context.consumeAlerts(next,next);assert.equal(popped.length,1);
});
test('queue object prediction matches the next actual search request and changes across cooldowns',async()=>{
  const {engine,calls}=harness();const before=engine.snapshot().queue;assert.equal(before.next.object,1);
  await engine.tick();assert.deepEqual(calls.find(c=>c[0]==='create_battle')[1].payload,{objectId:before.next.object});
  const after=engine.snapshot().queue;assert.equal(after.current.object,1);assert.equal(after.next,null);assert.equal(after.targets[0].status,'cooldown');
  assert.equal(engine.stats.searches,1);
});
test('campaign healing remains independent of the disabled or exhausted wild budget',async()=>{
  const {engine,player,calls,responses}=harness({activity:'campaign',wildAutoHeal:false,wildHealBudget:0});player.miscrits.forEach(m=>m.chp=0);engine.wildHealingSpent=30;
  responses.get_campaign=()=>({last_completed:0,tries:0});responses.create_battle=()=>({matchId:'campaign'});
  await engine.tick();assert.equal(calls.filter(c=>c[0]==='heal_team').length,1);assert.equal(engine.wildHealingSpent,30);assert.equal(engine.stats.virtueSpent,10);
});
test('a stale profile collection on disk skips invalid credentials and settings rather than exposing raw stored values',()=>{
  const profiles=[{name:'Broken',config:{mode:'bad',password:'secret'}},{name:'Valid',config:{names:['Flue'],identity:'private',password:'secret'}}];
  const engine=new Engine({catalog,protocol,profiles});assert.equal(engine.profiles.length,1);assert.equal(engine.profiles[0].name,'Valid');
  assert.equal(JSON.stringify(engine.profiles).includes('secret'),false);assert.equal(JSON.stringify(engine.snapshot().profiles).includes('private'),false);
});
test('workflow renders the backend queue, profiles, budget, counters and recent alerts together',()=>{
  class Element{constructor(tag='div',css='',text=''){Object.assign(this,{tag,className:css,textContent:text,children:[],value:'Example'});}append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}setAttribute(){}addEventListener(){}}
  const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const source=readFileSync(new URL('../src/controller.js',import.meta.url),'utf8'),helpers=source.slice(source.indexOf('function workflowDuration('),source.indexOf('function freshAlerts('));
  const ctx=vm.createContext({$,posting:false,browserAlertsEnabled:false,element:(...args)=>new Element(...args),state:{running:false,busy:false,battle:null,reconnecting:false,queue:{message:'Waiting',current:{label:'Flue'},next:{location:'forest',area:1,object:0,targets:['Flue']},targets:[{name:'Flue',reason:'Cooling down',status:'cooldown',waitSeconds:5}]},config:{wildHealBudget:30},wildHealingSpent:10,sessionStats:{searches:2,captures:1,elapsedSeconds:65},profiles:[{name:'Example'}],alerts:[{id:1,time:new Date().toISOString(),message:'Captured'}]}});
  vm.runInContext(helpers+';renderWorkflow();',ctx);
  assert.match($('queue-next').textContent,/forest.*object 0.*Flue/);assert.equal($('queue-list').children.length,1);
  assert.equal($('profile-list').value,'Example');assert.equal($('profile-load').disabled,false);assert.match($('wild-heal-usage').textContent,/10 \/ 30/);
  assert.equal($('workflow-alerts').children.length,1);assert.ok($('session-stats').children.length>=10);
});
