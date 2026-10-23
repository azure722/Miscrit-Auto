import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
test('frontend controls reference existing, unique elements and all navigation panels exist',()=>{
  const html=['App.jsx','Workspace.jsx',...readdirSync(new URL('../src/panels/',import.meta.url)).map(n=>'panels/'+n)].map(n=>readFileSync(new URL('../src/'+n,import.meta.url),'utf8')).join('\n');
  const js=readFileSync(new URL('../src/controller.js',import.meta.url),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const [,id] of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(id),'Missing DOM element '+id);
  for(const [,tab] of html.matchAll(/data-tab="([^"]+)"/g)) assert.ok(ids.includes('tab-'+tab));
  assert.match(html,/autoComplete="current-password"/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML/);
});

test('tier prerequisites distinguish signed-out, reconnecting, unloaded index and valid empty index',()=>{
  const js=readFileSync(new URL('../src/controller.js',import.meta.url),'utf8');
  const helper=js.slice(js.indexOf('function tierAccess('),js.indexOf('function addTier('));
  const context=vm.createContext({state:null});vm.runInContext(helper,context);
  assert.equal(vm.runInContext('tierAccess().action',context),'Sign in');
  context.state={player:{},connected:true,reconnecting:true,collectionIndex:{}};
  assert.match(vm.runInContext('tierAccess().reason',context),/Reconnecting/);
  context.state.reconnecting=false;context.state.collectionIndex=null;
  assert.equal(vm.runInContext('tierAccess().action',context),'Reload account data');
  context.state.collectionIndex={};assert.equal(vm.runInContext('tierAccess().ready',context),true);
  context.state.connected=false;assert.equal(vm.runInContext('tierAccess().action',context),'Reconnect');
});

test('account polling updates the React team bridge while preserving unsaved settings',()=>{
  const js=readFileSync(new URL('../src/controller.js',import.meta.url),'utf8');
  const render=js.slice(js.indexOf('function render(){'),js.indexOf('async function poll(){'));
  const elements=new Map();let teams=0,loads=0;
  const draft={replacementNames:['My unsaved selection']};
  const context=vm.createContext({dirty:true,draft,tab:'team',state:{connected:true,reconnecting:false,busy:false,running:false,player:{roster:[]},config:{replacementNames:[]}},$:id=>{if(!elements.has(id))elements.set(id,{classList:{toggle(){}}});return elements.get(id);},loadDraft(){loads++;},renderTeam(){teams++;},renderBattle(){}});
  vm.runInContext(render+';render();',context);
  assert.equal(teams,1);assert.equal(loads,0);assert.deepEqual(draft.replacementNames,['My unsaved selection']);
});
