import test from 'node:test';
import assert from 'node:assert/strict';
import {huntAvailability,routePlan,AREA_REQUIREMENTS} from '../lib/model.mjs';
import {readFileSync} from 'node:fs';

const stop=(location,area_id=1,days=[])=>({location,area_id,object_id:1,days});
const species=(name,stops)=>({id:name,name,stops});
const catalog={teleports:{forest:{},mansion:{requirement:'mansion_boss'},moon:{ticket:'moon'}},species:[
  species('Forest',[stop('forest')]),species('Mansion',[stop('mansion')]),species('Moon',[stop('moon')]),
  species('Deep Moon',[stop('moon',2)]),species('Shack',[stop('shack',3)]),species('Temple',[stop('temple',4)]),
  species('Scheduled',[stop('forest',1,[2])]),species('Unmapped',[]),species('Mixed',[stop('mansion'),stop('forest')])
]};

test('availability distinguishes map, ticket, area and day restrictions without blocking accessible alternatives',()=>{
  const player={tickets:{},boss_achievements:{}},access=huntAvailability(player,catalog,1);
  assert.equal(access.Forest.available,true);assert.equal(access.Mixed.available,true);
  assert.equal(access.Mansion.reason,'Map locked');assert.equal(access.Moon.reason,'Ticket required');
  assert.equal(access.Shack.reason,'Area locked');assert.equal(access.Temple.reason,'Area locked');
  assert.equal(access.Scheduled.reason,'Not today');assert.equal(access.Unmapped.reason,'No wild location');
  for(const entry of catalog.species)assert.equal(access[entry.name].available,routePlan({names:[entry.name]},player,catalog,1).stops.length>0);
});

test('each outdoor area requires its own boss, independently of map entry',()=>{
  for(const [location,gates]of Object.entries(AREA_REQUIREMENTS)){
    if(!gates[2]||!gates[3]||!gates[4])continue;
    const region={teleports:{[location]:{requirement:'entry_boss'}},species:[1,2,3,4].map(area=>species('Area '+area,[stop(location,area)]))};
    const player={boss_achievements:{entry_boss:true}};
    for(let unlocked=1;unlocked<=4;unlocked++){
      if(unlocked>1)player.boss_achievements[gates[unlocked]]=true;
      const access=huntAvailability(player,region);
      for(let area=1;area<=4;area++)assert.equal(access['Area '+area].available,area<=unlocked,location+' area '+area);
    }
  }
});

test('real Bunaken and Light Lavarilla mappings stay locked until Goremand is defeated',()=>{
  const real=JSON.parse(readFileSync(new URL('../../Auto-Capture-Game-Installer/source/capture_catalog.json',import.meta.url),'utf8'));
  const targets=['Bunaken','Light Lavarilla','Lavarilla'];
  const catalog={...real,species:real.species.filter(s=>targets.includes(s.name))};
  assert.equal(catalog.species.length,3);
  const player={boss_achievements:{wind_elementum:true,magicite_warden:true,magicite_herald:true,nature_elementum:true}};
  const access=huntAvailability(player,catalog);
  for(const name of ['Bunaken','Light Lavarilla']){
    assert.equal(access[name].available,false);assert.equal(access[name].requirement,'magicite_goremand');
    assert.match(access[name].detail,/Magicite Goremand.*area 4/);
  }
  assert.equal(access.Lavarilla.available,true,'Mansion remains an accessible alternate location');
  const route=routePlan({names:targets},player,catalog);
  assert.ok(route.stops.length>0);assert.ok(route.stops.every(s=>s.location==='mansion'));
  player.boss_achievements.magicite_goremand=true;
  for(const name of targets)assert.equal(huntAvailability(player,catalog)[name].available,true);
});

test('live spawn removals cannot leave a stale mapped object selectable',()=>{
  const catalog={teleports:{forest:{}},species:[{...species('Moved',[stop('forest',1)]),locations:{Forest:{'2':[]}}}]};
  assert.equal(routePlan({names:['Moved']},{},catalog).stops.length,0);
  assert.equal(huntAvailability({},catalog).Moved.reason,'Spawn mapping changed');
});

test('availability is recalculated per account, unlock, ticket and daily schedule',()=>{
  const unlocked={tickets:{moon:1},boss_achievements:{mansion_boss:true,singularitas:true,ylil_nosaj:true,the_temple_trial:true}};
  const access=huntAvailability(unlocked,catalog,2);
  for(const name of ['Mansion','Moon','Deep Moon','Shack','Temple','Scheduled'])assert.equal(access[name].available,true,name);
  assert.equal(huntAvailability({tickets:{moon:1}},catalog,2)['Deep Moon'].reason,'Area locked');
  assert.equal(huntAvailability({},catalog,2).Mansion.available,false);
  assert.equal(huntAvailability(null,catalog,2).Forest.reason,'Sign in to check maps');
});
