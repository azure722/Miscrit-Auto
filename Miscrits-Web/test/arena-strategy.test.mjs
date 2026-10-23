import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {arenaDecision,elementMultiplier} from '../lib/arena-strategy.mjs';
import {arenaTotals,draftChoices} from '../lib/arena.mjs';
import {Engine} from '../lib/engine.mjs';
import {settings} from '../lib/model.mjs';
import {createApp} from '../server.mjs';
const protocol=JSON.parse(readFileSync(new URL('../data/protocol.json',import.meta.url)));
protocol.arena=JSON.parse(readFileSync(new URL('../data/arena-protocol.json',import.meta.url)));
const move=(id,ap=20,extra={})=>({id,ap,type:'Attack',element:'Physical',accuracy:100,recharge:0,remaining:undefined,...extra});
const meta=()=>new Map([[1,{id:1,element:'Fire',pa:'Strong',ea:'Strong',ed:'Strong',pd:'Strong',rarity:'Common'}],[2,{id:2,element:'Water',pa:'Strong',ea:'Strong',ed:'Strong',pd:'Strong',rarity:'Rare'}],[3,{id:3,element:'Nature',pa:'Strong',ea:'Strong',ed:'Strong',pd:'Strong',rarity:'Common'}]]);
function battle(){return {type:'Default',pvp:true,player:{user_id:'me',switches:0,miscrits:[{id:1,mId:1,hp:100,chp:100,abilities:[move(10)],arenaEffects:{},turnStatuses:{}}]},foe:{user_id:'them',miscrits:[{id:2,mId:2,hp:100,chp:100,abilities:[move(20)],arenaEffects:{},turnStatuses:{}}]},nextTurn:'me'};}
function fixture(config={}){
  const catalog={species:[...meta().values()].map(s=>({...s,name:'S'+s.id,names:['S'+s.id],stops:[],abilities:[move(10)],ability_order:[10]})),teleports:{}};
  const engine=new Engine({catalog,protocol,config:{activity:'arena',...config}}),calls=[],p={user_id:'me',team_order:[1],miscrits:[{id:1,mId:1,level:35,chp:100}],battle:''};
  engine.player=p;engine.metadata=meta();let payload={info:{stats:{ba_wins:50,ba_losses:10,ba_weekly_wins:5}}};
  engine.transport={connected:true,rpc:async id=>{calls.push(id);return id==='get_player'?p:payload;},leave:async()=>{},send:(...args)=>calls.push(args)};
  return {engine,calls,setPayload:value=>payload=value};
}

test('account records parse lifetime and period wins, preserve zero and never substitute run totals or Platinum streaks',()=>{
  const ba=arenaTotals('Default',{info:{stats:{ba_wins:100,ba_losses:20,ba_weekly_wins:0}}});assert.equal(ba.totalWins,100);assert.equal(ba.periodWins,0);assert.equal(ba.totalLosses,20);
  const ra=arenaTotals('Random',{info:{stats:{ra_wins:200,ra_losses:30,ra_monthly_wins:12}}});assert.equal(ra.totalWins,200);assert.equal(ra.periodWins,12);
  const pa=arenaTotals('Platinum',{info:{pa_streak:8,pa_max_streak:20,pa_cap:99}});assert.equal(pa.totalWins,null);assert.equal(pa.streak,8);assert.equal(pa.bestStreak,20);
  assert.equal(arenaTotals('Platinum',{info:{stats:{pa_wins:123}}}).totalWins,123);
  assert.equal(arenaTotals('Default',{info:{stats:{ba_wins:-1,ba_losses:'secret'}}}).totalWins,null);
});
test('manual account refresh is read-only, keeps run counters and stops simultaneous or active-battle refresh',async()=>{
  const {engine,calls}=fixture();engine.arenaRun.wins=2;await engine.refreshArenaTotals('Default');assert.deepEqual(calls,['get_battle_arena']);assert.equal(engine.arenaRecords.Default.totalWins,50);assert.equal(engine.arenaRun.wins,2);
  engine.running=true;await assert.rejects(()=>engine.refreshArenaTotals('Random'),/Pause/);engine.running=false;engine.battle={};await assert.rejects(()=>engine.refreshArenaTotals('Default'),/current arena/);
});
test('completed arena refreshes the authoritative account record once without double-counting the outcome',async()=>{
  const {engine,calls,setPayload}=fixture();setPayload({info:{stats:{ba_wins:51,ba_losses:10,ba_weekly_wins:6}}});engine.battle={id:'b',type:'Default',winner:'me',player:{miscrits:[]}};
  await engine.finish('ended',{});await engine.finish('ended',{});assert.equal(engine.arenaRun.wins,1);assert.equal(engine.arenaRecords.Default.totalWins,51);assert.equal(calls.filter(c=>c==='get_battle_arena').length,1);
});
test('an unavailable account record stays marked stale after a win rather than estimating the total',async()=>{
  const {engine}=fixture();await engine.refreshArenaTotals('Default');engine.transport.rpc=async id=>{if(id==='get_player')return engine.player;throw Error('Unavailable');};
  engine.battle={id:'b',type:'Default',winner:'me',player:{miscrits:[]}};await engine.finish('ended',{});
  assert.equal(engine.arenaRecords.Default.totalWins,50);assert.match(engine.arenaRecords.Default.error,/could not refresh/);assert.equal(engine.arenaRun.wins,1);
});
test('elemental scoring follows native weakness directions and Negate, with physical damage neutral',()=>{
  const m=meta(),a={mId:2},d={mId:1};assert.equal(elementMultiplier({element:'Water'},a,d,m,protocol),2);
  d.negated=true;assert.equal(elementMultiplier({element:'Water'},a,d,m,protocol),1);d.negated=false;
  assert.equal(elementMultiplier({element:'Fire'},{mId:1},{mId:2},m,protocol),.5);
  assert.equal(elementMultiplier({element:'Fire'},{mId:1,negated:true},{mId:2},m,protocol),1);
  assert.equal(elementMultiplier({element:'Physical'},a,d,m,protocol),1);
});
test('smart attack selection prefers elemental advantage over higher raw AP',()=>{
  const b=battle();b.player.miscrits[0].abilities=[move(10,30),move(11,20,{element:'Nature'})];assert.equal(arenaDecision(b,meta(),protocol).id,11);
});
test('accuracy and hit count can outweigh raw AP without exceeding legal cooldown/use restrictions',()=>{
  const b=battle();b.player.miscrits[0].abilities=[move(10,50,{accuracy:30}),move(11,20),move(12,100,{recharge:1}),move(13,100,{remaining:0})];assert.equal(arenaDecision(b,meta(),protocol).id,11);
  b.player.miscrits[0].abilities=[move(10,30),move(11,12,{times:3})];assert.equal(arenaDecision(b,meta(),protocol).id,11);
});
test('physical and elemental stat profiles matter, while unsupported stats remain heuristic',()=>{
  const m=meta();Object.assign(m.get(1),{pa:'Elite',ea:'Weak'});const b=battle();b.player.miscrits[0].abilities=[move(10,22),move(11,25,{element:'Wind'})];assert.equal(arenaDecision(b,m,protocol).id,10);
});
test('healing avoids full HP and antiheal, and a measured likely finisher takes priority',()=>{
  const b=battle(),own=b.player.miscrits[0];own.abilities.push(move(11,30,{type:'Heal',target:'Self',element:'Misc'}));
  assert.equal(arenaDecision(b,meta(),protocol).id,10);own.chp=20;assert.equal(arenaDecision(b,meta(),protocol).id,11);
  own.arenaEffects.Antiheal={turns:2};assert.equal(arenaDecision(b,meta(),protocol).id,10);own.arenaEffects={};b.foe.miscrits[0].chp=12;b.arenaDamage={'1:2:10':20};assert.equal(arenaDecision(b,meta(),protocol).id,10);
});
test('damage-over-time and control are not reapplied to active effects or known control immunity',()=>{
  const b=battle(),own=b.player.miscrits[0],foe=b.foe.miscrits[0];own.abilities.push(move(11,14,{type:'Poison',element:'Misc',turns:3}));assert.equal(arenaDecision(b,meta(),protocol).id,11);
  foe.arenaEffects.Poison={turns:2};assert.equal(arenaDecision(b,meta(),protocol).id,10);
  own.abilities=[move(10),move(12,0,{type:'Sleep',element:'Misc',turns:2})];foe.abilities=[move(20,40)];assert.equal(arenaDecision(b,meta(),protocol).id,12);
  foe.arenaEffects.SI={turns:3};assert.equal(arenaDecision(b,meta(),protocol).id,10);
});
test('Negate and Cleanser are chosen only for relevant current threats or ailments',()=>{
  const b=battle(),own=b.player.miscrits[0];own.abilities.push(move(11,0,{type:'Negate',target:'Self',element:'Misc'}));b.foe.miscrits[0].abilities=[move(20,30,{element:'Water'})];
  assert.equal(arenaDecision(b,meta(),protocol).id,11);own.negated=true;assert.equal(arenaDecision(b,meta(),protocol).id,10);
  own.abilities=[move(10),move(12,0,{type:'Cleanser',target:'Self',element:'Misc'})];own.arenaEffects={Poison:{turns:2},Dot:{turns:5}};assert.equal(arenaDecision(b,meta(),protocol).id,12);
});
test('defensive switching requires a substantially safer healthy alternative and respects paralyze, penalty and anti-loop guards',()=>{
  const b=battle(),own=b.player.miscrits[0];own.chp=20;own.abilities=[move(10,10,{element:'Fire'})];b.foe.miscrits[0].abilities=[move(20,20,{element:'Water'})];
  b.player.miscrits.push({id:3,mId:3,hp:100,chp:100,abilities:[move(30,20,{element:'Nature'})]});assert.equal(arenaDecision(b,meta(),protocol).action,'switch');
  own.paralyzed=true;assert.equal(arenaDecision(b,meta(),protocol).action,'ability');own.paralyzed=false;b.player.switches=3;assert.equal(arenaDecision(b,meta(),protocol).action,'ability');b.player.switches=0;b.arenaSwitchedSinceAttack=true;assert.equal(arenaDecision(b,meta(),protocol).action,'ability');
});
test('arena policy never acts off-turn, while handicapped, or after battle completion',()=>{
  const b=battle();b.nextTurn='them';assert.equal(arenaDecision(b,meta(),protocol),null);b.nextTurn='me';b.player.miscrits[0].handicap=true;assert.equal(arenaDecision(b,meta(),protocol),null);b.player.miscrits[0].handicap=false;b.winner='me';assert.equal(arenaDecision(b,meta(),protocol),null);
});
test('Random draft quality can choose a strong common over weak rarity and picks add elemental coverage',()=>{
  const metadata=new Map(Array.from({length:8},(_,i)=>[i+1,{element:i<4?'Fire':'Water',rarity:i===7?'Legendary':'Common',abilities:i===7?[]:[move(1,40)],pa:'Strong',hp:'Strong',ed:'Strong',pd:'Strong'}]));
  const ids=draftChoices([1,2,3,4,5,6,7,8],[],metadata,4);assert.equal(ids.includes(8),false);assert.ok(ids.some(id=>id<=4));assert.ok(ids.some(id=>id>4));
});
test('arena strategy is validated and saved in profiles with basic strategy retained as an explicit fallback',()=>{
  const {engine}=fixture();assert.equal(engine.config.arenaStrategy,'smart');assert.throws(()=>settings({arenaStrategy:'unknown'},engine.catalog));engine.saveProfile('Basic',{...engine.config,arenaStrategy:'basic'});engine.loadProfile('Basic');assert.equal(engine.config.arenaStrategy,'basic');
});
test('native arena recharge differentiates misses and one-use moves; special control cooldowns match extracted constants',async()=>{
  for(const [type,nativeCooldown,opcode,expected]of [['Attack',2,13,0],['Attack',-1,13,0],['Attack',-1,2,-1],['Sleep',2,13,4],['Sleep',2,2,5]]){
    const {engine}=fixture(),b=battle();b.id='b';b.serial=0;b.damage={};b.type='Default';b.player.miscrits[0].abilities=[move(10,20,{type,nativeCooldown})];engine.battle=b;
    await engine.receive('b',opcode,{user_id:'me',id:10,actions:[]});assert.equal(engine.battle.player.miscrits[0].abilities[0].recharge,expected);
  }
});
test('arena damage observations sum multi-hit actions and are invalidated by stat/element changes',async()=>{
  const {engine}=fixture(),b=battle();b.id='b';b.serial=0;b.damage={};engine.battle=b;
  await engine.receive('b',2,{user_id:'me',id:10,actions:[{type:'Attack',target:'them',damage:5},{type:'Attack',target:'them',damage:6}]});assert.equal(b.arenaDamage['1:2:10'],11);
  await engine.receive('b',2,{user_id:'them',id:20,actions:[{type:'Negate',target:'them'}]});assert.equal(b.foe.miscrits[0].negated,true);assert.deepEqual(b.arenaDamage,{});
});
test('account totals UI separates server wins from run counters and shows unknown Platinum lifetime totals',()=>{
  class Element{constructor(tag='',css='',text=''){Object.assign(this,{tag,className:css,textContent:text,children:[],value:'Platinum'});}append(...c){this.children.push(...c);}replaceChildren(){this.children=[];}}
  const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const source=readFileSync(new URL('../src/controller.js',import.meta.url),'utf8'),code=source.slice(source.indexOf('function renderArenaTotals('),source.indexOf('function renderArena(){'));
  const state={connected:true,config:{arenaType:'Platinum'},arena:{records:{Platinum:arenaTotals('Platinum',{info:{pa_streak:5,pa_max_streak:10}})},run:{wins:2}}};
  const context=vm.createContext({state,$,element:(...a)=>new Element(...a),arenaStatsLoading:false,tab:'team'});vm.runInContext(code,context);context.renderArenaTotals();
  assert.equal($('arena-account-totals').children[0].children[1].textContent,'—');assert.equal($('arena-account-totals').children[2].children[1].textContent,'5');assert.match($('arena-record-source').textContent,/not supplied/);
});

test('smart and basic settings send the intended legal attack through the engine',async()=>{
  for(const strategy of ['smart','basic']){
    const {engine,calls}=fixture({arenaStrategy:strategy}),b=battle();Object.assign(b,{id:'b',serial:0,acted:-1,damage:{}});b.player.miscrits[0].abilities=[move(10,30),move(11,20,{element:'Nature'})];engine.battle=b;engine.running=true;
    await engine.combat();const sent=calls.find(c=>Array.isArray(c)&&c[1]===2);assert.equal(sent[2].id,strategy==='smart'?11:10);assert.ok(b.strategyReason);await engine.combat();assert.equal(calls.filter(c=>Array.isArray(c)&&c[1]===2).length,1);
  }
});

test('account totals HTTP refresh keeps owner/CSRF checks and passes only the selected arena type',async()=>{
  const calls=[],engine={metadata:new Map(),tick:async()=>{},stop(){},snapshot:()=>({}),refreshArenaTotals:async type=>calls.push(type)};
  const app=await createApp({port:0,fetchData:false,engine}),base='http://127.0.0.1:'+app.server.address().port;
  try{
    assert.equal((await fetch(base+'/api/arena/stats',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
    const boot=await fetch(base+'/api/bootstrap'),cookie=boot.headers.get('set-cookie').split(';')[0],{csrf}=await boot.json();
    assert.equal((await fetch(base+'/api/arena/stats',{method:'POST',headers:{Cookie:cookie,'X-Miscrits-CSRF':csrf,'Content-Type':'application/json'},body:'{"type":"Random"}'})).status,200);assert.deepEqual(calls,['Random']);
  }finally{await app.close();}
});

test('arena cleanser removes the native harmful effects without clearing Sleep or beneficial Negate',()=>{
  const {engine}=fixture(),member={negated:true,arenaEffects:{Sleep:{turns:2},Poison:{turns:3},Negate:{turns:-1},Paralyze:{turns:2}}};
  engine.arenaEffect(member,{type:'Cleanser'});assert.equal(member.arenaEffects.Poison,undefined);assert.equal(member.arenaEffects.Paralyze,undefined);assert.equal(member.arenaEffects.Sleep.turns,2);assert.equal(member.negated,true);
});
