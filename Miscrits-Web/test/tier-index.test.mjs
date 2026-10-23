import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Engine} from '../lib/engine.mjs';
import {miscritsIndex,selectedTrainingPlan,settings,TRAINING_TIERS} from '../lib/model.mjs';
const catalog={species:[{id:1,name:'Exotic A',rarity:'Exotic',stops:[{}]},{id:2,name:'Rare A',rarity:'Rare',stops:[{}]},{id:3,name:'Common A',rarity:'Common',stops:[{}]},{id:4,name:'Exotic B',rarity:'Exotic',stops:[{}]},{id:5,name:'Exotic C',rarity:'Exotic',stops:[{}]}],teleports:{}};
const crit=(id,mId,level=1,stat=3)=>({id,mId,level,exp:1000,hp:stat,spd:stat,pa:stat,ea:stat,pd:stat,ed:stat,chp:40});
const player=()=>({user_id:'me',team_order:[90],miscrits:[crit(90,99,35),crit(1,1),crit(2,2),crit(3,3)]});
test('native decimal index separates seen and captured evolution flags',()=>{
  const index=miscritsIndex({'1':222,'2':1222,'3':2000});
  assert.equal(index[1].complete,false);assert.equal(index[2].seen[3],true);assert.equal(index[2].complete,false);
  assert.equal(index[3].complete,true);assert.equal(index[3].captured[3],true);assert.equal(index[3].captured[0],false);
  for(const raw of [null,[],{1:'2000'},{1:-2},{1:10000},{wrong:2}])assert.throws(()=>miscritsIndex(raw));
});
test('tier selection follows Exotic, Rare, Common, then remaining tiers',()=>{
  assert.deepEqual(TRAINING_TIERS,['Exotic','Rare','Common','Epic','Legendary']);
  const p=player(),plan=selectedTrainingPlan(p,['Common A','Rare A','Exotic A'],catalog,new Map(),{});
  assert.deepEqual(plan.after,[90,1,2,3]);assert.equal(plan.indexChecked,true);
});
test('any level-30 family member blocks training a higher-rated duplicate and excludes capture upgrades',()=>{
  const p=player();p.miscrits.push(crit(4,1,30,1));
  const plan=selectedTrainingPlan(p,['Exotic A'],catalog,new Map(),{});
  assert.deepEqual(plan.complete,['Exotic A']);assert.equal(plan.traineeIds.length,0);assert.equal(plan.needsCapture.length,0);
});
test('index fourth-evolution capture blocks a duplicate even when the old copy is no longer owned',()=>{
  const p=player();p.miscrits=p.miscrits.filter(m=>m.mId!==1);
  let plan=selectedTrainingPlan(p,['Exotic A'],catalog,new Map(),miscritsIndex({'1':2000}));
  assert.deepEqual(plan.complete,['Exotic A']);assert.equal(plan.needsCapture.length,0);
  plan=selectedTrainingPlan(p,['Exotic A'],catalog,new Map(),miscritsIndex({'1':1000}));assert.deepEqual(plan.needsCapture,['Exotic A']);
});
test('expired or unavailable index stops selection before any game mutation',async()=>{
  const p=player(),calls=[];
  const engine=new Engine({catalog,protocol:{},config:{trainSelected:true,replacementNames:['Exotic A'],names:['Exotic A']}});engine.player=p;engine.running=true;
  engine.transport={connected:true,rpc:async id=>{calls.push(id);if(id==='get_player_seen')throw new Error('Index unavailable');return p;}};
  await engine.tick();assert.equal(engine.running,false);assert.deepEqual(calls,['get_player_seen']);
  assert.match(engine.status,/Index unavailable/);
});
test('index is cached briefly and cleared at logout so accounts cannot share completion flags',async()=>{
  let calls=0;const engine=new Engine({catalog,protocol:{}});engine.player=player();engine.transport={connected:true,rpc:async()=>{calls++;return {'1':2000};},close(){}};
  await engine.refreshIndex();await engine.refreshIndex();assert.equal(calls,1);assert.equal(engine.collectionIndex[1].complete,true);
  engine.indexUpdated=0;await engine.refreshIndex();assert.equal(calls,2);await engine.logout();assert.equal(engine.collectionIndex,null);
});
test('tier batch actions use current index and inventory, deduplicate species and skip completed families',()=>{
  const source=readFileSync(new URL('../src/controller.js',import.meta.url),'utf8');
  const helpers=source.slice(source.indexOf('function familyStatus('),source.indexOf('function renderTierLists('));
  const state={connected:true,player:{team:[{id:90}],roster:[{id:1,mId:1,level:1,rating:18},{id:4,mId:4,level:1,rating:18},{id:5,mId:5,level:1,rating:10}]},collectionIndex:miscritsIndex({'1':2000})};
  state.huntAccessVersion=2;state.huntAvailability=Object.fromEntries(catalog.species.map(s=>[s.name,{available:true,reason:'Available'}]));
  const draft={replacementNames:['Exotic B']};let renders=0;
  vm.runInNewContext(helpers+";addTier('Exotic','owned');addTier('Exotic','capture');",{state,draft,catalog:catalog.species,toast(){},renderLists(){renders++;}});
  assert.deepEqual([...draft.replacementNames],['Exotic B','Exotic C']);assert.equal(renders,2);
  assert.deepEqual([...draft.names],['Exotic C']);
});
test('replacement lists can hold complete catalog tiers while hunt target limits remain bounded',()=>{
  const many={species:Array.from({length:150},(_,i)=>({id:i+1,name:'Species '+i}))};const names=many.species.map(s=>s.name);
  assert.equal(settings({replacementNames:names},many).replacementNames.length,150);assert.throws(()=>settings({names},many));
});
test('general training cannot level a duplicate lead while selected-copy training is enabled',async()=>{
  const p=player();p.team_order=[90,1];p.miscrits.find(m=>m.id===90).level=1;const trained=[];
  const protocol=JSON.parse(readFileSync(new URL('../data/protocol.json',import.meta.url)));
  const engine=new Engine({catalog,protocol,config:{autoLevel:true,trainSelected:true,activity:'campaign',replacementNames:['Exotic A']}});
  engine.player=p;engine.running=true;engine.collectionIndex=miscritsIndex({'99':2000});engine.indexUpdated=Date.now();
  engine.transport={connected:true,rpc:async(id,payload)=>{
    if(id==='get_player')return structuredClone(p);
    if(id==='xp_train'){trained.push(payload.miscritId);const m=p.miscrits.find(m=>m.id===payload.miscritId);m.level++;m.exp=0;return {};}
    if(id==='get_campaign')return {tries:10,last_completed:0};return {};
  }};
  await engine.tick();engine.nextCycle=0;await engine.tick();assert.deepEqual(trained,[1]);assert.equal(p.miscrits.find(m=>m.id===90).level,1);
});
test('delayed index response cannot restore another account after logout',async()=>{
  const engine=new Engine({catalog,protocol:{}});engine.player=player();let release;
  engine.transport={rpc:()=>new Promise(resolve=>release=resolve),close(){}};
  const pending=engine.refreshIndex();await engine.logout();release({'1':2000});await assert.rejects(pending,/cancelled/);
  assert.equal(engine.collectionIndex,null);
});
