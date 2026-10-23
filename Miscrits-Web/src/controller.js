import {teamStore} from './team-store.js';
// Compatibility controller: preserves existing game policies and API behavior.
// React owns the component tree; this module updates dedicated controls and result containers.
export function initializeWorkspace(){
// Native Constants.ratings[18 - PlayerMiscrit.get_rating_sum()].
const RATING_GRADES=['F-','F','F+','D','D+','C','C+','B','B+','A','A+','S','S+'].map((grade,index)=>({grade,value:index+6}));
function ratingLabel(value){return value===0?'Any grade':RATING_GRADES.find(item=>item.value===Number(value))?.grade||String(value)+'/18';}

// Preserve the old unrestricted mode as the unified any-species choice + Any grade.
function captureModeSelection(config){
  return config.mode==='capture_any'?{mode:'capture_rated',minRating:0}:{mode:config.mode,minRating:config.minRating};
}
const $=id=>document.getElementById(id);
let csrf='',catalog=[],state=null,tab='hunt',draft=null,dirty=false,posting=false,polling=false,lastBattleId='',toastTimer;
const copy=value=>structuredClone(value);
let collectionPage=1,collectionRenderKey='';
let huntPage=1,huntRarity='all',huntBrowserKey='',huntTargetsKey='';
let browserAlertsEnabled=false;
const titles={"hunt":["Hunt & capture","Hunt & capture","Choose targets and set your capture rules."],"campaign":["Campaign","Campaign","Automate unlocked stages with your current team."],"arena":["Arena","Arena","Configure matchmaking, battle strategy and stop conditions."],"team":["Your team","Your team","Manage your active team and automatic training."],"battle":["Live battle","Live battle","Monitor encounters or take control manually."],"workflow":["Workflow","Workflow","Monitor the queue, healing, profiles and session statistics."],"collection":["Collection","Collection","Browse your collection and track training progress."],"history":["Activity log","Activity log","Review captures, battles and recent automation events."]};
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6000);}
let bootstrapRequest=null;
async function bootstrapBrowser(){
  if(bootstrapRequest)return bootstrapRequest;
  bootstrapRequest=(async()=>{
    const response=await fetch('/api/bootstrap',{credentials:'same-origin',cache:'no-store'}),boot=await response.json();
    if(!response.ok){
      const conflict=boot.code==='BROWSER_OWNER_CONFLICT'||boot.error==='This backend is already open in another browser session. Use that window or restart the website backend.';
      throw new Error(conflict?'This website is connected to another browser or browser profile. Use the original window. To switch browsers, finish any battle, then run Stop Miscrits Website.cmd and Launch Miscrits Website.cmd.':boot.error||'Unable to connect this browser. Refresh the page and use the original browser window.');
    }
    if(typeof boot.csrf!=='string'||!boot.csrf||!Array.isArray(boot.catalog))throw new Error('The local website returned an incomplete browser session. Refresh this page.');
    csrf=boot.csrf;if(!catalog.length){catalog=boot.catalog;fillCatalog();}return boot;
  })();
  try{return await bootstrapRequest;}finally{bootstrapRequest=null;}
}
async function api(endpoint,value){
  if(!csrf)await bootstrapBrowser();
  for(let attempt=0;attempt<2;attempt++){
    const sentCsrf=csrf;
    const res=await fetch('/api/'+endpoint,{method:value===undefined?'GET':'POST',credentials:'same-origin',headers:{'X-Miscrits-CSRF':sentCsrf,...(value===undefined?{}:{'Content-Type':'application/json'})},...(value===undefined?{}:{body:JSON.stringify(value)})});
    const data=await res.json();
    // These 403s are produced before the backend executes any action. Network/game errors are never replayed.
    const stale=res.status===403&&(data.code==='BROWSER_SESSION_STALE'||data.error==='Reopen the website to connect this browser session.');
    if(stale&&attempt===0){if(csrf===sentCsrf)await bootstrapBrowser();continue;}
    if(!res.ok)throw new Error(data.error||'Request failed.');return data;
  }
}
async function post(endpoint,value={}){if(posting)return;posting=true;try{await api(endpoint,value);await poll();}catch(error){toast(error.message);}finally{posting=false;}}
function element(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function image(name,className='avatar'){
  const img=element('img',className);img.alt='';img.loading='lazy';
  img.src='https://cdn.worldofmiscrits.com/avatars/'+String(name).toLowerCase().replaceAll(' ','_')+'_avatar.png';
  img.addEventListener('error',()=>{img.src='/mark.svg';},{once:true});return img;
}
function setTab(next){tab=next;document.querySelectorAll('.nav').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});document.querySelectorAll('.tab-panel').forEach(p=>p.hidden=p.id!=='tab-'+tab);const [label,title,description]=titles[tab];$('page-label').textContent=label;$('page-title').textContent=title;$('page-description').textContent=description;if(next==='arena')renderArena();if(next==='collection')renderCollection();if(next==='workflow')renderWorkflow();}
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>setTab(button.dataset.tab)));
function canonical(value){return catalog.find(s=>s.name.toLowerCase()===value.trim().toLowerCase());}
function addName(input,key){if(!draft)return;const entry=canonical(input.value);if(!entry){toast('Choose a Miscrit family from the list.');return;}if(key==='names'){const access=huntAccess(entry);if(!access.available){toast(access.reason);return;}if(!draft.names.includes(entry.name)&&draft.names.length>=100){toast('The hunt list supports 100 targets.');return;}}if(!draft[key].includes(entry.name))draft[key].push(entry.name);dirty=true;input.value='';renderLists();}
$('target-input').addEventListener('input',()=>{huntPage=1;renderHuntBrowser();});
$('hunt-available').addEventListener('change',()=>{huntPage=1;renderHuntBrowser();});
$('hunt-prev').addEventListener('click',()=>{huntPage--;renderHuntBrowser();});
$('hunt-next').addEventListener('click',()=>{huntPage++;renderHuntBrowser();});
$('hunt-add-visible').addEventListener('click',()=>{if(!draft)return;const entries=filteredHuntEntries().filter(entry=>huntAccess(entry).available&&!draft.names.includes(entry.name));if(!addMappedHuntNames(entries))return;dirty=true;renderLists();toast(entries.length+' targets added. Save hunt settings to apply.');});
$('target-form').addEventListener('submit',event=>{event.preventDefault();addName($('target-input'),'names');});
$('clear-all-targets').addEventListener('click',()=>{
  if(!draft||!draft.names.length)return;
  draft.names=[];draft.primaryTarget='';dirty=true;renderLists();toast('All hunt targets cleared. Save hunt settings to apply. Tier training selections are unchanged.');
});
function removeName(key,name){draft[key]=draft[key].filter(n=>n!==name);if(key==='names'&&draft.primaryTarget===name)draft.primaryTarget='';dirty=true;renderLists();}
function moveTarget(name,delta){
  const from=draft.names.indexOf(name),to=from+delta;
  if(from<0||to<0||to>=draft.names.length)return;
  [draft.names[from],draft.names[to]]=[draft.names[to],draft.names[from]];dirty=true;renderLists();
  document.querySelector('[data-target-order="'+to+'"] button:not(:disabled)')?.focus();
}
function togglePrimary(name){draft.primaryTarget=draft.primaryTarget===name?'':name;dirty=true;renderLists();}
function filteredHuntEntries(){
  const query=$('target-input').value.trim().toLowerCase();
  return catalog.filter(entry=>(huntRarity==='all'||entry.rarity===huntRarity)&&
    (!query||[entry.name,...(entry.names||[])].some(name=>name.toLowerCase().includes(query)))&&
    (!$('hunt-available').checked||huntAccess(entry).available));
}
function renderHuntBrowser(){
  const filtered=filteredHuntEntries(),pages=Math.max(1,Math.ceil(filtered.length/24));huntPage=Math.max(1,Math.min(huntPage,pages));
  const key=JSON.stringify([huntPage,huntRarity,$('target-input').value,$('hunt-available').checked,draft?.names,state?.connected,state?.reconnecting,state?.requiresLogin,state?.huntAccessVersion,state?.huntAvailability]);
  if(key===huntBrowserKey)return;huntBrowserKey=key;
  const focusedRarity=document.activeElement?.closest('#hunt-rarities')?document.activeElement.textContent:null;
  const rarities=$('hunt-rarities');rarities.replaceChildren();
  for(const rarity of ['all','Common','Rare','Epic','Exotic','Legendary']){
    const button=element('button','hunt-rarity'+(huntRarity===rarity?' is-active':''),rarity==='all'?'All':rarity);button.type='button';button.setAttribute('aria-pressed',String(huntRarity===rarity));
    button.addEventListener('click',()=>{huntRarity=rarity;huntPage=1;renderHuntBrowser();});rarities.append(button);if(focusedRarity===button.textContent)button.focus();
  }
  const ready=Boolean(state?.connected&&!state.reconnecting&&!state.requiresLogin);
  $('hunt-access').textContent=ready?(state.huntAccessVersion===2&&state.huntAvailability?'Map and area boss gates checked for your account · locked portraits cannot be added.':'The website backend needs an update restart. Finish any battle, run Stop Miscrits Website.cmd, then Launch Miscrits Website.cmd and sign in again.'):state?.reconnecting?'Reconnecting... waiting to check your maps.':'Sign in to check your maps and add targets.';
  const grid=$('hunt-grid');grid.replaceChildren();
  for(const entry of filtered.slice((huntPage-1)*24,huntPage*24)){
    const access=huntAccess(entry),selected=draft?.names.includes(entry.name);
    const button=element('button','hunt-tile'+(selected?' is-selected':'')+(!access.available?' is-locked':''));button.type='button';button.disabled=!access.available||selected||!draft;button.title=entry.name+' · '+entry.rarity+' · '+access.reason+' · '+[...new Set(entry.stops.map(s=>s.location.replaceAll('_',' ')))].join(', ');
    button.title+=' '+(access.detail||'');
    button.setAttribute('aria-label',entry.name+' · '+entry.rarity+' · '+(selected?'Selected · ':'')+(access.detail||access.reason));
    button.append(image(entry.name),element('strong','',entry.name),element('small',access.available?'':'hunt-locked-label',!access.available?access.reason:selected?'✓ Added':'+ Add'));
    button.addEventListener('click',()=>{if(!huntAccess(entry).available)return;if(!addMappedHuntNames([entry]))return;dirty=true;renderLists();});grid.append(button);
  }
  if(!filtered.length)grid.append(element('p','hint','No Miscrits match these filters. Try another rarity or search.'));
  $('hunt-page').textContent=filtered.length+' Miscrits · '+huntPage+' / '+pages;
  $('hunt-prev').disabled=huntPage<=1;$('hunt-next').disabled=huntPage>=pages;
  const count=filtered.filter(entry=>huntAccess(entry).available&&!draft?.names.includes(entry.name)).length;
  $('hunt-add-visible').disabled=!draft||!count;$('hunt-add-visible').textContent='Add available ('+count+')';
}
function renderLists(){
  const names=draft.names;const targetsKey=JSON.stringify([names,draft.primaryTarget,names.map(name=>huntAccess(canonical(name)))]);if(targetsKey!==huntTargetsKey){huntTargetsKey=targetsKey;$('target-count').textContent=names.length+' target'+(names.length===1?'':'s');$('clear-all-targets').disabled=names.length===0;$('target-empty').hidden=names.length>0;$('target-list').replaceChildren();$('hunt-route-list').replaceChildren();
  for(const [index,name]of names.entries()){
    const entry=canonical(name),primary=draft.primaryTarget===name,access=huntAccess(entry);
    const row=element('div','target-item'+(primary?' is-primary':''));row.title=access.detail||access.reason;row.append(image(name));
    const text=element('div','target-info');text.append(element('strong','',name),element('small',access.available?'':'hunt-locked-label',access.available?(primary?'★ Main':entry?.rarity||'Target'):access.reason));row.append(text);
    const controls=element('div','target-controls');
    for(const [label,delta]of [['↑',-1],['↓',1]]){const button=element('button','button small subtle',label);button.type='button';button.disabled=index+delta<0||index+delta>=names.length;button.setAttribute('aria-label','Move '+name+(delta<0?' up':' down'));button.addEventListener('click',()=>moveTarget(name,delta));controls.append(button);}
    const main=element('button','button small subtle',primary?'★':'☆');main.type='button';main.title='Search '+name+' first';main.setAttribute('aria-label','Prioritize '+name);main.setAttribute('aria-pressed',String(primary));main.disabled=!access.available;main.addEventListener('click',()=>togglePrimary(name));controls.append(main);
    const remove=element('button','remove','×');remove.type='button';remove.setAttribute('aria-label','Remove '+name);remove.addEventListener('click',()=>removeName('names',name));row.append(remove);$('target-list').append(row);
    const route=element('div','hunt-route-row');route.dataset.targetOrder=String(index);route.append(element('span','',(index+1)+'. '+name),controls);$('hunt-route-list').append(route);
  }
  }
  renderHuntBrowser();
}
function loadDraft(config){draft=copy(config);const selection=captureModeSelection(draft);loadArenaDraft();$('mode').value=selection.mode;$('rating').value=selection.minRating;$('search-interval').value=draft.searchIntervalSeconds??8;$('threshold').value=draft.captureThreshold;$('capture-low-rating').checked=draft.captureLowRatedTargets;$('remove-captured-targets').checked=draft.autoRemoveCapturedTargets;$('max-attacks').value=draft.maxAttacks;$('flee').checked=draft.fleeUnwanted;$('campaign-limit').value=draft.campaignLimit;$('wild-heal').checked=draft.wildAutoHeal;$('wild-heal-budget').value=draft.wildHealBudget;$('notify-events').checked=draft.notifyEvents;renderLists();modeHelp();}
let ratingRenderKey='';
function renderRatingGrades(disabled){
  const value=Number($('rating').value),key=value+':'+disabled;if(key===ratingRenderKey)return;ratingRenderKey=key;
  const focused=document.activeElement?.closest('#rating-grades')?document.activeElement?.dataset.value:null;
  const group=$('rating-grades');group.replaceChildren();
  for(const item of [{grade:'Any',value:0},...RATING_GRADES]){
    const button=element('button','grade-badge'+(value===item.value?' is-active':''),item.grade);button.type='button';button.dataset.value=String(item.value);button.dataset.grade=item.value===0?'':item.grade[0];button.disabled=disabled;
    button.setAttribute('aria-pressed',String(value===item.value));button.setAttribute('aria-label',item.value===0?'Any grade':item.grade+' or higher, '+item.value+' out of 18');button.title=item.value===0?'No minimum grade':item.grade+' = '+item.value+'/18';
    button.addEventListener('click',()=>{$('rating').value=item.value;$('rating').dispatchEvent(new Event('input',{bubbles:true}));});group.append(button);if(focused===button.dataset.value)button.focus();
  }
}
function modeHelp(){
  const mode=$('mode').value,automatic=mode.startsWith('capture_'),override=$('capture-low-rating').checked;
  const ignored=['fight','capture_missing'].includes(mode)||(mode==='capture_targeted'&&override);
  const help={manual_target:'Pause on a matching target so you can battle manually.',capture_targeted:'Catch only species in your selected targets. Choose the minimum grade below.',capture_missing:'Catch families missing from your collection. Evolved copies count as the same family.',capture_rated:'Catch any encountered species. Choose the minimum grade below, or Any for no grade restriction.',fight:'Fight encounters for XP without capturing.'};
  $('mode-help').textContent=help[mode];renderRatingGrades(ignored);
  $('rating-help').textContent=ignored?(override&&mode==='capture_targeted'?'Any grade is allowed because the advanced minimum-grade override is on.':'This mode does not use a minimum grade.'):'Choose the lowest grade to accept. '+ratingLabel(Number($('rating').value))+' ('+$('rating').value+'/18) is selected.';
  $('threshold').disabled=!automatic;
  const grade=ratingLabel(Number($('rating').value));
  $('capture-plan').textContent=!automatic?(mode==='fight'?'Fight only. No capture attempts.':'Pause on matching targets. You control the battle and capture.'):'Free capture at '+$('threshold').value+'% or higher. '+(ignored?'No minimum grade for this mode.':grade==='Any grade'?'Any grade accepted.':'Accept '+grade+' or higher.')+(override&&['capture_rated','capture_missing'].includes(mode)?' Selected targets may bypass this minimum.':'');
}
['mode','rating','search-interval','threshold','max-attacks','flee','campaign-limit','capture-low-rating','remove-captured-targets','wild-heal','wild-heal-budget','notify-events'].forEach(id=>$(id).addEventListener('input',()=>{if(!draft)return;dirty=true;modeHelp();}));
function formConfig(){return {...draft,activity:selectedActivity(),arenaType:$('arena-type').value,arenaStrategy:$('arena-strategy').value,arenaBattleLimit:Number($('arena-limit').value),arenaStopOnLoss:$('arena-stop-loss').checked,arenaAllowInjured:$('arena-injured').checked,mode:$('mode').value,minRating:Number($('rating').value),searchIntervalSeconds:Number($('search-interval').value),captureThreshold:Number($('threshold').value),captureLowRatedTargets:$('capture-low-rating').checked,autoRemoveCapturedTargets:$('remove-captured-targets').checked,maxAttacks:Number($('max-attacks').value),fleeUnwanted:$('flee').checked,campaignLimit:Number($('campaign-limit').value),autoLevel:state.config.autoLevel,platinumUpgradeIds:state.config.platinumUpgradeIds||[],trainSelected:false,autoReplace:false,wildAutoHeal:$('wild-heal').checked,wildHealBudget:Number($('wild-heal-budget').value),notifyEvents:$('notify-events').checked};}
function selectedActivity(){return tab==='arena'?'arena':tab==='campaign'?'campaign':tab==='hunt'?'wild':draft.activity;}
function loadArenaDraft(){
  $('arena-type').value=draft.arenaType||'Default';$('arena-strategy').value=draft.arenaStrategy||'smart';$('arena-limit').value=draft.arenaBattleLimit??10;$('arena-stop-loss').checked=draft.arenaStopOnLoss??true;$('arena-injured').checked=draft.arenaAllowInjured??false;arenaRules();
}
function arenaRules(){
  $('arena-rules').textContent=({Default:'Four different species, full team. Uses current HP; heal before joining if all teammates have fainted.',Platinum:'Four different species, all level 35, total rarity points at most 12. Common 1 / Rare 2 / Epic 3 / Exotic 4 / Legendary 5. These are rarity points, separate from the 0–18 copy rating.',Random:'The server provides a species pool. Automatically ban 6, then pick 4, then fight using the drafted team. Your collection team is unchanged.'})[$('arena-type').value];
}
for(const id of ['arena-type','arena-limit','arena-stop-loss','arena-injured','arena-strategy'])$(id).addEventListener('input',()=>{dirty=true;arenaRules();renderArena();});
let draftSelection={key:'',ids:[]};
let arenaStatsLoading=false;
const arenaStatsAttempts=new Map();
async function loadArenaTotals(force=false){
  if(arenaStatsLoading||posting||!state?.connected||state.running||state.busy||state.battle||state.draft||state.reconnecting)return;
  const type=$('arena-type').value||state.config?.arenaType||'Default';
  if(!force&&(state.arena?.records?.[type]||Date.now()-(arenaStatsAttempts.get(type)||0)<60000))return;
  arenaStatsLoading=true;arenaStatsAttempts.set(type,Date.now());$('arena-refresh-totals').disabled=true;
  try{await api('arena/stats',{type});await poll();}catch(error){$('arena-record-source').textContent=error.message;if(force)toast(error.message);}finally{arenaStatsLoading=false;$('arena-refresh-totals').disabled=Boolean(!state?.connected||state.running||state.busy||state.battle||state.draft||state.reconnecting);}
}
function renderArenaTotals(){
  if(!state?.connected)arenaStatsAttempts.clear();
  const type=$('arena-type').value||state?.config?.arenaType||'Default',record=state?.arena?.records?.[type];
  $('arena-record-title').textContent=({Default:'Battle Arena',Platinum:'Platinum Arena',Random:'Random Arena'})[type]+' · account wins';
  const rows=[['Total wins',record?.totalWins],['Total losses',record?.totalLosses]];
  if(type==='Platinum')rows.push(['Current streak',record?.streak],['Best streak',record?.bestStreak]);
  else rows.push([type==='Random'?'Monthly wins':'Weekly wins',record?.periodWins]);
  const items=$('arena-account-totals');items.replaceChildren();for(const [label,value]of rows){const item=element('div');item.append(element('small','',label),element('strong','',Number.isSafeInteger(value)?value.toLocaleString():'—'));items.append(item);}
  $('arena-record-source').textContent=!state?.connected?'Sign in to load arena totals.':!record?'Open Arena while idle to load totals, or press Refresh totals.':record.error||'From the game server · updated '+new Date(record.updatedAt).toLocaleTimeString()+(type==='Platinum'&&record.totalWins===null?' · Lifetime wins were not supplied by this response.':'');
  $('arena-refresh-totals').disabled=Boolean(arenaStatsLoading||!state?.connected||state.running||state.busy||state.battle||state.draft||state.reconnecting);
  if(typeof tab==='string'&&tab==='arena'&&!record&&!arenaStatsLoading)void loadArenaTotals();
}
function renderArena(){
  renderArenaTotals();
  const arena=state?.arena,queue=arena?.queue,run=arena?.run||{},d=state?.draft;
  $('arena-status').textContent=d?'Draft: '+d.stage:state?.battle&&['Default','Platinum','Random'].includes(state.battle.type)?'In battle':queue?.searching?'Searching':state?.running&&state?.config?.activity==='arena'?'Running':'Paused';
  $('arena-queue').textContent=queue?queue.status+(queue.searching?' · '+queue.elapsedSeconds+'s / 120s':''):state?.connected?'Save arena settings, then press Start on this tab.':'Sign in to start arena matchmaking.';
  const counters=$('arena-counters');counters.replaceChildren();for(const [label,value]of [['Run battles',run.battles||0],['Run wins',run.wins||0],['Run losses',run.losses||0],['Run win rate',run.battles?Math.round((run.wins||0)/run.battles*100)+'%':'-']]){const item=element('div');item.append(element('small','',label),element('strong','',value));counters.append(item);}
  $('arena-open-battle').disabled=!state?.battle;
  $('arena-decision').textContent=state?.battle?.strategyReason||'Smart compares legal options using matchup, accuracy, damage observations, HP and active effects. Basic uses highest AP. Improvement in live win rate has not been measured.';
  $('arena-draft').hidden=!d;if(!d)return;
  const key=d.id+':'+d.stage;if(draftSelection.key!==key)draftSelection={key,ids:[]};
  const count=d.stage==='ban'?6:4,selecting=['ban','pick'].includes(d.stage);
  const blocked=state.running||state.busy||state.reconnecting||!state.connected||d.awaiting||!selecting;
  $('draft-title').textContent=d.stage==='ban'?'Ban 6 species':d.stage==='pick'?'Pick 4 species':d.stage==='preparing'?'Preparing battle':'Loading draft';
  $('draft-time').textContent=d.deadline?Math.max(0,Math.ceil((d.deadline-Date.now())/1000))+'s':'Waiting';
  $('draft-help').textContent=state.running?'Auto draft is active.':d.awaiting?'Selection sent. Waiting for the opponent/server.':'Select '+count+' species below. The server timer continues while paused.';
  const pool=$('draft-pool');pool.replaceChildren();
  for(const id of d.pool){const family=catalog.find(s=>s.id===id),banned=d.banned.includes(id),label=element('label','draft-species'+(banned?' is-banned':''));
    const input=element('input');input.type='checkbox';input.checked=draftSelection.ids.includes(id);input.disabled=blocked||banned;
    input.addEventListener('change',()=>{if(input.checked){if(draftSelection.ids.length>=count){input.checked=false;toast('Select exactly '+count+' species.');return;}draftSelection.ids.push(id);}else draftSelection.ids=draftSelection.ids.filter(value=>value!==id);renderArena();});
    label.append(input,element('span','',(family?.name||'Miscrit '+id)+(banned?' · banned':'')));pool.append(label);
  }
  $('draft-submit').textContent='Submit '+draftSelection.ids.length+' / '+count+' '+(d.stage==='ban'?'bans':'picks');$('draft-submit').disabled=blocked||draftSelection.ids.length!==count;
}
$('arena-open-battle').addEventListener('click',()=>setTab('battle'));
$('arena-refresh-totals').addEventListener('click',()=>loadArenaTotals(true));
$('draft-submit').addEventListener('click',()=>post('arena/draft',{kind:state?.draft?.stage,ids:draftSelection.ids}));
async function save(){if(!draft)return;const next=formConfig();try{await api('settings',next);dirty=false;await poll();toast('Settings saved.');}catch(error){toast(error.message);}}
document.querySelectorAll('.save').forEach(button=>button.addEventListener('click',save));
const trainingTiers=['Exotic','Rare','Common','Epic','Legendary'];
function buildCollectionRows(entries,roster,index){
  const groups=new Map();
  for(const member of roster||[]){
    if(!Number.isInteger(member.mId)||member.mId<=0)continue;
    if(!groups.has(member.mId))groups.set(member.mId,[]);
    groups.get(member.mId).push({id:member.id,name:member.name||'',rating:Number.isFinite(member.rating)?member.rating:null,level:Number.isInteger(member.level)?member.level:null});
  }
  for(const copies of groups.values())copies.sort((a,b)=>(b.rating??-1)-(a.rating??-1)||(b.level??-1)-(a.level??-1)||a.id-b.id);
  const tracked=[...entries],known=new Set(entries.map(entry=>entry.id));
  for(const [id,copies]of groups)if(!known.has(id))tracked.push({id,name:copies[0]?.name||'Miscrit '+id,rarity:'Unlisted',names:[]});
  const indexLoaded=index!==null&&index!==undefined;
  return tracked.map(entry=>{
    const copies=groups.get(entry.id)||[],best=copies[0]||null;
    const highestLevel=copies.length?Math.max(...copies.map(m=>m.level||0)):null;
    const ownedCompletion=highestLevel>=30,indexedCompletion=index?.[entry.id]?.complete===true;
    const complete=ownedCompletion||indexedCompletion?true:indexLoaded?false:null;
    return {id:entry.id,name:entry.name,rarity:entry.rarity||'Unlisted',copies,ownedCount:copies.length,bestRating:best?.rating??null,bestLevel:best?.level??null,highestLevel,complete,ownedCompletion,indexedCompletion,
      previouslyCaptured:Boolean(index?.[entry.id]?.captured?.some(Boolean)),
      searchText:[entry.name,...(entry.names||[]),...copies.map(m=>m.name)].join(' ').toLowerCase()};
  });
}
function filterCollectionRows(rows,filters){
  const query=(filters.search||'').trim().toLowerCase();
  const tiers=['Exotic','Rare','Common','Epic','Legendary','Unlisted'];
  const priority=row=>{const i=tiers.indexOf(row.rarity);return i<0?tiers.length:i;};
  return rows.filter(row=>
    (!query||row.searchText.includes(query))&&
    (!filters.tier||filters.tier==='all'||row.rarity===filters.tier)&&
    (!filters.ownership||filters.ownership==='all'||(filters.ownership==='owned'?row.ownedCount>0:row.ownedCount===0))&&
    (!filters.rating||filters.rating==='all'||(filters.rating==='qualified'?row.bestRating>=17:row.ownedCount>0&&row.bestRating!==null&&row.bestRating<17))&&
    (!filters.completion||filters.completion==='all'||(filters.completion==='complete'?row.complete===true:filters.completion==='incomplete'?row.complete===false:row.complete===null))
  ).sort((a,b)=>{
    if(filters.sort==='rating')return (b.bestRating??-1)-(a.bestRating??-1)||a.name.localeCompare(b.name);
    if(filters.sort==='level')return (b.highestLevel??-1)-(a.highestLevel??-1)||a.name.localeCompare(b.name);
    if(filters.sort==='name')return a.name.localeCompare(b.name);
    return priority(a)-priority(b)||a.name.localeCompare(b.name);
  });
}
function summarizeCollection(rows){
  return {total:rows.length,owned:rows.filter(row=>row.ownedCount>0).length,missing:rows.filter(row=>row.ownedCount===0).length,
    copies:rows.reduce((sum,row)=>sum+row.ownedCount,0),qualified:rows.filter(row=>row.bestRating>=17).length,complete:rows.filter(row=>row.complete===true).length};
}
function renderCollection(){
  const player=state?.player,index=state?.collectionIndex;
  const accountButton=$('collection-account-action');
  const needsAccount=!player||state.requiresLogin||!state.connected||index===null||index===undefined;
  accountButton.hidden=!needsAccount;accountButton.textContent=!player||state?.requiresLogin?'Sign in':state.reconnecting?'Reconnecting...':'Reload account data';
  accountButton.disabled=Boolean(state?.busy||state?.reconnecting||(player&&state?.running));
  const ids=['collection-search','collection-tier','collection-ownership','collection-rating','collection-completion','collection-sort'];
  for(const id of ids)$(id).disabled=!player;
  const filters={search:$('collection-search').value,tier:$('collection-tier').value,ownership:$('collection-ownership').value,rating:$('collection-rating').value,completion:$('collection-completion').value,sort:$('collection-sort').value};
  const rows=player?buildCollectionRows(catalog,player.roster,index):[];
  const filtered=filterCollectionRows(rows,filters),pages=Math.max(1,Math.ceil(filtered.length/24));
  collectionPage=Math.max(1,Math.min(collectionPage,pages));
  const signature=JSON.stringify([rows,filters,collectionPage,Boolean(player),state?.connected,state?.reconnecting,state?.requiresLogin]);
  if(signature===collectionRenderKey)return;collectionRenderKey=signature;
  const totals=summarizeCollection(rows);
  $('collection-owned').textContent=player?totals.owned+' / '+totals.total:'-';
  $('collection-copies').textContent=player?totals.copies+' owned copies / '+(totals.copies-totals.owned)+' extra copies':'Sign in to load your collection';
  $('collection-missing').textContent=player?totals.missing:'-';$('collection-qualified').textContent=player?totals.qualified:'-';$('collection-complete').textContent=player?totals.complete:'-';
  $('collection-source').textContent=!player?'Sign in to inspect your collection.':index===null||index===undefined?'Owned roster loaded. Historical completion is unconfirmed until the Miscrits index loads.':!state.connected?'Showing your last loaded collection. Reconnect for current account data.':'Owned roster and Miscrits index loaded. Missing means not currently owned; completed families include released copies recorded in the index.';
  const tiers=$('collection-tiers');tiers.replaceChildren();
  if(player)for(const rarity of [...trainingTiers,...(rows.some(row=>row.rarity==='Unlisted')?['Unlisted']:[])]){
    const part=summarizeCollection(rows.filter(row=>row.rarity===rarity));if(!part.total)continue;
    const button=element('button','tier-progress'+(filters.tier===rarity?' is-active':''));button.type='button';button.setAttribute('aria-pressed',String(filters.tier===rarity));
    button.append(element('strong','',rarity),element('span','',part.owned+' / '+part.total+' owned'));
    const progress=element('progress');progress.max=part.total;progress.value=part.owned;progress.setAttribute('aria-label',rarity+' families owned');button.append(progress,element('small','',part.qualified+' with 17+ / '+part.complete+' complete'));
    button.addEventListener('click',()=>{$('collection-tier').value=filters.tier===rarity?'all':rarity;collectionPage=1;renderCollection();});tiers.append(button);
  }
  const grid=$('collection-grid'),opened=new Set([...grid.querySelectorAll('details[open]')].map(item=>item.dataset.family));grid.replaceChildren();
  for(const row of filtered.slice((collectionPage-1)*24,collectionPage*24)){
    const card=element('article','collection-family');
    const heading=element('div','collection-family-heading');heading.append(image(row.name));const title=element('div');title.append(element('h3','',row.name),element('small','muted',row.rarity));heading.append(title,element('span','badge'+(row.ownedCount?' collection-owned-badge':''),row.ownedCount?'Owned':'Missing'));card.append(heading);
    const stats=element('dl','collection-family-stats');
    for(const [label,value]of [['Copies',row.ownedCount],['Best rating',row.bestRating===null?'-':row.bestRating+'/18'],['Best copy level',row.bestLevel===null?'-':row.bestLevel]]){const item=element('div');item.append(element('dt','',label),element('dd','',value));stats.append(item);}card.append(stats);
    const status=element('p','collection-completion'+(row.complete===true?' is-complete':''),row.ownedCompletion?'Level 30 complete':row.indexedCompletion?'Level 30 complete in index':row.complete===null?'Index completion unconfirmed':'Not yet level 30');card.append(status);
    if(row.ownedCount&&row.highestLevel!==row.bestLevel)card.append(element('small','muted','Highest owned level: '+row.highestLevel));
    if(!row.ownedCount&&row.previouslyCaptured)card.append(element('small','muted','Previously captured / not currently owned'));
    if(row.ownedCount){
      const details=element('details','collection-copy-list');details.dataset.family=String(row.id);details.open=opened.has(String(row.id));details.append(element('summary','',row.ownedCount+' owned '+(row.ownedCount===1?'copy':'copies')));
      const list=element('ul');for(const member of row.copies)list.append(element('li','',(member.name||row.name)+' / Lv '+(member.level??'?')+' / '+(member.rating??'?')+'/18 / #'+member.id));details.append(list);card.append(details);
    }
    grid.append(card);
  }
  $('collection-empty').hidden=Boolean(filtered.length);$('collection-empty').textContent=player?'No species match these filters.':'Sign in to load your collection.';
  $('collection-result-count').textContent=player?filtered.length+' of '+rows.length+' families':'Sign in to load';
  $('collection-page').textContent=filtered.length?'Page '+collectionPage+' of '+pages:'0 results';
  $('collection-prev').disabled=!filtered.length||collectionPage<=1;$('collection-next').disabled=!filtered.length||collectionPage>=pages;
}
for(const id of ['collection-search','collection-tier','collection-ownership','collection-rating','collection-completion','collection-sort'])$(id).addEventListener('input',()=>{collectionPage=1;renderCollection();});
$('collection-prev').addEventListener('click',()=>{collectionPage--;renderCollection();});
$('collection-next').addEventListener('click',()=>{collectionPage++;renderCollection();});
$('collection-account-action').addEventListener('click',()=>state?.player&&!state.requiresLogin?post('reconnect'):openLogin());
function familyStatus(entry){
  const copies=(state?.player?.roster||[]).filter(m=>m.mId===entry.id).sort((a,b)=>b.rating-a.rating||b.level-a.level||a.id-b.id);
  const complete=Boolean(state?.collectionIndex?.[entry.id]?.complete||copies.some(m=>m.level>=30));
  return {best:copies[0],complete,indexChecked:state?.collectionIndex!==null&&state?.collectionIndex!==undefined};
}
function huntAccess(entry){
  if(!state?.connected||state.reconnecting||state.requiresLogin)return {available:false,reason:'Sign in to check maps'};
  if(state.huntAccessVersion!==2||!state.huntAvailability)return {available:false,reason:'Restart website backend'};
  return state.huntAvailability[entry?.name]||{available:false,reason:'Map data unavailable'};
}
function tierAccess(){
  if(!state?.player)return {ready:false,reason:'Sign in to load your collection and unlock tier buttons.',action:'Sign in'};
  if(state.requiresLogin)return {ready:false,reason:'Your session expired. Sign in again to unlock tier buttons.',action:'Sign in'};
  if(state.reconnecting)return {ready:false,reason:'Reconnecting to the game. Tier buttons unlock after your account data is restored.',action:''};
  if(!state.connected)return {ready:false,reason:'Reconnect your account to check the collection index before selecting tiers.',action:'Reconnect'};
  if(state.collectionIndex===null||state.collectionIndex===undefined)return {ready:false,reason:'Your Miscrits index has not loaded. Reload account data to unlock tier buttons.',action:'Reload account data'};
  return {ready:true,reason:'Collection and Miscrits index loaded. Add owned 17+ copies or mapped capture targets by tier.',action:''};
}
function addMappedHuntNames(entries){
  const names=[...new Set([...(draft.names||[]),...entries.filter(entry=>huntAccess(entry).available).map(entry=>entry.name)])];
  if(names.length>100){toast('The hunt list supports 100 targets. Remove some hunt targets before adding this tier.');return false;}
  draft.names=names;return true;
}
function importTierTargets(){
  if(!draft)return;const access=tierAccess();if(!access.ready){toast(access.reason);return;}
  const entries=catalog.filter(entry=>draft.replacementNames.includes(entry.name)&&entry.stops.length>0&&huntAccess(entry).available).filter(entry=>{const status=familyStatus(entry);return !status.complete&&(!status.best||status.best.rating<17);});
  if(!addMappedHuntNames(entries))return;dirty=true;renderLists();toast(entries.length+' mapped tier targets copied to Your next great find. Save hunt settings to apply.');
}
function addTier(rarity,kind){
  if(!draft)return;const access=tierAccess();if(!access.ready){toast(access.reason);return;}
  const entries=catalog.filter(s=>s.rarity===rarity).filter(s=>{const status=familyStatus(s);return !status.complete&&(kind==='owned'?status.best?.rating>=17&&status.best.id!==state.player.team[0]?.id:(!status.best||status.best.rating<17)&&s.stops.length>0&&huntAccess(s).available);});
  if(kind==='capture'&&!addMappedHuntNames(entries))return;
  draft.replacementNames=[...new Set([...draft.replacementNames,...entries.map(s=>s.name)])];dirty=true;renderLists();toast(entries.length+' '+rarity+' species added'+(kind==='capture'?' to the tier list and Your next great find':'')+'. Save settings to apply.');
}
// Legacy tier helpers above remain for saved mapping compatibility; no team UI uses them.
function renderTierLists(){}
function renderTeam(){teamStore.publish(state,catalog);}
function combatant(member,side){const card=element('div','combatant');card.append(image(catalog.find(s=>s.id===member.mId)?.name||member.name),element('h3','',member.name),element('p','',`${side} · Level ${member.level}${member.rating!==undefined?' · '+member.rating+'/18':''}`));const bar=element('div','hp-track');const progress=element('progress');progress.max=member.hp;progress.value=Math.max(0,member.chp);progress.setAttribute('aria-label',member.name+' health');bar.append(progress);card.append(bar,element('small','',`${member.chp} / ${member.hp} HP`));return card;}
function actionButton(label,kind,id,className='button subtle'){const button=element('button',className,label);button.addEventListener('click',()=>post('action',{kind,...(id===undefined?{}:{id})}));return button;}
function renderBattle(){
  renderArena();
  const b=state.battle;$('battle-dot').hidden=!b;$('battle-empty').hidden=Boolean(b&&!b.joining);$('battle-content').hidden=!b||b.joining;
  if(!b||b.joining){$('turn').textContent=b?'Joining battle…':'No active battle';return;}
  $('battle-title').textContent=({Default:'Battle Arena',Platinum:'Platinum Arena',Random:'Random Arena',Campaign:'Campaign battle',Wild:'Wild encounter'})[b.type]||b.type+' battle';const own=b.nextTurn===b.player.user_id;
  $('turn').textContent=b.winner?'Battle ending…':b.pending?'Captured!':own?'Your turn':'Opponent’s turn';
  $('battle-player').replaceChildren(combatant(b.player.miscrits[0],'Your team'));$('battle-foe').replaceChildren(combatant(b.foe.miscrits[0],'Opponent'));
  const blocked=!state.connected||state.reconnecting||state.running||state.busy||!own||b.awaitingAction||b.acted===b.serial||b.pending||Boolean(b.winner)||b.player.miscrits[0].handicap;
  $('abilities').replaceChildren();for(const a of b.player.miscrits[0].abilities){const button=actionButton(a.name,'ability',a.id,'ability');button.append(element('small','',`${a.element} · ${a.type}${a.recharge>0?' · CD '+a.recharge:''}`));button.disabled=blocked||a.recharge!==0||a.remaining===0;button.title=a.desc||'';$('abilities').append(button);}
  $('switches').replaceChildren();for(const m of b.player.miscrits.slice(1)){const button=actionButton('Switch: '+m.name,'switch',m.id);button.disabled=blocked||m.chp<=0||b.player.miscrits[0].paralyzed;$('switches').append(button);}
  $('capture-chance').textContent=b.type==='Wild'?`Server capture chance: ${b.captureChance??'—'}% · Attempts: ${b.foe.miscrits[0].attempts||0}`:b.type+' battle · captures unavailable';
  $('capture').disabled=blocked||b.type!=='Wild'||!(b.captureChance>0)||b.foe.miscrits[0].attempts>0;
  $('flee-action').disabled=blocked;$('keep').hidden=!b.pending||!b.foe.miscrits[0].captured;$('keep').disabled=!state.connected||state.reconnecting||state.running||b.keepSent||b.awaitingAction||b.acted===b.serial;
  if(b.manual && b.id!==lastBattleId){lastBattleId=b.id;setTab('battle');toast('Target found. Your manual battle is ready.');}
}
$('capture').addEventListener('click',()=>post('action',{kind:'capture'}));$('flee-action').addEventListener('click',()=>post('action',{kind:'flee'}));$('keep').addEventListener('click',()=>post('action',{kind:'keep'}));
function workflowDuration(seconds){const value=Math.max(0,Math.floor(seconds||0));return Math.floor(value/3600)+'h '+Math.floor(value%3600/60)+'m '+value%60+'s';}
function queueLocation(stop){return stop?[stop.label,stop.location?.replaceAll('_',' '),stop.area!==undefined?'area '+stop.area:'',stop.object!==undefined?'object '+stop.object:'',stop.targets?.join(', ')].filter(Boolean).join(' / '):'None';}
function renderStopReport(){
  const report=state?.lastStop;
  $('stop-report-empty').hidden=Boolean(report);$('stop-report-details').hidden=!report;
  $('stop-report-state').textContent=!report?'No stops recorded':report.resumedAt?'Resumed since this stop':'Last stop';
  if(!report)return;
  $('stop-report-category').textContent=report.category;
  $('stop-report-reason').textContent=report.message;
  $('stop-report-action').textContent=report.action;
  const where=report.location?[report.location.map,'area '+report.location.area,'object '+report.location.object].join(' / '):'';
  $('stop-report-context').textContent=[new Date(report.time).toLocaleString(),report.activity,where,report.battle,report.rpcId?'Request: '+report.rpcId:''].filter(Boolean).join(' · ');
  $('stop-report-details').classList.toggle('is-uncertain',Boolean(report.uncertain));
}
function renderWorkflow(){
  renderStopReport();
  const queue=state?.queue||{targets:[],message:'Reload the page after updating the backend.'};
  $('queue-running').textContent=state?.running?'Running':'Paused';$('queue-message').textContent=queue.message;
  $('queue-current').textContent=queueLocation(queue.current);$('queue-next').textContent=queueLocation(queue.next);
  const list=$('queue-list');list.replaceChildren();
  for(const target of queue.targets||[]){const row=element('div','workflow-row');const info=element('div');info.append(element('strong','',(target.primary?'★ Main · ':'')+target.name),element('small','',target.reason+(target.waitSeconds?' '+target.waitSeconds+'s remaining.':'')));row.append(info,element('span','badge',target.status));list.append(row);}
  if(!queue.targets?.length)list.append(element('p','muted','No wild targets in the current saved setup.'));
  $('wild-heal-usage').textContent=(state?.wildHealingSpent||0)+' / '+(state?.config?.wildHealBudget??30)+' virtue used this sign-in session.';
  const select=$('profile-list'),previous=select.value;select.replaceChildren();const placeholder=element('option','','Choose a profile');placeholder.value='';select.append(placeholder);
  for(const profile of state?.profiles||[]){const option=element('option','',profile.name);option.value=profile.name;select.append(option);}select.value=(state?.profiles||[]).some(p=>p.name===previous)?previous:'';
  $('profile-load').disabled=!select.value||state?.running||state?.busy||state?.battle||state?.reconnecting;$('profile-delete').disabled=!select.value||posting;
  $('stats-reset').disabled=Boolean(state?.running||state?.busy||state?.battle||state?.reconnecting);
  const stats=state?.sessionStats||{},items=[['Elapsed',workflowDuration(stats.elapsedSeconds)],['Search requests',stats.searches],['Encounters',stats.encounters],['Free capture attempts',stats.captureAttempts],['Kept captures',stats.captures],['Duplicate families kept',stats.duplicates],['Rating 17+ kept',stats.qualifiedCaptures],['Battles won',stats.battlesWon],['Fled',stats.fled],['Earned-XP levels',stats.levels],['Team XP awarded',stats.xpAwarded],['Heals',stats.heals],['Virtue spent on heals',stats.virtueSpent],['Item drops',stats.drops],['Cooldown replies',stats.cooldowns]];
  const container=$('session-stats');container.replaceChildren();for(const [label,value]of items){const item=element('div');item.append(element('small','',label),element('strong','',value??0));container.append(item);}
  const alerts=$('workflow-alerts');alerts.replaceChildren();for(const alert of (state?.alerts||[]).slice(0,20)){const row=element('div','workflow-row');row.append(element('span','',alert.message),element('small','muted',new Date(alert.time).toLocaleTimeString()));alerts.append(row);}
  if(!state?.alerts?.length)alerts.append(element('p','muted','Capture, training-complete and stopped alerts will appear here.'));
  $('desktop-notifications').textContent=browserAlertsEnabled?'Disable browser alerts':'Enable browser alerts';
  $('notifications-help').textContent=browserAlertsEnabled?'Browser alerts enabled while this page stays open. The backend keeps recent in-app alerts when the tab is closed.':'In-app alerts are collected by the backend. Browser alerts need permission and this page open; no push service runs after closing it.';
}
function freshAlerts(previous,next){
  if(!previous||!next.config?.notifyEvents)return [];
  const latest=Math.max(0,...(previous.alerts||[]).map(alert=>alert.id));
  return (next.alerts||[]).filter(alert=>alert.id>latest).sort((a,b)=>a.id-b.id);
}
function consumeAlerts(previous,next){
  for(const alert of freshAlerts(previous,next)){
    toast(alert.message);
    if(browserAlertsEnabled&&typeof Notification!=='undefined'&&Notification.permission==='granted'){
      try{const notification=new Notification('Miscrits Field Station',{body:alert.message,tag:'miscrits-'+alert.id});notification.onclick=()=>{window.focus();setTab('workflow');notification.close();};}catch{}
    }
  }
}
$('profile-list').addEventListener('change',()=>{$('profile-load').disabled=!$('profile-list').value||state?.running||state?.busy||state?.battle||state?.reconnecting;$('profile-delete').disabled=!$('profile-list').value;});
$('profile-save').addEventListener('click',()=>{if(draft)post('profiles/save',{name:$('profile-name').value,config:formConfig()});});
$('profile-load').addEventListener('click',()=>{if(dirty){toast('Save your current edits before loading another profile.');return;}post('profiles/load',{name:$('profile-list').value});});
$('profile-delete').addEventListener('click',()=>post('profiles/delete',{name:$('profile-list').value}));
$('stats-reset').addEventListener('click',()=>post('stats/reset'));
$('open-stop-report').addEventListener('click',()=>setTab('workflow'));
$('desktop-notifications').addEventListener('click',async()=>{
  if(browserAlertsEnabled){browserAlertsEnabled=false;renderWorkflow();return;}
  if(typeof Notification==='undefined'){toast('This browser does not support desktop notifications. In-app alerts still work.');return;}
  try{const permission=Notification.permission==='default'?await Notification.requestPermission():Notification.permission;browserAlertsEnabled=permission==='granted';if(!browserAlertsEnabled)toast('Browser notifications are blocked or declined. You can still use in-app alerts.');}catch{toast('Browser notification permission is unavailable. In-app alerts still work.');}
  renderWorkflow();
});
function renderHistory(){const records=[...state.history,...state.events].sort((a,b)=>b.time.localeCompare(a.time)).slice(0,300);$('history-count').textContent=state.history.length+' saved records';$('history').replaceChildren();if(!records.length)$('history').append(element('p','muted','Your field notes will appear here.'));for(const record of records){const row=element('div','history-row');const date=new Date(record.time);const time=element('time','',date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));time.title=date.toLocaleString();row.append(time,element('span','',record.message),element('span','badge',record.kind));$('history').append(row);}}
function render(){const p=state.player;$('connection').textContent=state.reconnecting?'◌ Reconnecting…':state.connected?'● Connected':'● Offline';$('connection').classList.toggle('online',state.connected&&!state.reconnecting);$('account-button').textContent=state.connected?'Sign out':'Sign in';$('account-button').disabled=state.reconnecting||state.busy;$('connect').hidden=state.connected&&!state.reconnecting;$('connect').textContent=state.reconnecting?'Reconnecting…':p&&!state.requiresLogin?'Reconnect ↻':'Connect account ↗';$('connect').disabled=state.reconnecting||state.busy;$('trainer').textContent=p?.name||'Not connected';$('player-level').textContent=p?'Trainer level '+p.level:'Sign in to load your account';$('collection').textContent=p?.roster.length??'—';$('virtue').textContent=p?.virtue??'—';$('wins').textContent=state.wins;$('status').textContent=state.status;$('data-status').textContent=state.dataStatus;$('run').disabled=!state.connected||state.reconnecting||(!state.running&&state.busy);$('run').textContent=state.running?'Pause automation':'Start automation';$('run').classList.toggle('running',state.running);if(!dirty)loadDraft(state.config);else if(tab==='hunt')renderLists();renderTeam();renderBattle();if(tab==='history')renderHistory();if(tab==='collection')renderCollection();if(tab==='workflow')renderWorkflow();}
function reconcileHuntTargets(previous,current){
  if(!dirty||!draft)return false;
  const removed=new Set((previous||[]).filter(name=>!(current||[]).includes(name)));
  const names=draft.names.filter(name=>!removed.has(name));
  if(names.length===draft.names.length)return false;
  draft.names=names;if(!names.includes(draft.primaryTarget))draft.primaryTarget='';return true;
}
async function poll(){if(polling||!csrf)return;polling=true;try{const next=await api('state');const targetsChanged=reconcileHuntTargets(state?.config?.names,next.config.names);consumeAlerts(state,next);state=next;if(targetsChanged)renderLists();render();}catch(error){$('status').textContent=error.message;$('connection').textContent='● Backend unavailable';$('run').disabled=true;}finally{polling=false;}}
$('run').addEventListener('click',async()=>{if(state.running){await post('pause');return;}if(selectedActivity()==='wild'&&state.huntAccessVersion!==2){toast('Restart the website backend to load the corrected area access rules before hunting.');return;}if(dirty){toast('Save your settings before starting.');return;}const desired=selectedActivity();if(desired!==draft.activity){try{await api('settings',{...draft,activity:desired});await poll();}catch(error){toast(error.message);return;}}await post('start');});
function openLogin(){if(!state?.connected&&!state?.reconnecting)$('login-dialog').showModal();}
$('connect').addEventListener('click',()=>state?.player&&!state.requiresLogin?post('reconnect'):openLogin());$('close-login').addEventListener('click',()=>$('login-dialog').close());
$('account-button').addEventListener('click',()=>state?.connected?post('logout'):openLogin());
$('login-form').addEventListener('submit',async event=>{event.preventDefault();$('login-error').textContent='';$('sign-in').disabled=true;const identity=$('identity').value,password=$('password').value;$('password').value='';try{await api('login',{identity,password});$('login-dialog').close();await poll();}catch(error){$('login-error').textContent=error.message;}finally{$('sign-in').disabled=false;}});
const onKeyDown=event=>{if(event.key==='F8'&&state?.connected){event.preventDefault();$('run').click();}};
document.addEventListener('keydown',onKeyDown);
document.querySelector('[data-tab="history"]').addEventListener('click',()=>{if(state)renderHistory();});
function fillCatalog(){
  $('species').replaceChildren();for(const s of catalog){const option=element('option');option.value=s.name;$('species').append(option);}
  $('target-input').placeholder=`Search ${catalog.length} Miscrits…`;$('mapped-count').textContent=catalog.filter(s=>s.stops.length).length+' with routes';
}
const disconnectTeam=teamStore.connect({
  settings:async value=>{if(posting)throw new Error('Wait for the current request.');posting=true;try{await api('team/settings',value);await poll();}finally{posting=false;}},
  swap:async value=>{if(posting)throw new Error('Wait for the current request.');posting=true;try{await api('team/swap',value);await poll();}catch(error){await poll();throw error;}finally{posting=false;}}
});
let disposed=false;
void (async()=>{try{await bootstrapBrowser();if(!disposed)await poll();}catch(error){if(!disposed){$('status').textContent=error.message;toast(error.message);}}})();
const pollTimer=setInterval(()=>{if(!disposed)void poll();},1800);
return ()=>{disconnectTeam();disposed=true;clearInterval(pollTimer);clearTimeout(toastTimer);document.removeEventListener('keydown',onKeyDown);};


}
