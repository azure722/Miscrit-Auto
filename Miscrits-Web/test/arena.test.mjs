import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Engine} from '../lib/engine.mjs';
import {Transport,GameError} from '../lib/transport.mjs';
import {settings} from '../lib/model.mjs';
import {arenaEligibility,draftChoices} from '../lib/arena.mjs';
import {createApp} from '../server.mjs';
const rules=JSON.parse(readFileSync(new URL('../data/arena-protocol.json',import.meta.url)));
const catalog={species:Array.from({length:16},(_,i)=>({id:i+1,name:'Species '+(i+1),names:['Species '+(i+1)],rarity:i>=12?'Legendary':i>=8?'Exotic':'Common',stops:[],abilities:[{id:47,type:'Attack',ap:10,element:'Fire',enchant:{ap:5}}],ability_order:[47]})),teleports:{}};
const protocol={arena:rules,level_keys:[0,1,4,7],locations:{},training_xp:{}};
function harness(config={}){
  const p={user_id:'me',team_order:[1,2,3,4],miscrits:[1,2,3,4].map(id=>({id,mId:id,level:35,chp:50,hp:3,spd:3,ea:3,ed:3,pa:3,pd:3})),battle:'',virtue:100};
  const calls=[],responses={};
  const transport={connected:true,rpc:async(id,payload)=>{calls.push([id,payload]);if(responses[id])return responses[id](payload);if(id==='get_player')return structuredClone(p);return {info:{},team:p.miscrits.map(m=>({id:m.id,chp:m.chp}))};},addArena:async type=>{calls.push(['add',type]);return 'ticket';},removeArena:async ticket=>{calls.push(['remove',ticket]);},join:async id=>{calls.push(['join',id]);},leave:async id=>{calls.push(['leave',id]);},send:(...args)=>calls.push(['send',...args]),close(){this.connected=false;}};
  const engine=new Engine({catalog,protocol,config:{activity:'arena',...config}});engine.player=structuredClone(p);engine.transport=transport;
  return {engine,p,transport,calls,responses};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function start(type='Default'){return {type,pvp:true,player1:{user_id:'me',miscrits:[{id:1,mId:1,name:'A',level:35,hp:100,chp:100}]},player2:{user_id:'other',miscrits:[{id:9,mId:2,name:'B',level:35,hp:100,chp:100}]},next_turn:'me'};}

test('arena settings are bounded, opt in by activity, validated and profile compatible',()=>{
  const value=settings({},catalog);assert.equal(value.activity,'wild');assert.equal(value.arenaType,'Default');assert.equal(value.arenaBattleLimit,10);assert.equal(value.arenaStopOnLoss,true);
  for(const input of [{arenaType:'Duel'},{arenaType:2},{arenaBattleLimit:0},{arenaBattleLimit:1001},{arenaBattleLimit:1.5},{arenaStopOnLoss:1},{arenaAllowInjured:'yes'}])assert.throws(()=>settings(input,catalog));
  const {engine}=harness();engine.saveProfile('Random',{...value,activity:'arena',arenaType:'Random',arenaBattleLimit:3});engine.loadProfile('Random');assert.equal(engine.config.arenaType,'Random');assert.equal(engine.config.activity,'arena');assert.equal(engine.running,false);
});
test('arena native team checks distinguish draft, duplicate species, missing team, max level and rarity points',()=>{
  const {engine,p}=harness(),meta=engine.metadata;
  assert.equal(arenaEligibility(p,'Platinum',meta,rules).points,4);
  assert.equal(arenaEligibility({team_order:[],miscrits:[]},'Random',meta,rules).eligible,true);
  for(const change of [q=>q.team_order.pop(),q=>q.miscrits[1].mId=1,q=>q.miscrits.forEach(m=>m.chp=0)]){const q=structuredClone(p);change(q);assert.throws(()=>arenaEligibility(q,'Default',meta,rules));}
  const q=structuredClone(p);q.miscrits[0].level=34;assert.throws(()=>arenaEligibility(q,'Platinum',meta,rules),/35/);q.miscrits[0].level=35;
  q.miscrits.forEach((m,i)=>m.mId=i+13);assert.throws(()=>arenaEligibility(q,'Platinum',meta,rules),/12 rarity points/);
  q.miscrits[0].mId=1;q.miscrits[1].mId=2;q.miscrits[2].mId=3;q.miscrits[3].mId=4;q.miscrits[0].chp=0;
  assert.throws(()=>arenaEligibility(q,'Platinum',meta,rules),/fainted/);assert.equal(arenaEligibility(q,'Platinum',meta,rules,{allowInjured:true}).eligible,true);
});
test('arena joins use native matchmaker types, refresh HP and bypass training, replacements, hunts and paid healing',async()=>{
  for(const type of ['Default','Platinum','Random']){
    const {engine,calls}=harness({arenaType:type,trainSelected:true,autoLevel:true,autoReplace:true,wildAutoHeal:true});engine.start();await engine.tick();await engine.tick();
    assert.equal(calls.filter(c=>c[0]==='add').length,1);assert.deepEqual(calls.find(c=>c[0]==='add'),['add',type]);
    const expected=type==='Default'?'get_battle_arena':type==='Platinum'?'get_platinum_arena':'get_random_arena';assert.ok(calls.some(c=>c[0]===expected));
    assert.equal(calls.some(c=>['create_battle','heal_team','instant_heal','update_team','xp_train','get_player_seen'].includes(c[0])),false);
  }
});
test('invalid teams and a server arena ban stop before submitting a queue',async()=>{
  const a=harness();a.p.team_order.pop();a.engine.start();await a.engine.tick();assert.equal(a.calls.some(c=>c[0]==='add'),false);assert.match(a.engine.lastStop.message,/four/);
  const b=harness({arenaType:'Random'});b.responses.get_random_arena=()=>({info:{banned:true}});b.engine.start();await b.engine.tick();assert.equal(b.calls.some(c=>c[0]==='add'),false);assert.match(b.engine.lastStop.message,/banned/);
});
test('late queue tickets after Pause are cancelled once and never start combat',async()=>{
  const {engine,transport,calls}=harness();let release;transport.addArena=()=>new Promise(resolve=>release=resolve);
  engine.start();const pending=engine.tick();await flush();await engine.tick();engine.stop();release('late');await pending;await engine.arenaCancelPromise;
  assert.deepEqual(calls.filter(c=>c[0]==='remove'),[['remove','late']]);assert.equal(engine.running,false);assert.equal(engine.arenaQueue.cancelled,true);assert.equal(calls.some(c=>c[0]==='send'),false);
});
test('cancel/assignment race restores an assigned battle paused and rejects unrelated/duplicate match events',async()=>{
  const {engine,transport,calls}=harness();engine.start();await engine.tick();let reject;
  transport.removeArena=()=>new Promise((_,r)=>reject=r);engine.stop();
  await engine.arenaMatched({kind:'matched',data:{ticket:'wrong',match_id:'foreign'}});assert.equal(engine.battle,null);
  await engine.arenaMatched({kind:'matched',data:{ticket:'ticket',match_id:'assigned'}});reject(new Error('Already matched'));await engine.arenaCancelPromise;
  await engine.arenaMatched({kind:'matched',data:{ticket:'ticket',match_id:'duplicate'}});
  assert.equal(engine.battle.id,'assigned');assert.equal(engine.running,false);assert.equal(calls.filter(c=>c[0]==='join').length,1);assert.equal(engine.uncertain,false);
});
test('uncertain queue creation/cancellation never retries and blocks starting again',async()=>{
  for(const where of ['add','remove']){
    const {engine,transport}=harness();if(where==='add')transport.addArena=async()=>{throw new GameError('Queue timeout',true);};
    engine.start();await engine.tick();if(where==='remove'){transport.removeArena=async()=>{throw new GameError('Cancel timeout',true);};engine.stop();await flush();}
    assert.equal(engine.uncertain,true);assert.equal(engine.running,false);assert.throws(()=>engine.start(),/uncertain/);
  }
});
test('native bot fallback removes the queue ticket once, accepts notification 42 and does not create a custom battle',async()=>{
  const {engine,calls}=harness();engine.start();await engine.tick();engine.arenaQueue.started=Date.now()-92000;
  await engine.arenaQueueTick();await engine.arenaQueueTick();assert.equal(calls.filter(c=>c[0]==='remove').length,1);
  await engine.arenaMatched({kind:'bot',data:{match_id:'bot-battle'}});assert.equal(engine.battle.id,'bot-battle');assert.equal(calls.some(c=>c[0]==='create_battle'),false);
});
test('random queue timeout cancels once, pauses and leaves a stop report',async()=>{
  const {engine,calls}=harness({arenaType:'Random'});engine.start();await engine.tick();engine.arenaQueue.started=Date.now()-121000;
  await engine.tick();await engine.tick();assert.equal(engine.running,false);assert.equal(calls.filter(c=>c[0]==='remove').length,1);assert.match(engine.lastStop.message,/120 seconds/);
});
test('Random Arena bans six, picks four valid remaining species and transitions to the separate battle without duplicate submissions',async()=>{
  const {engine,calls}=harness({arenaType:'Random'});engine.start();await engine.tick();await engine.arenaMatched({kind:'matched',data:{ticket:'ticket',match_id:'draft'}});
  assert.ok(calls.some(c=>c[0]==='send'&&c[1]==='draft'&&c[2]===0));
  const pool=Array.from({length:16},(_,i)=>i+1);await engine.receive('draft',1,pool);await engine.tick();await engine.receive('draft',1,pool);await engine.tick();
  const bans=calls.filter(c=>c[0]==='send'&&c[2]===2);assert.equal(bans.length,1);assert.equal(bans[0][3].bans.length,6);
  await engine.receive('draft',5,bans[0][3].bans);await engine.tick();await engine.receive('draft',5,bans[0][3].bans);await engine.tick();
  const picks=calls.filter(c=>c[0]==='send'&&c[2]===3);assert.equal(picks.length,1);assert.equal(picks[0][3].picks.length,4);assert.ok(picks[0][3].picks.every(id=>!bans[0][3].bans.includes(id)));
  await engine.receive('draft',8,{player1:[],player2:[]});await engine.receive('draft',7,{matchId:'battle'});assert.equal(engine.draft,null);assert.equal(engine.battle.id,'battle');assert.ok(calls.some(c=>c[0]==='leave'&&c[1]==='draft'));
});
test('paused Random Arena draft permits manual selections, rejects invalid picks and never sends automatically',async()=>{
  const {engine,calls}=harness({arenaType:'Random'});engine.start();await engine.tick();await engine.arenaMatched({kind:'matched',data:{ticket:'ticket',match_id:'draft'}});
  engine.stop();await engine.receive('draft',1,Array.from({length:16},(_,i)=>i+1));await engine.tick();assert.equal(calls.some(c=>c[0]==='send'&&c[2]===2),false);
  for(const ids of [[1,2,3],[1,2,3,4,5,5],[1,2,3,4,5,999]])await assert.rejects(()=>engine.draftAction('ban',ids));
  await engine.draftAction('ban',[1,2,3,4,5,6]);await assert.rejects(()=>engine.draftAction('ban',[7,8,9,10,11,12]));
  await engine.receive('draft',5,[1,2,3,4,5,6]);await assert.rejects(()=>engine.draftAction('pick',[1,7,8,9]));
  await engine.draftAction('pick',[7,8,9,10]);assert.equal(calls.filter(c=>c[0]==='send'&&c[2]===3).length,1);assert.throws(()=>engine.updateConfig(engine.config),/draft/);
});
test('draft refresh uses native RESTART once and malformed/expired draft state does not replay bans',async()=>{
  const {engine,calls}=harness({arenaType:'Random'});engine.draft={id:'d',stage:'loading',pool:[],banned:[],submitted:{},started:Date.now()-6000,updated:Date.now(),awaiting:false};engine.running=true;
  await engine.tick();await engine.tick();assert.equal(calls.filter(c=>c[0]==='send'&&c[2]===9).length,1);
  await assert.rejects(()=>engine.receive('d',1,[1,1,2,3,4,5]),/invalid/);engine.draft.updated=Date.now()-51000;await engine.tick();assert.equal(engine.uncertain,true);
});
test('arena combat fights with PvP cooldowns and Random Arena enchants, never captures or runs unwanted targets',async()=>{
  for(const type of ['Default','Platinum','Random']){
    const {engine,calls}=harness({arenaType:type,mode:'capture_any',trainSelected:true});engine.running=true;await engine.join('b');await engine.receive('b',0,start(type));
    assert.equal(engine.battle.player.miscrits[0].abilities[0].nativeCooldown,2);
    assert.equal(engine.battle.player.miscrits[0].abilities[0].ap,type==='Random'?15:10);
    await engine.combat();assert.ok(calls.some(c=>c[0]==='send'&&c[2]===2));assert.equal(calls.some(c=>c[0]==='send'&&[4,10].includes(c[2])),false);
  }
});
test('arena completion counts only once, stops on loss/limit and resumes with a fresh run after its limit',async()=>{
  for(const scenario of ['loss','limit','continue']){
    const {engine}=harness({arenaStopOnLoss:scenario!=='continue',arenaBattleLimit:scenario==='limit'?1:10});engine.start();
    engine.battle={id:'b',type:'Default',winner:scenario==='limit'?'me':'other',player:{miscrits:[]}};
    await engine.finish('ended',{});await engine.finish('ended',{});assert.equal(engine.arenaRun.battles,1);
    assert.equal(engine.running,scenario==='continue');if(scenario==='limit'){engine.start();assert.equal(engine.arenaRun.battles,0);}
  }
});
test('transport uses native matchmaker envelopes and routes only matched and code-42 arena notifications',async()=>{
  const t=new Transport(()=>{},()=>{}),requests=[],events=[];t.request=async value=>{requests.push(value);return value.matchmaker_add?{matchmaker_ticket:{ticket:'t'}}:{};};t.onArena=event=>events.push(event);
  assert.equal(await t.addArena('Random'),'t');await t.removeArena('t');assert.deepEqual(requests,[{matchmaker_add:{query:'*',min_count:2,max_count:2,string_properties:{type:'Random'}}},{matchmaker_remove:{ticket:'t'}}]);
  t.receive({matchmaker_matched:{match_id:'b',ticket:'t'}});t.receive({notifications:{notifications:[{code:7,content:'{}'},{code:42,content:'invalid'},{code:42,content:'{"matchId":"bot"}'}]}});
  assert.equal(events.length,2);assert.equal(events[1].kind,'bot');assert.equal(events[1].data.match_id,'bot');
});
test('manual draft frontend retains selection across polls and excludes banned species',()=>{
  class Element{constructor(tag='',css='',text=''){Object.assign(this,{tag,className:css,textContent:text,children:[],handlers:{}});}append(...children){this.children.push(...children);}replaceChildren(){this.children=[];}addEventListener(event,callback){this.handlers[event]=callback;}}
  const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const source=readFileSync(new URL('../src/controller.js',import.meta.url),'utf8'),helper=source.slice(source.indexOf('let draftSelection='),source.indexOf("$('arena-open-battle').addEventListener"));
  const state={connected:true,running:false,busy:false,config:{activity:'arena'},arena:{run:{battles:2,wins:1,losses:1}},draft:{id:'d',stage:'pick',pool:[1,2,3,4,5,6],banned:[1],awaiting:false,deadline:Date.now()+40000}};
  const context=vm.createContext({$,element:(...args)=>new Element(...args),state,catalog:catalog.species,toast(){}});vm.runInContext(helper,context);context.renderArena();
  assert.equal($('draft-pool').children[0].children[0].disabled,true);
  for(const index of [1,2,3,4]){const input=$('draft-pool').children[index].children[0];input.checked=true;input.handlers.change();}
  context.renderArena();assert.equal($('draft-submit').disabled,false);assert.equal($('draft-pool').children[1].children[0].checked,true);
  state.running=true;context.renderArena();assert.equal($('draft-submit').disabled,true);assert.equal($('draft-pool').children[1].children[0].disabled,true);
});

test('draft HTTP actions require owner/CSRF, pass exact selected IDs and keep private routes inaccessible',async()=>{
  const actions=[],engine={snapshot:()=>({}),tick:async()=>{},stop(){},metadata:new Map(),draftAction:(...args)=>actions.push(args)};
  const app=await createApp({port:0,fetchData:false,engine}),base='http://127.0.0.1:'+app.server.address().port;
  try{
    assert.equal((await fetch(base+'/api/arena/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
    const boot=await fetch(base+'/api/bootstrap'),cookie=boot.headers.get('set-cookie').split(';')[0],{csrf}=await boot.json();
    const response=await fetch(base+'/api/arena/draft',{method:'POST',headers:{Cookie:cookie,'X-Miscrits-CSRF':csrf,'Content-Type':'application/json'},body:JSON.stringify({kind:'pick',ids:[1,2,3,4]})});
    assert.equal(response.status,200);assert.deepEqual(actions,[['pick',[1,2,3,4]]]);assert.equal((await fetch(base+'/data/settings.json')).status,404);
  }finally{await app.close();}
});

test('a cancelled ticket still correlates late assignments, and draft reconnection refreshes instead of repeating submitted choices',async()=>{
  const a=harness();a.engine.start();await a.engine.tick();a.engine.stop();await a.engine.arenaCancelPromise;
  await a.engine.arenaMatched({kind:'matched',data:{ticket:'foreign',match_id:'wrong'}});assert.equal(a.engine.battle,null);
  await a.engine.arenaMatched({kind:'matched',data:{ticket:'ticket',match_id:'late'}});assert.equal(a.engine.battle.id,'late');assert.equal(a.engine.running,false);
  const b=harness({arenaType:'Random'});b.engine.draft={id:'draft',stage:'ban',pool:Array.from({length:16},(_,i)=>i+1),banned:[],submitted:{ban:true},started:Date.now(),updated:Date.now(),awaiting:true};
  b.transport.reconnect=async()=>{};b.responses.get_player_seen=()=>({});await b.engine.reconnect();
  assert.equal(b.engine.running,false);assert.ok(b.calls.some(c=>c[0]==='send'&&c[2]===9));
  b.engine.start();await b.engine.tick();assert.equal(b.calls.some(c=>c[0]==='send'&&c[2]===2),false);
});
