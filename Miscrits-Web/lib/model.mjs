export const DEFAULTS = Object.freeze({activity:'wild', mode:'manual_target', names:[],primaryTarget:'', minRating:17, searchIntervalSeconds:8, captureThreshold:70, captureLowRatedTargets:false, autoRemoveCapturedTargets:true, fleeUnwanted:true, maxAttacks:12, campaignLimit:10, autoLevel:false, platinumUpgradeIds:[], trainSelected:false, autoReplace:false, replacementNames:[],wildAutoHeal:false,wildHealBudget:30,notifyEvents:true,arenaType:'Default',arenaStrategy:'smart',arenaBattleLimit:10,arenaStopOnLoss:true,arenaAllowInjured:false});
export const TRAINING_TIERS=Object.freeze(['Exotic','Rare','Common','Epic','Legendary']);
export const TRAINING_MIN_RATING=17;
export function settings(input, catalog) {
  const result = {...DEFAULTS};
  for (const key of ['activity','mode','arenaType','arenaStrategy']) if (typeof input[key] === 'string') result[key] = input[key];
  if(input.arenaStrategy!==undefined&&(typeof input.arenaStrategy!=='string'||!['smart','basic'].includes(result.arenaStrategy)))throw new Error('Choose a supported arena strategy.');
  if (!['wild','campaign','arena'].includes(result.activity)) throw new Error('Choose a supported activity.');
  if(input.arenaType!==undefined && (typeof input.arenaType!=='string'||!['Default','Platinum','Random'].includes(result.arenaType)))throw new Error('Choose a supported arena.');
  if (!['fight','capture_any','capture_missing','capture_targeted','capture_rated','manual_target'].includes(result.mode)) throw new Error('Choose a supported battle mode.');
  for (const key of ['names','replacementNames']) {
    if (input[key] === undefined) continue;
    if (!Array.isArray(input[key]) || input[key].length > (key==='replacementNames'?Math.max(100,catalog.species.length):100)) throw new Error('Invalid selected names.');
    result[key] = [...new Set(input[key].map(name => {
      if (typeof name !== 'string') throw new Error('Invalid Miscrit name.');
      const entry = catalog.species.find(s => s.name.toLowerCase() === name.toLowerCase());
      if (!entry) throw new Error('Unknown Miscrit: ' + name.slice(0,60));
      return entry.name;
    }))];
  }
  for (const [key, max, min] of [['minRating',18,0],['searchIntervalSeconds',120,3],['captureThreshold',100,1],['maxAttacks',50,1],['campaignLimit',10,1],['wildHealBudget',1000,0],['arenaBattleLimit',1000,1]]) {
    if (input[key] === undefined) continue;
    if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) throw new Error('Invalid value for ' + key);
    result[key] = input[key];
  }
  if(input.primaryTarget!==undefined){
    if(typeof input.primaryTarget!=='string')throw new Error('Primary target must be a selected species name.');
    const selected=result.names.find(name=>name.toLowerCase()===input.primaryTarget.toLowerCase());
    result.primaryTarget=selected||'';
  }
  for (const key of ['autoLevel','trainSelected','autoReplace','fleeUnwanted','captureLowRatedTargets','autoRemoveCapturedTargets','wildAutoHeal','notifyEvents','arenaStopOnLoss','arenaAllowInjured']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('Invalid ' + key);
    if (input[key] !== undefined) result[key] = input[key];
  }
  if(input.platinumUpgradeIds!==undefined){
    if(!Array.isArray(input.platinumUpgradeIds)||input.platinumUpgradeIds.length>1000||input.platinumUpgradeIds.some(id=>!Number.isSafeInteger(id)||id<=0))throw new Error('Invalid platinum upgrade selection.');
    result.platinumUpgradeIds=[...new Set(input.platinumUpgradeIds)];
  }
  return result;
}
export function owned(raw, metadata = new Map()) {
  const v2 = raw.v === 2;
  const id = Number(raw.id), mId = Number(v2 ? raw.m : raw.mId);
  const level = Number(v2 ? raw.l : raw.level);
  const statKeys = v2 ? ['h','s','e','p','d','pd'] : ['hp','spd','ea','pa','ed','pd'];
  const rating = statKeys.reduce((sum,key) => sum + Number(raw[key] ?? 0), 0);
  const meta = metadata.get(mId);
  return {id,mId,level,chp:Number(v2 ? raw.c : raw.chp),rating,
    name:(v2 ? raw.n : raw.nick) || meta?.names?.[Math.min(3,Math.floor(level / 10))] || meta?.name || ('Miscrit '+mId)};
}
export function trainingStatus(raw, protocol) {
  const level=raw.v===2?raw.l:raw.level;
  const xp=raw.v===2?raw.x:raw.exp;
  const required=protocol.training_xp?.[String(level)];
  const valid=Number.isInteger(level) && level>=1 && level<35 && Number.isInteger(xp) && xp>=0 && Number.isInteger(required) && required>0;
  return {xp:Number.isInteger(xp)&&xp>=0?xp:null,xpNeeded:valid?required:null,readyToTrain:valid && xp>=required};
}
export function collectionFamilies(player) {
  if (!Array.isArray(player?.miscrits)) throw new Error('Collection is not loaded. Reconnect before capturing missing species.');
  const result=new Set();
  for (const raw of player.miscrits) {
    const family=raw.v===2?raw.m:raw.mId;
    if (!Number.isInteger(family) || family<=0) throw new Error('Collection has an unknown species. Reconnect before capturing missing species.');
    result.add(family);
  }
  return result;
}
export function miscritsIndex(raw) {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw new Error('Miscrits index response is incomplete.');
  const result={};
  for(const [key,packed] of Object.entries(raw)) {
    if(!/^[1-9]\d*$/.test(key) || !Number.isInteger(packed) || packed<0 || packed>9999) throw new Error('Miscrits index response is unreadable.');
    const digits=[0,1,2,3].map(evo=>Math.floor(packed/10**evo)%10);
    result[key]={seen:digits.map(flag=>flag>0),captured:digits.map(flag=>flag===2),complete:digits[3]===2};
  }
  return result;
}
export function selectedTrainingPlan(player,names,catalog,metadata,index=null) {
  const roster=(player.miscrits||[]).map(m=>owned(m,metadata));
  const byId=new Map(roster.map(m=>[m.id,m]));
  const team=player.team_order;
  if (!Array.isArray(team) || !team.length || team.length>4 || new Set(team).size!==team.length || team.some(id=>!byId.has(id))) throw new Error('Team is not fully loaded.');
  const ranked=[...roster].filter(m=>Number.isInteger(m.id) && Number.isInteger(m.level) && m.level>=1 && m.level<=35 && m.rating>=0 && m.rating<=18).sort((a,b)=>b.rating-a.rating || b.level-a.level || a.id-b.id);
  const priority=name=>{const value=TRAINING_TIERS.indexOf(catalog.species.find(s=>s.name===name)?.rarity);return value<0?5:value;};
  const orderedNames=[...new Set(names)].sort((a,b)=>priority(a)-priority(b) || a.localeCompare(b));
  const best=[],missing=[],complete=[],needsCapture=[];
  for (const name of orderedNames) {
    const family=catalog.species.find(s=>s.name===name)?.id;
    const member=ranked.find(m=>m.mId===family);
    if (index?.[family]?.complete || roster.some(m=>m.mId===family && m.level>=30)) complete.push(name);
    else if (!member || member.rating<TRAINING_MIN_RATING) {needsCapture.push(name);if(!member)missing.push(name);}
    else if (member.id!==team[0]) best.push(member);
  }
  const memberPriority=m=>priority(catalog.species.find(s=>s.id===m.mId)?.name);
  best.sort((a,b)=>memberPriority(a)-memberPriority(b) || b.rating-a.rating || b.level-a.level || a.id-b.id);
  // Keep a chosen copy in its current slot while it earns XP; do not reorder every level.
  const selected=best.slice(0,3),ids=new Set(selected.map(m=>m.id)),after=[...team];
  const pool=selected.filter(m=>!team.slice(1).includes(m.id));
  for(let slot=1;slot<4;slot++) {
    if(ids.has(after[slot]))continue;
    if(pool.length)after[slot]=pool.shift().id;
  }
  return {before:[...team],after,changed:JSON.stringify(team)!==JSON.stringify(after),traineeIds:selected.map(m=>m.id).filter(id=>after.includes(id)),remaining:best.length,missing,needsCapture,complete,minimumRating:TRAINING_MIN_RATING,indexChecked:index!==null};
}
export function rotationPlan(player, names, catalog, metadata) {
  const roster = new Map((player.miscrits || []).map(m => {const value=owned(m,metadata);return [value.id,value];}));
  const team = player.team_order;
  if (!Array.isArray(team) || team.length < 1 || team.length > 4 || new Set(team).size !== team.length || team.some(id => !roster.has(id))) throw new Error('Team is not fully loaded.');
  const families = new Set(catalog.species.filter(s => names.includes(s.name)).map(s => s.id));
  const pool = [...roster.values()].filter(m => !team.includes(m.id) && m.level > 0 && m.level < 35 && m.rating >= 0 && m.rating <= 18 && families.has(m.mId)).sort((a,b) => b.rating-a.rating || a.id-b.id);
  const after = [...team];
  for (let slot=1; slot<team.length; slot++) if (roster.get(team[slot]).level >= 35 && pool.length) after[slot]=pool.shift().id;
  return {before:[...team],after,changed:after.some((id,i)=>id!==team[i])};
}
// Each outdoor region has separate boss gates between its four search areas.
// Map entry requirements alone do not grant access to the later areas.
export const AREA_REQUIREMENTS={
  forest:{2:'magicite_novice',3:'magicite_neophyte',4:'magicite_adept'},
  mount_gemma:{2:'magicite_apprentice',3:'magicite_general',4:'magicite_commander'},
  sunfall_shores:{2:'magicite_overseer',3:'magicite_mastermind',4:'magicite_overlord'},
  miscrian_jungle:{2:'magicite_warden',3:'magicite_herald',4:'magicite_goremand'},
  monks_mountain:{2:'magicite_monk',3:'magicite_armsmaster',4:'magicite_abbot'},
  moon:{2:'singularitas'},shack:{3:'ylil_nosaj',4:'ylil_nosaj'},temple:{4:'the_temple_trial'}
};
const mapLabels={forest:'Forest',hidden_forest:'Hidden Forest',mount_gemma:'Mount Gemma',mansion:'Mansion',sunfall_shores:'Sunfall Shores',cave:'Cave',moon:'Moon',shack:'Shack',miscrian_jungle:'Miscrian Jungle',monks_mountain:'Monks Mountain',emerald_isle:'Emerald Isle',temple:'Temple'};
const readableKey=key=>key.replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase());
function mapAccessStatus(player,stop,catalog) {
  const gate=catalog.teleports?.[stop.location],achievements=player.boss_achievements||{},area=Number(stop.area_id);
  const blocked=player._huntRejectedAreas?.[stop.location+':'+area];
  if(blocked)return {available:false,reason:'Travel rejected',detail:blocked};
  if(gate?.requirement&&!achievements[gate.requirement])return {available:false,reason:'Map locked',requirement:gate.requirement,detail:'Defeat '+readableKey(gate.requirement)+' to enter '+(mapLabels[stop.location]||stop.location)+'.'};
  if(gate?.ticket&&!player.tickets?.[gate.ticket])return {available:false,reason:'Ticket required',detail:'A '+readableKey(gate.ticket)+' ticket is required.'};
  const requirement=AREA_REQUIREMENTS[stop.location]?.[area]||
    (stop.location==='shack'&&area>=3?'ylil_nosaj':stop.location==='temple'&&area>=4?'the_temple_trial':'');
  if(requirement&&!achievements[requirement])return {available:false,reason:'Area locked',requirement,detail:'Defeat '+readableKey(requirement)+' to unlock '+(mapLabels[stop.location]||stop.location)+' area '+area+'.'};
  return null;
}
function speciesStops(species,catalog){
  return species?.stops?.length?species.stops:(catalog.area_objects||[]).filter(stop=>species?.locations?.[mapLabels[stop.location]]?.[String(stop.area_id)]);
}
export function huntAvailability(player,catalog,day=new Date().getUTCDay()) {
  if(!player)return Object.fromEntries(catalog.species.map(s=>[s.name,{available:false,reason:'Sign in to check maps'}]));
  return routePlan({names:catalog.species.map(s=>s.name)},player,catalog,day).availability;
}
export function routePlan(config,player,catalog,day=new Date().getUTCDay()) {
  const stops=new Map(),unavailable=[],availability={};
  for(const name of config.names){
    const species=catalog.species.find(s=>s.name===name),options=speciesStops(species,catalog),reasons=[],locations=new Set();
    for(const stop of options){
      const limited=player._huntLimitedObjects?.[`${stop.location}:${stop.area_id}:${stop.object_id}`];
      if(limited){reasons.push({available:false,reason:'Daily limit reached',detail:limited});continue;}
      const official=species.locations,areas=official?.[mapLabels[stop.location]],area=String(stop.area_id);
      // A live feed can remove a previously mapped spawn. Never keep routing to it.
      if(official&&(!areas||!Object.hasOwn(areas,area))){reasons.push({available:false,reason:'Spawn mapping changed',detail:'This mapped area is absent from the current official spawn data.'});continue;}
      const blocked=mapAccessStatus(player,stop,catalog);
      if(blocked){reasons.push(blocked);continue;}
      const days=areas?.[area]||stop.days;
      if(days?.length&&!days.includes(day)){reasons.push({available:false,reason:'Not today',detail:'This species is not available here today (UTC schedule).'});continue;}
      const key=`${stop.location}:${stop.area_id}:${stop.object_id}`;
      if(!stops.has(key))stops.set(key,{...stop,key,targets:[]});
      stops.get(key).targets.push(species.id);locations.add(stop.location);
    }
    if(locations.size)availability[name]={available:true,reason:'Available',locations:[...locations]};
    else{
      unavailable.push(name);
      // Prefer a real usable map on another day over a locked alternate location.
      availability[name]=reasons.find(r=>r.reason==='Not today')||reasons[0]||{available:false,reason:'No wild location',detail:'No mapped wild search object is available for this family.'};
    }
  }
  return {stops:[...stops.values()],unavailable,availability};
}
export function atSearchLocation(area,stop,protocol) {
  const expected=protocol.locations[stop.location];
  const current=area?.location;
  const sameMap=current?.id!==undefined ? Number(current.id)===expected : String(current?.name||'').toLowerCase().replace(/[\s-]+/g,'_')===stop.location;
  return sameMap && Number(area?.area_id)===stop.area_id;
}
export function abilities(member, side, metadata, protocol, campaign = false) {
  const meta = metadata.get(member.mId) || member;
  const all = meta.abilities || [];
  const order = meta.ability_order || all.map(a=>a.id);
  const byId = new Map(all.map(a=>[a.id,a]));
  const count = member.mId === -1 ? all.length : protocol.level_keys.filter(level=>level<=member.level).length;
  const cds = side.cooldowns?.[String(member.id)] || {};
  const uses = side.uses?.[String(member.id)] || {};
  return order.slice(0,count).map(id=>byId.get(id)).filter(Boolean).map(a=>({...a,recharge:cds[a.id]||0,remaining:uses[a.id]??(a.max_uses||undefined),nativeCooldown:a.cooldown > 0 ? a.cooldown+1 : a.cooldown === -1 ? -1 : campaign ? 2 : 0}));
}
export function targetMatches(config, foe, catalog, families, upgrades) {
  const selected = catalog.species.some(s=>s.id===foe.mId && config.names.includes(s.name));
  const allowLow=config.captureLowRatedTargets && config.mode.startsWith('capture_') && Number.isFinite(foe.rating) && foe.rating>=0;
  if (upgrades?.has(foe.mId)) return Number.isFinite(foe.rating) && (foe.rating>=TRAINING_MIN_RATING || allowLow);
  if (allowLow && selected && config.mode!=='capture_missing') return true;
  if (config.mode === 'capture_any') return true;
  if (config.mode === 'capture_missing') return families instanceof Set && Number.isInteger(foe.mId) && foe.mId>0 && !families.has(foe.mId);
  if (config.mode === 'capture_rated') return Number(foe.rating) >= config.minRating;
  return selected && Number(foe.rating ?? 0) >= config.minRating;
}
export function decision(battle, config, catalog, context={}) {
  const player=battle.player.miscrits[0], foe=battle.foe.miscrits[0];
  if (battle.winner || player.chp<=0 || foe.chp<=0) return null;
  if (foe.captured) return null;
  if (battle.type==='Wild' && config.mode==='capture_missing' && !(context.families instanceof Set)) return {action:'stop',reason:'Collection is not loaded. Reconnect before capturing missing species.'};
  const target = targetMatches(config,foe,catalog,context.families,context.upgrades);
  if (battle.type === 'Wild' && config.mode === 'manual_target' && target) return {action:'manual'};
  if (battle.nextTurn !== battle.player.user_id || battle.pending || player.handicap) return null;
  const fight = battle.type !== 'Wild' || config.mode === 'fight' || (!target && (!config.fleeUnwanted || (config.mode==='capture_missing' && context.trainOwned)));
  if (!fight && !target) return {action:'flee'};
  const available = player.abilities.filter(a=>a.recharge===0 && a.remaining!==0);
  if (fight) {
    const attacks=available.filter(a=>a.type==='Attack' && (a.target||'Foe')==='Foe').sort((a,b)=>(b.ap||0)-(a.ap||0));
    if (!attacks.length) return {action:'stop',reason:'No usable attack. Take over in the Battle tab.'};
    return {action:'ability',id:attacks[0].id};
  }
  if (foe.attempts>0) return {action:'flee'}; // Never send a paid capture retry.
  if (!Number.isFinite(battle.captureChance)) return {action:'stop',reason:'Missing server capture chance.'};
  if (battle.captureChance>=config.captureThreshold) return {action:'capture'};
  if (player.chp<=player.hp*0.25 || foe.chp<=foe.hp*0.25 || battle.attacks>=config.maxAttacks || battle.damageRisk) return {action:'flee'};
  const simple=available.filter(a=>a.type==='Attack' && (a.target||'Foe')==='Foe' && (a.times||1)===1 && !a.additional?.length && !a.complexEnchant && a.ap>0).sort((a,b)=>a.ap-b.ap || a.id-b.id);
  const prefix=`${player.id}:${foe.id}:`;
  const hasMeasurements=Object.entries(battle.damage).some(([key,value])=>key.startsWith(prefix)&&value>0);
  const choice=simple.find(a=>{
    let observed=battle.damage[`${prefix}${a.id}`];
    if(!observed){
      for(const source of player.abilities){
        if((source.element||'Physical')!==(a.element||'Physical') || Boolean(source.true_dmg)!==Boolean(a.true_dmg) || !(source.ap>0))continue;
        const measured=battle.damage[`${prefix}${source.id}`];
        if(measured>0)observed=Math.max(observed||0,Math.ceil(measured*Math.max(1,a.ap/source.ap)*1.25));
      }
    }
    if(hasMeasurements && !observed)return false;
    return !observed || foe.chp-Math.ceil(observed*2)-2>foe.hp*0.25;
  });
  return choice ? {action:'ability',id:choice.id} : {action:'flee'};
}
