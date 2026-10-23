import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../lib/engine.mjs';
import {GameError,Transport,unwrap} from '../lib/transport.mjs';
const catalog={teleports:{forest:{}},species:[{id:1,name:'Flue',stops:[{location:'forest',area_id:1,object_id:0,days:[]}]}]};
const protocol={campaign_last:400,campaigns:{forest:{min_level:0}},locations:{forest:2},level_keys:[0,1,4,7]};
const player=()=>({user_id:'me',username:'Tester',level:100,virtue:20,team_order:[1,2,3,4],area:{area_id:1,location:{name:'forest'}},miscrits:[1,2,3,4].map(id=>({id,mId:1,level:id===2?35:10,chp:20,hp:2,spd:2,ea:2,ed:2,pa:2,pd:2})),left_traits:[],battle:''});
function harness(config={}){
  const calls=[],responses={},p=player();
  const transport={connected:true,async rpc(id,payload){calls.push([id,payload]);return typeof responses[id]==='function'?responses[id](payload):responses[id]??(id==='get_player'?structuredClone(p):{});},async join(id){calls.push(['join',id]);},async leave(id){calls.push(['leave',id]);},send(...args){calls.push(['send',...args]);},close(){this.connected=false;}};
  const engine=new Engine({catalog,protocol,config});engine.player=p;engine.transport=transport;
  return {engine,transport,p,calls,responses};
}
function startData(){return {type:'Wild',player1:{user_id:'me',miscrits:[{id:1,mId:1,name:'Flue',level:1,hp:100,chp:100}]},player2:{user_id:'Wild',miscrits:[{id:8,mId:1,name:'Flue',level:1,hp:80,chp:80,rating:18,attempts:0}]},next_turn:'me',capture_chance:80};}
test('only one battle creation runs at once; late creation joins after pause without combat',async()=>{
  const {engine,calls,responses}=harness({activity:'campaign'});engine.running=true;
  responses.get_campaign={last_completed:0,tries:0};let release;
  responses.create_battle=()=>new Promise(resolve=>release=resolve);
  const first=engine.tick();await new Promise(resolve=>setImmediate(resolve));
  await engine.tick();assert.equal(calls.filter(c=>c[0]==='create_battle').length,1);
  engine.stop();release({matchId:'late'});await first;
  assert.equal(engine.battle.id,'late');assert.equal(engine.running,false);assert.equal(calls.some(c=>c[0]==='send'),false);
});
test('two fainted teammates heal once before stage; insufficient virtue blocks creation',async()=>{
  const {engine,p,calls,responses}=harness({activity:'campaign'});p.miscrits[1].chp=0;p.miscrits[2].chp=0;engine.running=true;
  responses.get_campaign={last_completed:0,tries:0};responses.heal_team=()=>{p.virtue-=10;p.miscrits.forEach(m=>m.chp=50);return {};};responses.create_battle={matchId:'next'};
  await engine.tick();assert.equal(calls.filter(c=>c[0]==='heal_team').length,1);assert.ok(calls.findIndex(c=>c[0]==='heal_team')<calls.findIndex(c=>c[0]==='create_battle'));
  const second=harness({activity:'campaign'});second.p.virtue=9;second.p.miscrits[1].chp=0;second.p.miscrits[2].chp=0;second.responses.get_campaign={last_completed:0,tries:0};second.engine.running=true;
  await second.engine.tick();assert.equal(second.engine.running,false);assert.equal(second.calls.some(c=>c[0]==='create_battle'),false);
});
test('unknown create result stops and blocks restart instead of repeating mutations',async()=>{
  const {engine,responses,calls}=harness({names:['Flue']});responses.create_battle=()=>{throw new GameError('timeout',true);};engine.running=true;
  await engine.tick();await engine.tick();assert.equal(calls.filter(c=>c[0]==='create_battle').length,1);assert.equal(engine.uncertain,true);assert.throws(()=>engine.start());
});

test('normal item drops and cooldown responses after victory keep hunting without immediate retries',async()=>{
  for(const data of [{drop:{type:'gold',amount:5}},{cooldown:true}]){
    const {engine,responses,calls}=harness({names:['Flue'],mode:'capture_any'});
    await engine.join('won');await engine.receive('won',0,startData());engine.battle.winner='me';engine.running=true;
    await engine.receive('won',9,{});
    responses.create_battle=()=>unwrap({success:false,data:JSON.stringify(data)},'create_battle');
    await engine.tick();
    assert.equal(engine.running,true);assert.equal(engine.battle,null);assert.equal(engine.uncertain,false);
    assert.match(engine.status,data.cooldown?/cooling down/:/Item drop/);
    assert.match(engine.status,/forest \/ area 1 \/ object 0/);
    assert.ok(engine.cooldowns.get('forest:1:0')>Date.now()+29000);
    engine.nextCycle=0;await engine.tick();
    assert.equal(calls.filter(c=>c[0]==='create_battle').length,1);
  }
});

test('search pacing stops a second search and account refresh until the configured interval expires',async()=>{
  const {engine,responses,calls}=harness({names:['Flue'],searchIntervalSeconds:10});
  responses.create_battle=()=>unwrap({success:false,data:{drop:{gold:1}}},'create_battle');engine.running=true;
  await engine.tick();assert.ok(engine.nextCycle>=Date.now()+9500);
  const requests=calls.length;await engine.tick();assert.equal(calls.length,requests);
});

test('disabled objects, exhausted limits and unknown rejections pause with request and location details',async()=>{
  for(const data of [{disabled:true,drop:{gold:5}},{limit:true},{message:'Area is locked'},{}]){
    const {engine,responses,calls}=harness({names:['Flue']});
    responses.create_battle=()=>unwrap({success:false,data},'create_battle');engine.running=true;
    await engine.tick();await engine.tick();
    assert.equal(engine.running,false);assert.equal(engine.uncertain,false);
    assert.match(engine.status,/\[create_battle\]/);assert.match(engine.status,/Search: forest \/ area 1 \/ object 0/);
    if(data.message)assert.match(engine.status,/Area is locked/);
    if(!Object.keys(data).length)assert.match(engine.status,/No reason was supplied/);
    assert.equal(calls.filter(c=>c[0]==='create_battle').length,1);
  }
});

test('rejected travel identifies the location and never searches an unconfirmed area',async()=>{
  const {engine,p,responses,calls}=harness({names:['Flue']});p.area.area_id=2;
  responses.update_location=()=>unwrap({success:false,data:{message:'Area locked'}},'update_location');engine.running=true;
  await engine.tick();assert.equal(engine.running,false);assert.match(engine.status,/\[update_location\].*Moving to forest/);
  assert.equal(calls.some(c=>c[0]==='create_battle'),false);assert.equal(engine.player.area.area_id,2);
  assert.equal(engine.snapshot().huntAvailability.Flue.reason,'Travel rejected');
  engine.nextCycle=0;engine.start();await engine.tick();
  assert.equal(calls.filter(c=>c[0]==='update_location').length,1,'a rejected area must not be submitted again after Start');
  assert.equal(engine.snapshot().huntAvailability.Flue.available,false);
});

test('a server daily limit excludes that object across polls and manual restart while other objects remain usable',async()=>{
  const {engine,p,responses,calls}=harness({names:['Flue']});
  engine.catalog={...catalog,species:[...catalog.species,{id:2,name:'Other',stops:[{location:'forest',area_id:1,object_id:1,days:[]}]}]};
  engine.config.names.push('Other');
  responses.create_battle=payload=>unwrap({success:false,data:payload.payload.objectId===0?{limit:true}:{drop:{gold:1}}},'create_battle');
  engine.running=true;await engine.tick();
  assert.equal(engine.running,false,'a limit pauses for review; its server-wide scope is unknown');
  assert.equal(engine.lastStop.category,'Server search limit');
  assert.match(engine.lastStop.action,/Other targets may also be limited/);
  assert.equal(engine.snapshot().huntAvailability.Flue.reason,'Daily limit reached');
  assert.equal(engine.snapshot().huntAvailability.Other.available,true);
  assert.match(engine.snapshot().queue.targets.find(t=>t.name==='Flue').reason,/server reported a daily search limit/);
  engine.nextCycle=0;engine.start();await engine.tick();
  assert.deepEqual(calls.filter(c=>c[0]==='create_battle').map(c=>c[1].payload.objectId),[0,1]);
  assert.equal(engine.running,true);assert.equal(engine.player._huntLimitedObjects['forest:1:0']!==undefined,true);
});

test('saved Jungle targets cannot send travel or search requests through the area-4 boss gate',async()=>{
  const {engine,p,calls}=harness();
  engine.catalog={teleports:{miscrian_jungle:{requirement:'wind_elementum'}},species:[{id:1,name:'Bunaken',stops:[{location:'miscrian_jungle',area_id:4,object_id:0}]}]};
  engine.config.names=['Bunaken'];p.boss_achievements={wind_elementum:true,magicite_warden:true,magicite_herald:true};engine.running=true;
  await engine.tick();
  assert.equal(engine.running,false);assert.match(engine.status,/Magicite Goremand.*area 4/);
  assert.equal(calls.some(c=>c[0]==='update_location'||c[0]==='create_battle'),false);
  const snapshot=engine.snapshot();
  assert.equal(snapshot.huntAvailability.Bunaken.reason,'Area locked');
  assert.match(snapshot.queue.targets[0].reason,/Magicite Goremand/);
  p.boss_achievements.magicite_goremand=true;await engine.refresh();
  assert.equal(engine.snapshot().huntAvailability.Bunaken.available,true);
});

test('RPC rejection details are limited to messages and known flags, with sensitive strings redacted',async()=>{
  assert.throws(()=>unwrap({success:false,data:JSON.stringify({message:'Locked\npassword=secret token=private someone@example.com',token:'hidden',drop:false})},'create_battle'),error=>{
    assert.match(error.message,/Locked/);assert.doesNotMatch(error.message,/secret|private|someone@example.com|hidden|\n/);
    assert.deepEqual(error.searchOutcome,{cooldown:false,disabled:false,limit:false,drop:false});return true;
  });
  const transport=new Transport(()=>{},()=>{});transport.request=async()=>{throw new GameError('Timed out',true);};
  await assert.rejects(()=>transport.rpc('update_team'),error=>error.uncertain && error.rpcId==='update_team' && /\[update_team\]/.test(error.message));
});
test('daily attempts and stage limits stop before creating another campaign battle',async()=>{
  for(const [info,wins] of [[{last_completed:1,tries:10},0],[{last_completed:400,tries:0},0],[{last_completed:1,tries:0},10]]){
    const {engine,responses,calls}=harness({activity:'campaign'});responses.get_campaign=info;engine.wins=wins;engine.running=true;await engine.tick();assert.equal(engine.running,false);assert.equal(calls.some(c=>c[0]==='create_battle'),false);
  }
});
test('manual target stops automation; manual attacks allowed once per authoritative update',async()=>{
  const {engine,calls}=harness({names:['Flue']});engine.metadata.set(1,{ability_order:[11,12],abilities:[{id:11,type:'Attack',name:'Bash',ap:10},{id:12,type:'Attack',name:'Strike',ap:20}]});
  await engine.join('battle');await engine.receive('battle',0,startData());engine.running=true;await engine.combat();
  assert.equal(engine.running,false);assert.equal(engine.battle.manual,true);
  await engine.action('ability',11);await assert.rejects(()=>engine.action('ability',11));
  assert.equal(calls.filter(c=>c[0]==='send'&&c[2]===2).length,1);
});
test('capture retry is blocked and server captures are kept only once',async()=>{
  const {engine,calls}=harness();await engine.join('b');await engine.receive('b',0,startData());engine.battle.foe.miscrits[0].attempts=1;
  await assert.rejects(()=>engine.action('capture'));engine.battle.foe.miscrits[0].attempts=0;
  await engine.action('capture');engine.running=true;await engine.receive('b',10,{user_id:'me',captured:true,pending:true,stars:{}});
  assert.equal(calls.filter(c=>c[0]==='send'&&c[2]===11).length,1);
  await engine.receive('b',8,{next_turn:'me',pending:true});
  assert.equal(calls.filter(c=>c[0]==='send'&&c[2]===11).length,1);
});
test('READY does not acknowledge an outstanding attack or allow a duplicate action',async()=>{
  const {engine,calls}=harness();engine.metadata.set(1,{ability_order:[11],abilities:[{id:11,type:'Attack',ap:10}]});
  await engine.join('b');await engine.receive('b',0,startData());await engine.action('ability',11);
  await engine.receive('b',8,{next_turn:'me'});await assert.rejects(()=>engine.action('ability',11));
  assert.equal(calls.filter(c=>c[0]==='send'&&c[2]===2).length,1);
  await engine.receive('b',2,{user_id:'me',id:11,actions:[{target:'Wild',type:'Attack',damage:10}],next_turn:'Wild'});
  assert.equal(engine.battle.awaitingAction,false);assert.equal(engine.battle.foe.miscrits[0].chp,70);
});
test('a late replacement acknowledgement is applied while pause prevents a new battle',async()=>{
  const {engine,p,calls,responses}=harness({activity:'campaign',autoReplace:true,replacementNames:['Flue']});
  p.miscrits.push({id:9,mId:1,level:1,chp:30,hp:3,spd:3,ea:3,ed:3,pa:3,pd:3});
  let release;responses.update_team=payload=>new Promise(resolve=>release=()=>{p.team_order=payload.team;resolve({});});engine.running=true;
  const pending=engine.tick();await new Promise(resolve=>setImmediate(resolve));engine.stop();release();await pending;
  assert.deepEqual(engine.player.team_order,[1,9,3,4]);assert.equal(calls.some(c=>c[0]==='create_battle'),false);
});
test('campaign does not create a stage after rejected healing or stale post-heal HP',async()=>{
  for(const rejected of [true,false]){
    const {engine,p,calls,responses}=harness({activity:'campaign'});p.miscrits[1].chp=0;p.miscrits[2].chp=0;
    responses.get_campaign={last_completed:0,tries:0};responses.heal_team=()=>{if(rejected)throw new GameError('heal rejected');return {};};engine.running=true;
    await engine.tick();assert.equal(engine.running,false);assert.equal(calls.some(c=>c[0]==='create_battle'),false);
  }
});
test('socket payloads use base64 JSON; request errors do not expose credentials',async()=>{
  const sent=[];const transport=new Transport(()=>{},()=>{});transport.socket={readyState:1,send:v=>sent.push(JSON.parse(v))};transport.send('battle',2,{id:4});
  assert.deepEqual(JSON.parse(Buffer.from(sent[0].match_data_send.data,'base64').toString()),{id:4});
  assert.equal(unwrap(JSON.stringify({success:true,data:JSON.stringify({x:1})})).x,1);
  assert.throws(()=>unwrap({success:false}));
  assert.throws(()=>unwrap('{bad'),error=>error.uncertain===true);
  assert.throws(()=>unwrap({success:true,data:'{bad'}),error=>error.uncertain===true);
  const result=transport.request({rpc:{id:'heal_team',payload:'{}'}});transport.receive({cid:sent.at(-1).cid,error:{message:'rejected'}});await assert.rejects(result);
});
test('omitted protobuf operation code is START zero, not NaN',()=>{
  const frames=[],transport=new Transport((id,opcode,data)=>frames.push({opcode,data}),()=>{});
  const data=startData();transport.receive({match_data:{match_id:'b',data:Buffer.from(JSON.stringify(data)).toString('base64')}});
  assert.equal(frames[0].opcode,0);assert.equal(frames[0].data.type,'Wild');
});
test('authentication matches native headers and never creates a new game account',async()=>{
  const requests=[];
  const fakeFetch=async(url,options)=>{requests.push([url,options]);if(url.includes('authenticate'))return {ok:true,json:async()=>({token:'test-session',refresh_token:'test-refresh'})};return {ok:true,json:async()=>({server:'63.183.56.199'})};};
  const transport=new Transport(()=>{},()=>{},fakeFetch);let socketUrl='';transport.connect=async url=>{socketUrl=url;};
  await transport.login('TrainerName','password-not-real');
  assert.equal(requests[0][1].headers['User-Agent'],'GodotEngine/4.6 (Windows)');
  assert.equal(new URL(requests[0][0]).searchParams.get('create'),'false');
  assert.equal(new URL(requests[0][0]).searchParams.get('username'),'TrainerName');
  assert.deepEqual(JSON.parse(requests[0][1].body),{email:'',password:'password-not-real'});
  assert.match(socketUrl,/^ws:\/\/63\.183\.56\.199:7350\/ws\?/);
});
test('selected target pauses immediately on START, including an opponent-first encounter',async()=>{
  const {engine,calls}=harness({names:['Flue'],mode:'manual_target'});await engine.join('b');engine.running=true;
  const data=startData();data.next_turn='Wild';await engine.receive('b',0,data);
  assert.equal(engine.running,false);assert.equal(engine.battle.manual,true);assert.equal(calls.some(c=>c[0]==='send'&&c[2]===2),false);
});
test('native informational effects are accepted and cleanser unlocks a paralyzed teammate',async()=>{
  const {engine}=harness();await engine.join('b');await engine.receive('b',0,startData());engine.battle.player.miscrits[0].paralyzed=true;
  await engine.receive('b',2,{user_id:'me',id:11,actions:[{type:'Special'},{type:'Cleanser',target:'me'}],next_turn:'me'});
  assert.equal(engine.battle.player.miscrits[0].paralyzed,false);
});
test('sleep and paralysis expire on their owner turn instead of locking controls indefinitely',async()=>{
  const {engine}=harness();await engine.join('b');await engine.receive('b',0,startData());
  await engine.receive('b',2,{user_id:'Wild',id:7,actions:[{type:'Sleep',turns:1,target:'me'},{type:'Paralyze',turns:1,target:'me'}],next_turn:'me'});
  const member=engine.battle.player.miscrits[0];assert.equal(member.handicap,true);assert.equal(member.paralyzed,true);
  await engine.receive('b',6,{user_id:'me',actions:[],next_turn:'Wild'});
  assert.equal(member.handicap,false);assert.equal(member.paralyzed,false);
});
test('restored battle status survives reconnect until authoritative turn expiry',async()=>{
  const {engine}=harness();await engine.join('b');const start=startData();start.player1.status=[{type:'Confuse',turns:2}];await engine.receive('b',0,start);
  assert.equal(engine.battle.player.miscrits[0].handicap,true);
});
test('informational READY may precede START while joining a native battle',async()=>{
  const {engine}=harness();await engine.join('b');
  await engine.receive('b',8,{});assert.equal(engine.battle.joining,true);
  await engine.receive('b',0,startData());assert.equal(engine.battle.joining,false);
});
test('a new wild opponent gets a fresh weakening budget and ongoing-damage guard',async()=>{
  const {engine}=harness();await engine.join('b');const data=startData();data.player2.miscrits.push({...data.player2.miscrits[0],id:9});await engine.receive('b',0,data);
  engine.battle.attacks=12;engine.battle.damageRisk=true;engine.switchTo(engine.battle.foe,9);
  assert.equal(engine.battle.attacks,0);assert.equal(engine.battle.damageRisk,false);
});
