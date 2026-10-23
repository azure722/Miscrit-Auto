import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Engine} from '../lib/engine.mjs';
import {DEFAULTS,settings,selectedTrainingPlan,decision} from '../lib/model.mjs';
const protocol=JSON.parse(readFileSync(new URL('../data/protocol.json',import.meta.url)));
const catalog={teleports:{},species:[{id:1,name:'Target',rarity:'Exotic'},{id:2,name:'Other',rarity:'Rare'}]};
const crit=(id,mId,level=1,rating=18)=>({id,mId,level,exp:0,hp:rating-15,spd:3,ea:3,ed:3,pa:3,pd:3,chp:40});
async function harness(config={},save){
  const p={user_id:'me',team_order:[5],miscrits:[crit(5,2,35)],battle:''};const saved=[],calls=[];
  const engine=new Engine({catalog,protocol,config:{names:['Target','Other'],replacementNames:['Target'],captureLowRatedTargets:true,...config},save:next=>{if(save)save(next);saved.push(structuredClone(next));}});
  engine.player=p;engine.collectionIndex={};engine.indexUpdated=Date.now();
  engine.transport={connected:true,join:async()=>{},leave:async()=>{},send(){},rpc:async(id)=>{calls.push(id);return id==='get_player'?p:{};}};
  await engine.join('b');await engine.receive('b',0,{type:'Wild',player1:{user_id:'me',miscrits:[{id:5,mId:2,level:35,hp:100,chp:100}]},player2:{user_id:'Wild',miscrits:[{id:9,mId:1,name:'Evolved Target',level:1,hp:100,chp:100,rating:10}]},next_turn:'me',capture_chance:80});
  return {engine,p,saved,calls};
}
test('rating 17 is required for team selection, while the low-capture override can still accept rating 16',()=>{
  assert.equal(DEFAULTS.minRating,17);assert.equal(settings({},catalog).autoRemoveCapturedTargets,true);
  assert.throws(()=>settings({autoRemoveCapturedTargets:'yes'},catalog));
  const p={team_order:[5],miscrits:[crit(5,2,35),crit(9,1,1,16)]};
  let plan=selectedTrainingPlan(p,['Target'],catalog,new Map(),{});assert.equal(plan.traineeIds.length,0);assert.deepEqual(plan.needsCapture,['Target']);
  p.miscrits[1]=crit(9,1,1,17);plan=selectedTrainingPlan(p,['Target'],catalog,new Map(),{});assert.deepEqual(plan.traineeIds,[9]);assert.equal(plan.minimumRating,17);
});
test('failed attempts and pending captures keep targets; confirmed keeps remove just the captured family once',async()=>{
  const {engine,saved}=await harness();
  await engine.receive('b',10,{user_id:'me',captured:false,pending:false,next_turn:'me'});assert.equal(saved.length,0);
  await engine.receive('b',10,{user_id:'me',captured:true,pending:true,next_turn:'me'});assert.deepEqual(engine.config.names,['Target','Other']);
  await engine.receive('b',11,{user_id:'me',actions:[],next_turn:'me'});
  assert.deepEqual(engine.config.names,['Other']);assert.deepEqual(saved[0].names,['Other']);assert.deepEqual(saved[0].replacementNames,['Target']);
  await engine.receive('b',11,{user_id:'me',actions:[],next_turn:'me'});assert.equal(saved.length,1);
});
test('low-rated kept captures leave a rating-17 upgrade goal after visible target removal',async()=>{
  const {engine,p}=await harness({trainSelected:true});
  await engine.receive('b',10,{user_id:'me',captured:true,pending:true,next_turn:'me'});
  await engine.receive('b',11,{user_id:'me',actions:[],next_turn:'me'});
  p.miscrits.push(crit(9,1,1,10));
  const plan=selectedTrainingPlan(p,engine.config.replacementNames,catalog,engine.metadata,{});
  assert.equal(engine.config.names.includes('Target'),false);assert.deepEqual(plan.needsCapture,['Target']);assert.equal(plan.traineeIds.length,0);
  const b={type:'Wild',player:{user_id:'me',miscrits:[{hp:100,chp:100,abilities:[]}]},foe:{miscrits:[{mId:1,hp:100,chp:100,rating:16,attempts:0}]},nextTurn:'me',captureChance:80,attacks:0,damage:{}};
  const context={families:new Set([1]),upgrades:new Set([1])};
  assert.equal(decision(b,{...engine.config,mode:'capture_missing'},catalog,context).action,'capture');
  assert.equal(decision(b,{...engine.config,mode:'capture_missing',captureLowRatedTargets:false},catalog,context).action,'flee');
});
test('turning removal off preserves targets and failed preference writes pause without losing the target',async()=>{
  for(const fail of [false,true]){
    const {engine,saved}=await harness({autoRemoveCapturedTargets:fail},fail?()=>{throw new Error('Disk write failed');}:undefined);
    engine.battle.foe.miscrits[0].captured=true;engine.running=true;
    await engine.receive('b',11,{user_id:'me',actions:[],next_turn:'me'});
    assert.deepEqual(engine.config.names,['Target','Other']);assert.equal(saved.length,0);
    if(fail){assert.equal(engine.running,false);assert.match(engine.status,/saving target removal failed/);}
  }
});
test('an exhausted hunt list stops cleanly when no training upgrades remain',async()=>{
  const {engine,calls}=await harness({names:['Target']});engine.battle.foe.miscrits[0].captured=true;
  await engine.receive('b',11,{user_id:'me',actions:[],next_turn:'me'});
  await engine.finish('ended',{});engine.running=true;await engine.tick();
  assert.equal(engine.running,false);assert.match(engine.status,/All hunt targets collected/);assert.equal(calls.includes('create_battle'),false);
});
test('server target removals update visible drafts without discarding unrelated unsaved changes',()=>{
  const source=readFileSync(new URL('../src/controller.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('function reconcileHuntTargets('),source.indexOf('async function poll(){'));
  const draft={names:['Captured','Other','Unsaved new target'],minRating:18};
  const context=vm.createContext({draft,dirty:true});vm.runInContext(code,context);
  assert.equal(vm.runInContext("reconcileHuntTargets(['Captured','Other'],['Other'])",context),true);
  assert.deepEqual([...draft.names],['Other','Unsaved new target']);assert.equal(draft.minRating,18);
});
