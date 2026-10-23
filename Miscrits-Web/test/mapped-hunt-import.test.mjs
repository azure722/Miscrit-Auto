import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/controller.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function familyStatus('),source.indexOf('function renderTierLists('));
const entry=(id,name,stops=[{}])=>({id,name,rarity:'Exotic',stops});
function harness(){
  const catalog=[entry(1,'Missing'),entry(2,'Weak owned'),entry(3,'Completed'),entry(4,'Good owned'),entry(5,'Unmapped',[])];
  const state={connected:true,player:{team:[],roster:[{id:20,mId:2,level:1,rating:10},{id:40,mId:4,level:1,rating:18}]},collectionIndex:{3:{complete:true}}};
  state.huntAccessVersion=2;state.huntAvailability=Object.fromEntries(catalog.map(s=>[s.name,{available:s.stops.length>0,reason:s.stops.length?'Available':'No wild location'}]));
  const draft={names:['Manual target'],replacementNames:catalog.map(s=>s.name)},messages=[];
  const context=vm.createContext({state,draft,catalog,dirty:false,toast:message=>messages.push(message),renderLists(){}});
  vm.runInContext(helpers,context);return {context,draft,messages};
}
test('mapped tier capture buttons update both lists once, preserving manual hunt targets',()=>{
  const {context,draft}=harness();vm.runInContext("addTier('Exotic','capture');addTier('Exotic','capture');",context);
  assert.deepEqual([...draft.names],['Manual target','Missing','Weak owned']);
  assert.equal(new Set(draft.replacementNames).size,draft.replacementNames.length);
});
test('existing selected tier targets can be copied into an empty hunt list without completed or unmapped families',()=>{
  const {context,draft}=harness();draft.names=[];vm.runInContext('importTierTargets();',context);
  assert.deepEqual([...draft.names],['Missing','Weak owned']);assert.equal(context.dirty,true);
});
test('import cannot partially change either list when the hunt list limit would be exceeded',()=>{
  const {context,draft,messages}=harness();draft.names=Array.from({length:100},(_,i)=>'Manual '+i);draft.replacementNames=[];
  vm.runInContext("addTier('Exotic','capture');",context);assert.equal(draft.names.length,100);assert.deepEqual(draft.replacementNames,[]);
  assert.match(messages.at(-1),/100 targets/);
});

test('batch capture and training imports skip locked maps for the current account',()=>{
  const {context,draft}=harness();
  context.state.huntAvailability.Missing={available:false,reason:'Map locked'};
  draft.names=[];draft.replacementNames=[];
  vm.runInContext("addTier('Exotic','capture');",context);
  assert.deepEqual([...draft.names],['Weak owned']);
  assert.deepEqual([...draft.replacementNames],['Weak owned']);
  draft.names=[];draft.replacementNames=['Missing','Weak owned'];
  vm.runInContext('importTierTargets();',context);
  assert.deepEqual([...draft.names],['Weak owned']);
});

test('an older running backend shows an actionable restart reason instead of indefinite checking',()=>{
  const {context}=harness();delete context.state.huntAvailability;
  const access=vm.runInContext('huntAccess(catalog[0])',context);
  assert.equal(access.available,false);
  assert.equal(access.reason,'Restart website backend');
});

test('the earlier map-only backend cannot enable targets before area rules are loaded',()=>{
  const {context}=harness();delete context.state.huntAccessVersion;
  assert.equal(context.state.huntAvailability.Missing.available,true);
  const access=vm.runInContext('huntAccess(catalog[0])',context);
  assert.equal(access.available,false);assert.equal(access.reason,'Restart website backend');
});
