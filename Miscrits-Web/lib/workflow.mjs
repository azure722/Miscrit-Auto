import {owned,routePlan,selectedTrainingPlan} from './model.mjs';
export class SessionStats {
  constructor(){this.reset();}
  reset(){this.startedAt=new Date().toISOString();this.searches=0;this.drops=0;this.cooldowns=0;this.encounters=0;this.captureAttempts=0;this.captures=0;this.duplicates=0;this.qualifiedCaptures=0;this.battlesWon=0;this.fled=0;this.levels=0;this.xpAwarded=0;this.heals=0;this.virtueSpent=0;}
  snapshot(){return {...this,elapsedSeconds:Math.max(0,Math.floor((Date.now()-Date.parse(this.startedAt))/1000))};}
}
export function huntNames(config,plan){return [...new Set([...(config.names.length?config.names:[]),...(plan?.needsCapture||[]),...(!config.names.length&&plan?config.replacementNames:[])])];}
export function nextSearchStop({config,stops,cursor=0,catalog,cooldowns,now=Date.now()}){
  const ordered=stops.map((_,i)=>({stop:stops[(cursor+i)%stops.length],offset:i}));
  const primary=catalog.species.find(s=>s.name===config.primaryTarget)?.id;
  if(primary)ordered.sort((a,b)=>Number(b.stop.targets.includes(primary))-Number(a.stop.targets.includes(primary)));
  const candidate=ordered.find(item=>now>=(cooldowns.get(item.stop.key)||0));
  return {stop:candidate?.stop||null,nextCursor:candidate?(cursor+candidate.offset+1)%stops.length:cursor};
}
export function stopAdvice(message,{uncertain=false,rpcId='',battle=false}={}){
  if(uncertain)return {category:'Uncertain action',action:'Check Live battle and your team. Sign out and sign in again to reload server state before restarting. Do not repeat the previous action.'};
  if(/arena/i.test(message)||/^get_(battle|platinum|random)_arena$/.test(rpcId))return {category:'Arena',action:'Check Arena for queue or draft status and team requirements. Finish an assigned battle or draft before changing modes. After a search timeout or game restriction, inspect account state before Start.'};
  if(/budget/i.test(message))return {category:'Healing budget',action:'Open Workflow and increase the wild virtue budget, or heal manually. Save settings before Start.'};
  if(/virtue/i.test(message))return {category:'Insufficient virtue',action:'Check the virtue balance and heal your team in the game when available. Resume only after the team is ready.'};
  if(/session expired|sign in|signed out|login/i.test(message))return {category:'Account session',action:'Sign in again using Connect account. Check any restored battle before Start.'};
  if(/disconnect|connection|reconnect|socket/i.test(message))return {category:'Connection',action:'Check internet access. Wait for reconnection, then inspect the restored battle and press Start when ready.'};
  if(rpcId==='create_battle'&&/daily.*limit/i.test(message))return {category:'Server search limit',action:'Automation is paused. The server did not specify whether this limit applies to the object, species or account. Other targets may also be limited. Wait until the game permits searching; changing targets or slowing searches cannot remove an existing quota.'};
  if(/daily|attempts.*used|victory limit|all campaign stages|all hunt targets/i.test(message))return {category:'Run complete or limit reached',action:'Review your queue or campaign progress. Choose new targets or adjust your limit; daily attempt limits must wait for the game reset.'};
  if(/^automation paused/i.test(message))return {category:'Paused by user',action:battle?'Manual battle controls remain available. Press Start to resume when ready.':'Press Start when ready to continue with the saved settings.'};
  if(/saving target removal failed/i.test(message))return {category:'Settings could not be saved',action:'The capture was kept. Check available disk space, remove the captured target from Hunt and save settings before restarting.'};
  if(/campaign.*defeat|incomplete battle/i.test(message))return {category:'Campaign battle stopped',action:'Check your team HP and the latest campaign progress. Finish any active battle manually and prepare your team before Start.'};
  if(/manual|selected miscrit found|existing battle|no usable attack/i.test(message))return {category:'Manual battle needed',action:'Open Live battle and finish the encounter manually. Automation can resume afterward.'};
  if(rpcId==='update_location'||/no available search locations|location|map unlock|tickets|area locked|moving to/i.test(message))return {category:'Search location',action:'Review Workflow for unavailable routes. Check the selected map, daily schedule, unlocks and tickets; choose an accessible target.'};
  if(/index|collection/i.test(message))return {category:'Collection index',action:'Use Reload account data in Collection or reconnect. Selected training needs a readable Miscrits index before continuing.'};
  if(/team|fainted|heal|replacement|training|level-up/i.test(message))return {category:'Team or training',action:'Check Your team, HP, earned XP and the selected training list. Review the failed request in Activity log before restarting.'};
  if(/paused|pause automation/i.test(message))return {category:'Paused by user',action:battle?'Manual battle controls remain available. Press Start to resume when ready.':'Press Start when ready to continue with the saved settings.'};
  return {category:rpcId?'Game request failed':'Automation stopped',action:'Read the reason and request details below and in Activity log. Check current game state before trying Start; unresolved server errors may require reconnecting.'};
}
export function targetQueue({config,player,catalog,metadata,index,cooldowns,cursor=0,currentSearch,battle,now=Date.now()}){
  if(!player)return {current:null,next:null,targets:[],message:'Sign in to load the target queue.'};
  if(config.activity!=='wild')return {current:battle?{label:config.activity==='arena'?'Arena battle':'Campaign battle'}:null,next:null,targets:[],message:config.activity==='arena'?'Arena is selected. Open Arena for matchmaking and draft status.':'Campaign is selected. Wild targets resume when Hunt is selected.'};
  const plan=config.trainSelected?selectedTrainingPlan(player,config.replacementNames,catalog,metadata,index):null;
  const names=huntNames(config,plan),route=routePlan({...config,names},player,catalog);
  const {stop:next}=nextSearchStop({config,stops:route.stops,cursor,catalog,cooldowns,now});
  const label=stop=>stop?{location:stop.location,area:stop.area_id,object:stop.object_id,targets:stop.targets.map(id=>catalog.species.find(s=>s.id===id)?.name).filter(Boolean)}:null;
  const namesWithCompleted=[...new Set([...names,...(plan?.complete||[])])];
  const targets=namesWithCompleted.map(name=>{
    const family=catalog.species.find(s=>s.name===name),stops=route.stops.filter(stop=>stop.targets.includes(family?.id));
    const remaining=stops.length?Math.max(0,Math.min(...stops.map(stop=>(cooldowns.get(stop.key)||0)-now))):0;
    const members=player.miscrits.map(m=>owned(m,metadata)).filter(m=>m.mId===family?.id).sort((a,b)=>b.rating-a.rating||b.level-a.level);
    let status='ready',reason=plan?.needsCapture.includes(name)?'Seeking a rating-17+ copy.':'Search target selected.';
    if(plan?.complete.includes(name)&&!config.names.includes(name)){status='complete';reason='Family completed at level 30; duplicate training skipped.';}
    else if(!stops.length){status='unavailable';reason=route.availability[name]?.detail||route.availability[name]?.reason||'No available mapped object today; check schedule, map unlocks and tickets.';}
    else if(remaining>0){status='cooldown';reason='Waiting for a search object cooldown.';}
    if(plan?.traineeIds.some(id=>members.some(m=>m.id===id)))reason+=' Selected copy is training to level 30.';
    return {name,rarity:family?.rarity,primary:config.primaryTarget===name,status,reason,waitSeconds:Math.ceil(remaining/1000),bestRating:members[0]?.rating??null};
  });
  return {current:battle?{...label(currentSearch),label:battle.type==='Campaign'?'Campaign battle':battle.foe?.miscrits?.[0]?.name||'Joining encounter'}:currentSearch?{...label(currentSearch),label:'Last searched object'}:null,next:label(next),targets,message:!route.stops.length?'No available wild search objects.':!next?'Waiting for object cooldowns.':'Next available mapped object shown below.'};
}
