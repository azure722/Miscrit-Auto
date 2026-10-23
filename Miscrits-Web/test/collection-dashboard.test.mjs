import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/controller.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function buildCollectionRows('),source.indexOf('function renderCollection('));
const context=vm.createContext({});vm.runInContext(helpers,context);
const build=context.buildCollectionRows,filter=context.filterCollectionRows,summarize=context.summarizeCollection;
const catalog=[{id:1,name:'Exotic A',rarity:'Exotic',names:['Exotic A','Evolved A']},{id:2,name:'Rare B',rarity:'Rare'},{id:3,name:'Common C',rarity:'Common'},{id:4,name:'Exotic D',rarity:'Exotic'}];
const roster=[{id:10,mId:1,name:'My nickname',rating:18,level:2},{id:11,mId:1,name:'Evolved A',rating:12,level:35},{id:20,mId:2,name:'Rare B',rating:16,level:5}];
test('one row per family keeps all copies, chooses best by rating, and checks completion across every copy',()=>{
  const rows=build(catalog,roster,{}),a=rows.find(row=>row.id===1);
  assert.equal(rows.length,4);assert.equal(a.ownedCount,2);assert.equal(a.bestRating,18);assert.equal(a.bestLevel,2);assert.equal(a.highestLevel,35);assert.equal(a.complete,true);
  assert.equal(a.copies[0].id,10);assert.equal(filter(rows,{search:'evolved a'}).length,1);assert.equal(filter(rows,{search:'MY NICKNAME'}).length,1);
});
test('a released captured fourth form is missing from current ownership but remains complete in the index',()=>{
  const rows=build(catalog,roster,{3:{complete:true,captured:[true,true,true,true]}}),c=rows.find(row=>row.id===3);
  assert.equal(c.ownedCount,0);assert.equal(c.complete,true);assert.equal(c.indexedCompletion,true);assert.equal(c.previouslyCaptured,true);
  assert.equal(filter(rows,{ownership:'missing',completion:'complete'}).length,1);
});
test('unloaded index keeps historical completion unknown instead of marking it incomplete',()=>{
  const rows=build(catalog,roster,null);assert.equal(rows.find(row=>row.id===2).complete,null);
  assert.equal(rows.find(row=>row.id===1).complete,true);assert.equal(filter(rows,{completion:'incomplete'}).length,0);
  assert.equal(filter(rows,{completion:'unknown'}).length,3);
});
test('tier, ownership, rating, completion and text filters combine while missing copies are excluded from rating ranges',()=>{
  const rows=build(catalog,roster,{});
  assert.equal(filter(rows,{tier:'Rare',ownership:'owned',rating:'below',completion:'incomplete',search:'rare'}).length,1);
  assert.equal(filter(rows,{rating:'qualified'}).length,1);assert.equal(filter(rows,{ownership:'missing',rating:'below'}).length,0);
  assert.equal(filter(rows,{search:'absent nickname'}).length,0);
});
test('sorting is deterministic and completion totals count families instead of duplicate copies',()=>{
  const rows=build(catalog,roster,{}),totals=summarize(rows);
  assert.deepEqual({...totals},{total:4,owned:2,missing:2,copies:3,qualified:1,complete:1});
  assert.deepEqual([...filter(rows,{sort:'tier'})].map(row=>row.name),['Exotic A','Exotic D','Rare B','Common C']);
  assert.deepEqual([...filter(rows,{sort:'rating'})].slice(0,2).map(row=>row.id),[1,2]);
  assert.equal(filter(rows,{sort:'level'})[0].highestLevel,35);
});
test('additional owned species absent from the mapping catalog remain visible in the dashboard',()=>{
  const rows=build(catalog,[...roster,{id:70,mId:700,name:'New species',rating:17,level:10}],{});
  const extra=rows.find(row=>row.id===700);assert.equal(extra.rarity,'Unlisted');assert.equal(extra.name,'New species');
  assert.equal(filter(rows,{tier:'Unlisted',rating:'qualified'}).length,1);assert.equal(summarize(rows).owned,3);
});
test('equal ratings prefer higher level then lower individual ID without modifying the snapshot',()=>{
  const copies=[{id:8,mId:1,rating:17,level:5},{id:7,mId:1,rating:17,level:10},{id:6,mId:1,rating:17,level:10}];
  const row=build(catalog,copies,{})[0];assert.deepEqual([...row.copies].map(m=>m.id),[6,7,8]);assert.equal(copies[0].id,8);
});
function rendererFixture(state,entries=catalog){
  class Element {
    constructor(tag='div',className='',text=''){Object.assign(this,{tag,className,textContent:text,children:[],dataset:{},handlers:{},value:'all',hidden:false,disabled:false});}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
    setAttribute(name,value){this[name]=value;}
    addEventListener(name,handler){this.handlers[name]=handler;}
    querySelectorAll(selector){const all=this.children.flatMap(child=>[child,...(child.querySelectorAll?.(selector)||[])]);return all.filter(child=>selector==='details[open]'&&child.tag==='details'&&child.open);}
  }
  const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  $('collection-search').value='';$('collection-sort').value='tier';
  const ctx=vm.createContext({state,catalog:entries,trainingTiers:['Exotic','Rare','Common','Epic','Legendary'],collectionPage:1,collectionRenderKey:'',$,
    element:(tag,css,text)=>new Element(tag,css,text),image:()=>new Element('img')});
  const code=source.slice(source.indexOf('function buildCollectionRows('),source.indexOf("for(const id of ['collection-search'"));
  vm.runInContext(code,ctx);return {ctx,$,render:()=>vm.runInContext('renderCollection()',ctx)};
}
test('rendered collection paginates, combines filters and preserves filters while roster counts update',()=>{
  const entries=Array.from({length:30},(_,i)=>({id:i+1,name:'Species '+String(i+1).padStart(2,'0'),rarity:i<15?'Exotic':'Rare'}));
  const state={connected:true,player:{roster:[{id:10,mId:1,name:'One',level:1,rating:18}]},collectionIndex:{}};
  const {$,ctx,render}=rendererFixture(state,entries);render();
  assert.equal($('collection-grid').children.length,24);assert.equal($('collection-next').disabled,false);assert.equal($('collection-prev').disabled,true);
  ctx.collectionPage=2;render();assert.equal($('collection-grid').children.length,6);assert.equal($('collection-next').disabled,true);
  $('collection-tier').value='Exotic';$('collection-ownership').value='owned';render();
  assert.equal(ctx.collectionPage,1);assert.equal($('collection-grid').children.length,1);
  state.player.roster.push({id:20,mId:2,name:'Two',level:30,rating:17});render();
  assert.equal($('collection-grid').children.length,2);assert.equal($('collection-complete').textContent,1);assert.equal($('collection-tier').value,'Exotic');
  const card=$('collection-grid').children[0],details=card.children.find(child=>child.tag==='details');details.open=true;
  state.player.roster[0].level=2;render();assert.equal($('collection-grid').children[0].children.find(child=>child.tag==='details').open,true);
});
test('signed-out render shows account action and never invents missing or completion counts',()=>{
  const {$,render}=rendererFixture({player:null,connected:false,collectionIndex:null});render();
  assert.equal($('collection-owned').textContent,'-');assert.equal($('collection-missing').textContent,'-');assert.equal($('collection-grid').children.length,0);
  assert.equal($('collection-account-action').hidden,false);assert.equal($('collection-account-action').textContent,'Sign in');assert.equal($('collection-search').disabled,true);
  assert.equal($('collection-empty').hidden,false);assert.match($('collection-empty').textContent,/Sign in/);
});
