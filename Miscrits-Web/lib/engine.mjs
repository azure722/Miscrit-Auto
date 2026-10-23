import {Transport, GameError} from './transport.mjs';
import {huntAvailability} from './model.mjs';
import {DEFAULTS, TRAINING_MIN_RATING, settings, owned, trainingStatus, collectionFamilies, miscritsIndex, selectedTrainingPlan, rotationPlan, routePlan, abilities, decision,targetMatches,atSearchLocation} from './model.mjs';
import {SessionStats,huntNames,targetQueue,nextSearchStop,stopAdvice} from './workflow.mjs';
import {ARENAS,isArena,arenaEligibility,draftChoices,arenaTotals} from './arena.mjs';
import {arenaDecision} from './arena-strategy.mjs';
import {teamVitals,teamSwap} from './team.mjs';

export class Engine {
  constructor({catalog,protocol,config={},save=()=>{},history=[],saveHistory=()=>{},profiles=[],saveProfiles=()=>{},transportFactory,manualTeamManagement=false}) {
    Object.assign(this,{catalog,protocol,save,saveHistory});
    this.manualTeamManagement=manualTeamManagement;
    this.config=settings(this.teamConfig({...DEFAULTS,...config}),catalog); this.metadata=new Map(catalog.species.map(s=>[s.id,s]));
    this.events=[]; this.history=history; this.status='Sign in to your Miscrits account.';
    this.player=null; this.battle=null; this.running=false; this.busy=false; this.uncertain=false;
    this.reconnecting=false;this.requiresLogin=false;this.connectionEpoch=0;
    this.collectionIndex=null;this.indexUpdated=0;
    this.cooldowns=new Map(); this.cursor=0; this.wins=0; this.lastProgress=null; this.sequence=Promise.resolve();
    this.transportFactory=transportFactory || ((onState,onClose)=>new Transport(onState,onClose));
    this.stats=new SessionStats();this.wildHealingSpent=0;this.currentSearch=null;this.alerts=[];this.alertId=0;this.saveProfiles=saveProfiles;this.profiles=[];
    this.lastStop=null;
    this.arenaQueue=null;this.draft=null;this.arenaRun={battles:0,wins:0,losses:0,type:null};this.arenaCancelPromise=null;this.arenaRecords={};
    for(const profile of Array.isArray(profiles)?profiles.slice(0,20):[]){try{this.profiles.push({name:this.profileName(profile.name),config:settings(profile.config,catalog)});}catch{}}
  }
  log(message,kind='info') {
    this.status=message;
    this.events.unshift({time:new Date().toISOString(),kind,message}); this.events.length=Math.min(this.events.length,160);
  }
  stop(message='Automation paused. Manual battle controls remain available.',details={}) {
    const wasRunning=this.running;this.running=false;this.log(message);
    this.lastStop={time:new Date().toISOString(),message,...stopAdvice(message,{...details,uncertain:this.uncertain,battle:Boolean(this.battle)}),rpcId:details.rpcId||'',uncertain:this.uncertain,activity:this.config.activity,
      location:details.location||(this.config.activity==='wild'&&this.currentSearch?{map:this.currentSearch.location,area:this.currentSearch.area_id,object:this.currentSearch.object_id}:null),battle:this.battle?.type||'',resumedAt:null};
    if(wasRunning)this.notify('stopped',message);
    if(this.arenaQueue?.ticket&&!this.arenaQueue.cancelled&&!this.battle&&!this.draft)void this.cancelArenaQueue().catch(error=>this.fail(error));
    else if(this.arenaQueue&&!this.arenaQueue.matched&&!this.arenaQueue.ticket&&this.arenaQueue.status!=='Joining queue'){this.arenaQueue.cancelled=true;this.arenaQueue.status='Queue stopped';}
  }
  notify(kind,message){if(!this.config.notifyEvents)return;this.alerts.unshift({id:++this.alertId,time:new Date().toISOString(),kind,message});this.alerts.length=Math.min(this.alerts.length,100);}
  profileName(name){if(typeof name!=='string'||!name.trim()||name.trim().length>48||/[\x00-\x1f]/.test(name))throw new Error('Use a profile name from 1 to 48 characters.');return name.trim();}
  saveProfile(name,config=this.config){
    name=this.profileName(name);const value={name,config:settings(config,this.catalog)};
    const next=this.profiles.filter(p=>p.name.toLowerCase()!==name.toLowerCase());if(next.length>=20)throw new Error('Keep at most 20 hunt profiles.');next.push(value);this.saveProfiles(next);this.profiles=next;this.log('Profile saved: '+name+'.');
  }
  loadProfile(name){name=this.profileName(name);const value=this.profiles.find(p=>p.name===name);if(!value)throw new Error('Profile not found.');if(this.battle)throw new Error('Finish the current battle before loading a profile.');this.updateConfig(value.config);this.log('Profile loaded: '+name+'.');}
  deleteProfile(name){name=this.profileName(name);const next=this.profiles.filter(p=>p.name!==name);if(next.length===this.profiles.length)throw new Error('Profile not found.');this.saveProfiles(next);this.profiles=next;this.log('Profile deleted: '+name+'.');}
  resetStats(){if(this.running||this.busy||this.battle||this.reconnecting)throw new Error('Pause and finish the battle before resetting statistics.');this.stats.reset();this.log('Session counters reset. Wild healing budget usage is unchanged.');}
  fail(error) {
    this.uncertain ||= Boolean(error.uncertain);
    if(!this.running)this.notify('error',error.message||'Game request failed.');
    this.stop(error.message || 'Unexpected game response; automation stopped.',{rpcId:error.rpcId,location:error.searchLocation});
  }
  async login(identity,password) {
    if (this.busy || this.reconnecting || (this.player && this.transport?.connected && !this.requiresLogin)) throw new Error('Already connected or signing in.');
    if (typeof identity!=='string' || !identity.trim() || identity.length>160 || typeof password!=='string' || password.length<8 || password.length>256) throw new Error('Enter your Miscrits username/email and password (at least 8 characters).');
    this.transport?.close();this.player=null;this.battle=null;this.collectionIndex=null;this.indexUpdated=0;this.requiresLogin=false;this.connectionEpoch++;
    this.busy=true; this.log('Connecting to Miscrits…');
    this.stats.reset();this.wildHealingSpent=0;this.currentSearch=null;this.alerts=[];
    this.lastStop=null;
    this.arenaQueue=null;this.draft=null;this.arenaRun={battles:0,wins:0,losses:0,type:null};this.arenaRecords={};
    const transport=this.transportFactory((id,opcode,data)=>{
      if(this.transport!==transport)return;
      this.sequence=this.sequence.then(()=>this.transport===transport?this.receive(id,opcode,data):undefined).catch(error=>this.fail(error));
    },(message,details)=>{if(this.transport===transport)this.disconnected(message,details);});
    this.transport=transport;
    transport.onArena=event=>{if(this.transport===transport)this.sequence=this.sequence.then(()=>this.transport===transport?this.arenaMatched(event):undefined).catch(error=>this.fail(error));};
    try {
      await this.transport.login(identity.trim(),password);
      await this.refresh();
      await this.refreshIndex();
      if (this.player.tutorial) throw new Error('Finish the native game tutorial before using this client.');
      this.uncertain=false; this.cooldowns.clear(); this.wins=0; this.lastProgress=null;
      if (this.player.battle) await this.join(this.player.battle);
      this.log(this.player.battle ? 'Existing battle restored. Use the Battle tab to continue.' : 'Connected. Choose targets or campaign, then Start.');
    } catch(error) { this.transport.close(); this.player=null; this.battle=null; this.fail(error); throw error; }
    finally { this.busy=false; }
  }
  async refresh() {
    const player=await this.transport.rpc('get_player');
    if (!player.user_id || !Array.isArray(player.miscrits) || !Array.isArray(player.team_order)) throw new GameError('The player response is incomplete.',true);
    const previous=this.player;
    if(previous?.user_id===player.user_id)player._huntLimitedObjects=previous._huntLimitedObjects;
    if(previous?.user_id===player.user_id&&JSON.stringify([previous.boss_achievements,previous.tickets])===JSON.stringify([player.boss_achievements,player.tickets]))player._huntRejectedAreas=previous._huntRejectedAreas;
    this.player=player;
    if(this.config.trainSelected&&this.config.activity!=='arena')await this.refreshIndex();
  }
  async refreshIndex(force=false) {
    if(!force && this.collectionIndex && Date.now()-this.indexUpdated<30000)return;
    const transport=this.transport,epoch=this.connectionEpoch,userId=this.player?.user_id;
    if(!transport || !userId)throw new Error('Sign in before loading the Miscrits index.');
    const index=miscritsIndex(await transport.rpc('get_player_seen'));
    if(this.transport!==transport || this.connectionEpoch!==epoch || this.player?.user_id!==userId)throw new Error('Index refresh cancelled.');
    this.collectionIndex=index;this.indexUpdated=Date.now();
  }
  async logout() {
    if (this.busy) throw new Error('Wait for the pending game request before signing out.');
    await this.cancelArenaQueue();
    this.connectionEpoch++;this.reconnecting=false;this.requiresLogin=false;
    this.stop('Signed out.'); this.transport?.close(); this.transport=null; this.player=null; this.battle=null;this.draft=null;this.arenaQueue=null;this.arenaRecords={};this.collectionIndex=null;this.indexUpdated=0;this.uncertain=false;
  }
  disconnected(message,details={}) {
    this.uncertain ||= Boolean(details.uncertain || this.battle?.awaitingAction);
    if(this.arenaQueue&&!this.arenaQueue.matched){this.arenaQueue.cancelled=true;this.arenaQueue.ticket=null;this.arenaQueue.status='Connection lost';}
    this.stop(message+' Reconnecting; automation is paused.');
    if(this.player && !this.recoveryPromise) void this.reconnect().catch(()=>{});
  }
  reconnect() {
    if(this.recoveryPromise)return this.recoveryPromise;
    if(!this.player || !this.transport) return Promise.reject(new Error('Sign in to reconnect.'));
    const transport=this.transport,epoch=this.connectionEpoch,userId=this.player.user_id;
    const manualBattle=this.battle?.manual,previousBattle=this.battle?.id;
    this.running=false;this.reconnecting=true;this.requiresLogin=false;
    const recovery=(async()=>{
      try {
        await transport.reconnect();
        const deadline=Date.now()+30000;
        while(this.busy && Date.now()<deadline && epoch===this.connectionEpoch) await new Promise(resolve=>setTimeout(resolve,30));
        if(epoch!==this.connectionEpoch || this.transport!==transport)return;
        if(this.busy)throw new GameError('A previous request is still settling. Reconnect again after it finishes.',true);
        await this.sequence;
        await this.refresh();
        await this.refreshIndex(true);
        this.player._huntRejectedAreas={};
        if(epoch!==this.connectionEpoch || this.transport!==transport)return;
        if(this.player.user_id!==userId)throw new GameError('The server restored a different account. Sign out and sign in again.',true);
        if(this.draft){await transport.join(this.draft.id);this.draft.awaiting=false;transport.send(this.draft.id,9,{});}
        else if(this.player.battle){await this.join(this.player.battle);if(manualBattle && this.player.battle===previousBattle)this.battle.manual=true;}
        else this.battle=null;
        this.log(this.uncertain?'Reconnected. A previous action is uncertain; check your battle/team and sign in again before automation.':this.battle?'Reconnected and restored your battle. Automation stays paused.':'Reconnected. Press Start when you are ready.');
      }catch(error){
        if(epoch!==this.connectionEpoch || this.transport!==transport)return;
        this.requiresLogin=Boolean(error.requiresLogin);
        this.fail(new GameError(error.requiresLogin?'Session expired. Sign in again to continue.':'Reconnection failed. Use Reconnect to try again.',Boolean(error.uncertain)));
        throw error;
      }finally{if(epoch===this.connectionEpoch)this.reconnecting=false;}
    })().finally(()=>{if(this.recoveryPromise===recovery)this.recoveryPromise=null;});
    this.recoveryPromise=recovery;return recovery;
  }
  teamConfig(value){return this.manualTeamManagement?{...value,trainSelected:false,autoReplace:false,replacementNames:[]}:value;}
  updateTeamSettings(value){
    if(!this.player||!this.transport?.connected||this.requiresLogin)throw new Error('Sign in before changing team settings.');
    if(typeof value.autoLevel!=='boolean'||!Array.isArray(value.platinumUpgradeIds))throw new Error('Invalid training settings.');
    if(value.platinumUpgradeIds.some(id=>!this.player.miscrits.some(m=>m.id===id)))throw new Error('Platinum upgrades must refer to owned Miscrits.');
    this.updateConfig({...this.config,autoLevel:value.autoLevel,platinumUpgradeIds:value.platinumUpgradeIds,trainSelected:false,autoReplace:false,replacementNames:[]});
  }
  async swapTeam(value){
    if(!this.player||!this.transport?.connected||this.requiresLogin)throw new Error('Sign in before changing your team.');
    if(this.running||this.busy||this.reconnecting||this.battle||this.player.battle||this.draft||this.arenaQueue?.ticket||this.arenaCancelPromise)throw new Error('Pause automation and finish the battle or arena queue before swapping.');
    if(this.uncertain)throw new Error('Reconnect and check your team before swapping after an uncertain request.');
    if(!Array.isArray(value.expectedTeam)||value.expectedTeam.some(id=>!Number.isSafeInteger(id)))throw new Error('Reload your team before swapping.');
    teamSwap(this.player.team_order,this.player.miscrits,value.miscritId,value.slot);
    this.busy=true;let acknowledged=false;
    try{
      const transport=this.transport,epoch=this.connectionEpoch,userId=this.player.user_id;
      await this.refresh();
      if(this.transport!==transport||this.connectionEpoch!==epoch||this.player?.user_id!==userId)throw new Error('The account changed. Reload before swapping.');
      if(this.player.battle||this.battle||this.running||this.reconnecting)throw new Error('Finish the active battle before swapping.');
      if(JSON.stringify(value.expectedTeam)!==JSON.stringify(this.player.team_order))throw new Error('Your team changed. Review the refreshed slots and try again.');
      const after=teamSwap(this.player.team_order,this.player.miscrits,value.miscritId,value.slot);
      if(JSON.stringify(after)===JSON.stringify(this.player.team_order))return;
      await transport.rpc('update_team',{team:after});
      acknowledged=true;
      await this.refresh();
      if(this.transport!==transport||this.connectionEpoch!==epoch||this.player?.user_id!==userId||JSON.stringify(this.player.team_order)!==JSON.stringify(after))throw new GameError('The team save could not be confirmed. Reconnect before another swap.',true);
      this.log('Active team updated.');
    }catch(error){if(acknowledged&&!error.uncertain)error=new GameError('The team save could not be confirmed. Reconnect before another swap.',true);this.fail(error);throw error;}finally{this.busy=false;}
  }
  async upgradeTrainingBonus(id){
    if(!this.running||!this.config.autoLevel||!this.config.platinumUpgradeIds.includes(id)||!this.player.team_order.includes(id))return;
    const raw=this.player.miscrits.find(m=>m.id===id),member=owned(raw,this.metadata),bonus=teamVitals(raw,this.metadata.get(member.mId)).bonusLevel;
    const cost=bonus===null?null:member.level-bonus;
    if(cost===0)return;
    if(cost!==1)throw new Error('Platinum bonus paused: this copy needs '+(cost===null?'an unknown number of':cost)+' platinum to catch up. Only 1-platinum upgrades after a new level are enabled.');
    if(!Number.isFinite(this.player.platinum)||this.player.platinum<1)throw new Error('Not enough platinum for the selected bonus upgrade. Automation paused.');
    const beforeBalance=this.player.platinum;
    await this.transport.rpc('add_bonus',{miscritId:id,currLevel:member.level});
    try{await this.refresh();}catch{throw new GameError('The platinum bonus purchase could not be confirmed. Reconnect before continuing; the purchase was not retried.',true);}
    const updated=this.player.miscrits.find(m=>m.id===id);
    if(!updated||teamVitals(updated,this.metadata.get(member.mId)).bonusLevel!==member.level||this.player.platinum!==beforeBalance-1)throw new GameError('The platinum bonus purchase could not be confirmed. Reconnect before continuing; the purchase was not retried.',true);
    this.log(member.name+' bonus upgraded for 1 platinum.');
  }
  updateConfig(value) {
    if(this.draft||this.arenaCancelPromise||this.arenaQueue?.ticket)throw new Error('Finish the arena draft or cancel the queue before changing settings.');
    if(this.battle&&value.arenaType!==undefined&&value.arenaType!==this.config.arenaType)throw new Error('Finish the current battle before changing arena mode.');
    if (this.running || this.busy || this.reconnecting) throw new Error('Pause and wait for the current request before changing settings.');
    if (this.battle && value.activity!==this.config.activity) throw new Error('Finish the current battle before changing activity.');
    const next=settings(this.teamConfig(value),this.catalog); this.save(next); this.config=next; this.cursor=0;
    this.log('Settings saved.');
  }
  start() {
    if (!this.player || !this.transport?.connected || this.requiresLogin) throw new Error('Sign in first.');
    if (this.reconnecting) throw new Error('Wait for reconnection to finish.');
    if (this.busy) throw new Error('Wait for the current game request.');
    if (this.uncertain) throw new Error('A request had an uncertain result. Sign out and back in to check the server state before restarting.');
    if (this.config.activity==='wild' && !this.config.names.length && !(this.config.trainSelected && this.config.replacementNames.length) && !this.battle) throw new Error('Select at least one search target.');
    if (this.config.activity!=='arena' && this.config.trainSelected && !this.config.replacementNames.length) throw new Error('Add species to the separate replacement list before training selected copies.');
    if (this.battle?.manual) throw new Error('This selected target is a manual battle. Finish it in the Battle tab.');
    if (this.battle?.type && !['Wild','Campaign','Default','Platinum','Random'].includes(this.battle.type)) throw new Error('This battle type supports manual control only.');
    if(this.arenaCancelPromise)throw new Error('Wait for arena queue cancellation.');
    if(this.config.activity==='arena'&&!this.battle&&!this.draft){
      if(this.arenaRun.type!==this.config.arenaType||this.arenaRun.battles>=this.config.arenaBattleLimit)this.arenaRun={battles:0,wins:0,losses:0,type:this.config.arenaType};
    }
    if (!this.battle && this.wins>=this.config.campaignLimit) this.wins=0;
    if(this.lastStop)this.lastStop.resumedAt=new Date().toISOString();
    this.running=true; this.log('Automation started.');
  }
  async join(id) {
    this.battle={id,joining:true,created:Date.now(),type:'',winner:'',nextTurn:'',pending:false,captureChance:null,attacks:0,damage:{},damageRisk:false,serial:0,acted:-1,awaitingAction:false,keepSent:false};
    await this.transport.join(id);
  }
  async tick() {
    if (this.busy || this.reconnecting || !this.running || !this.transport?.connected || (!this.battle&&!this.draft&&(!this.arenaQueue||this.arenaQueue.cancelled||this.arenaQueue.matched)&&Date.now()<(this.nextCycle||0))) return;
    this.busy=true;
    try {
      if(this.draft){await this.draftTick();return;}
      if(this.arenaQueue&&!this.arenaQueue.cancelled&&!this.arenaQueue.matched){await this.arenaQueueTick();return;}
      if(this.config.trainSelected&&this.config.activity!=='arena')await this.refreshIndex();
      if (this.battle) {
        if (this.battle.awaitingAction && Date.now()-this.battle.actionSent>25000) throw new GameError('Battle action timed out. No action was resent.',true);
        if (Date.now()-this.battle.updated>45000 || (this.battle.joining && Date.now()-this.battle.created>30000)) throw new GameError('Battle response timed out. Inspect the battle before reconnecting.',true);
        await this.combat(); return;
      }
      this.nextCycle=Date.now()+(this.config.activity==='wild'?this.config.searchIntervalSeconds:3)*1000;
      await this.refresh();
      if (!this.running) return;
      if (this.player.battle) { await this.join(this.player.battle); this.stop('An existing battle was found. Continue it manually.'); return; }
      if(this.config.activity==='arena'){await this.queueArena();return;}
      const selectedPlan=this.config.trainSelected?selectedTrainingPlan(this.player,this.config.replacementNames,this.catalog,this.metadata,this.collectionIndex):null;
      if(this.config.activity==='wild' && !this.config.names.length && !selectedPlan?.traineeIds.length && !selectedPlan?.needsCapture.length){this.stop('All hunt targets collected; no selected trainees or upgrade targets remain.');return;}
      if (selectedPlan?.changed) {
        await this.transport.rpc('update_team',{team:selectedPlan.after});
        await this.refresh();
        if (JSON.stringify(this.player.team_order)!==JSON.stringify(selectedPlan.after)) throw new GameError('Server team did not match the selected training team. Sign in again to check the team.',true);
        this.log('Selected rating-17+ copies for training to level 30 in slots 2–4, Exotic first.');
        return;
      }
      if (this.config.autoLevel || this.config.trainSelected) {
        if (!this.protocol.training_xp || Object.keys(this.protocol.training_xp).length!==34) throw new Error('Training XP requirements are unavailable. Update the browser game data before enabling auto level-up.');
        const team=this.player.team_order;
        if (!team.length || team.length>4 || new Set(team).size!==team.length || team.some(id=>!this.player.miscrits.some(m=>m.id===id))) throw new Error('The active team is incomplete; auto level-up paused.');
        const order=selectedPlan?[...selectedPlan.traineeIds,...team.filter(id=>!selectedPlan.traineeIds.includes(id))]:team;
        const raw=order.map(id=>this.player.miscrits.find(m=>m.id===id)).find(m=>{
          const slot=team.indexOf(m.id);
          const member=owned(m,this.metadata);
          if(selectedPlan && slot===0 && member.level<30) {
            const completed=this.collectionIndex?.[member.mId]?.complete || this.player.miscrits.some(other=>other.id!==member.id && owned(other,this.metadata).mId===member.mId && owned(other,this.metadata).level>=30);
            const anotherTrainee=selectedPlan.traineeIds.some(id=>owned(this.player.miscrits.find(other=>other.id===id),this.metadata).mId===member.mId);
            if(completed || anotherTrainee)return false;
          }
          const cap=selectedPlan ? (slot===0?(this.config.autoLevel?35:0):selectedPlan.traineeIds.includes(m.id)?30:0) : 35;
          return member.level<cap && trainingStatus(m,this.protocol).readyToTrain;
        });
        if (raw) {
          const before=owned(raw,this.metadata);
          await this.transport.rpc('xp_train',{miscritId:before.id,currLevel:before.level});
          // Never infer the new level or retry: reload the authoritative roster first.
          await this.refresh();
          const updated=this.player.miscrits.find(m=>m.id===before.id);
          if (!updated || owned(updated,this.metadata).level!==before.level+1) throw new GameError('Training was accepted but the new level did not refresh. Sign in again to check the team before continuing.',true);
          this.record('training',`${before.name}: level ${before.level} → ${before.level+1} with earned XP`,before);
          this.log(`${before.name} reached level ${before.level+1} with earned XP.`);
          this.stats.levels++;if(before.level+1===(selectedPlan&&team.indexOf(before.id)>0?30:35))this.notify('training',`${before.name} finished training at level ${before.level+1}.`);
          await this.upgradeTrainingBonus(before.id);
          return; // One level per cycle; recheck pause, team and XP before any next action.
        }
      }
      if (this.config.autoReplace && !this.config.trainSelected) {
        const plan=rotationPlan(this.player,this.config.replacementNames,this.catalog,this.metadata);
        if (plan.changed) {
          await this.transport.rpc('update_team',{team:plan.after});
          this.player.team_order=plan.after;
          this.log('Replaced level-35 teammates in slots 2–4.');
          await this.refresh();
          if (!this.running) return;
          if (JSON.stringify(this.player.team_order)!==JSON.stringify(plan.after)) throw new GameError('Server team did not match the replacement request.',true);
        }
      }
      const roster=new Map(this.player.miscrits.map(m=>{const value=owned(m,this.metadata);return [value.id,value];}));
      if (this.player.team_order.some(id=>!roster.has(id))) throw new Error('The active team is incomplete.');
      const fainted=this.player.team_order.filter(id=>roster.get(id).chp<=0).length;
      if (!this.player.team_order.length) throw new Error('Choose a team before starting.');
      if (this.config.activity==='campaign') {
        const info=await this.transport.rpc('get_campaign');
        if (!Number.isInteger(info.last_completed) || !Number.isInteger(info.tries)) throw new Error('Invalid campaign progress.');
        if (this.lastProgress!==null && info.last_completed<=this.lastProgress) throw new Error('Campaign progress has not advanced after victory.');
        this.lastProgress=null;
        if (info.tries>=10) { this.stop('All 10 campaign attempts have been used today.'); return; }
        if (info.last_completed>=this.protocol.campaign_last) { this.stop('All campaign stages are complete.'); return; }
        if (this.wins>=this.config.campaignLimit) { this.stop('Campaign victory limit reached.'); return; }
        const campaign=['forest','mount_gemma','sunfall_shores','miscrian_jungle'][Math.floor(info.last_completed/100)];
        if (this.player.level<this.protocol.campaigns[campaign].min_level) throw new Error('Your player level is too low for the next campaign.');
        if (fainted>=2) {
          if (this.player.virtue<10) throw new Error('Two teammates have fainted. Need 10 virtue before continuing.');
          await this.transport.rpc('heal_team');
          this.stats.heals++;this.stats.virtueSpent+=10;
          await this.refresh();
          this.log('Team healed with 10 virtue.');
          if (!this.running) return;
          if (this.player.team_order.some(id=>owned(this.player.miscrits.find(m=>m.id===id)||{}).chp<=0)) throw new GameError('Healing succeeded but team HP did not refresh. Check team health before continuing.',true);
        } else if (fainted===this.player.team_order.length) throw new Error('Heal the team before continuing.');
        if (!this.running) return;
        const result=await this.transport.rpc('create_battle',{type:'Campaign',payload:{}});
        if (!result.matchId) throw new GameError('Campaign request returned no battle ID.',true);
        this.stageBefore=info.last_completed;
        await this.join(result.matchId); this.log('Campaign stage '+(info.last_completed+1)+' started.');
      } else {
        if(this.config.wildAutoHeal && fainted>0){await this.healWildTeam();return;}
        if (fainted===this.player.team_order.length) throw new Error('Heal your team before searching.');
        const routeNames=huntNames(this.config,selectedPlan);
        const route=routePlan({...this.config,names:routeNames},this.player,this.catalog);
        if (!route.stops.length) throw new Error('No available search locations for the selected targets. '+[...new Set(Object.values(route.availability).map(access=>access.detail||access.reason))].join(' '));
        const now=Date.now();
        const {stop,nextCursor}=nextSearchStop({config:this.config,stops:route.stops,cursor:this.cursor,catalog:this.catalog,cooldowns:this.cooldowns,now});
        this.cursor=nextCursor;
        if (!stop) { this.status='Waiting for search objects to finish their cooldown.'; return; }
        const searchLabel=`${stop.location.replaceAll('_',' ')} / area ${stop.area_id} / object ${stop.object_id}`;
        const area=this.player.area;
        if (!atSearchLocation(area,stop,this.protocol)) {
          try {await this.transport.rpc('update_location',{locationId:this.protocol.locations[stop.location],areaId:stop.area_id});}
          catch(error){
            if(error.rejected&&!error.uncertain){
              this.player._huntRejectedAreas||={};
              this.player._huntRejectedAreas[stop.location+':'+stop.area_id]=`The server rejected travel to ${stop.location.replaceAll('_',' ')} area ${stop.area_id}. This area is excluded for this session. Check its boss gates, then reload account data or sign in again to recheck access.`;
            }
            error.message+=` Moving to ${searchLabel}.`;error.searchLocation={map:stop.location,area:stop.area_id,object:stop.object_id};throw error;
          }
          this.player.area={area_id:stop.area_id,location:{id:this.protocol.locations[stop.location],name:stop.location}};
          if (!this.running) return;
        }
        // Reserve before sending. Rejected/uncertain mutations are never retried in a loop.
        this.cooldowns.set(stop.key,now+(this.player.left_traits?.includes(100)?21000:31000));
        this.currentSearch=structuredClone(stop);this.stats.searches++;
        this.nextCycle=Math.max(this.nextCycle,Date.now()+this.config.searchIntervalSeconds*1000);
        let result;
        try {
          result=await this.transport.rpc('create_battle',{type:'Wild',payload:{objectId:stop.object_id}});
        } catch(error) {
          const outcome=error.rejected && error.rpcId==='create_battle' ? error.searchOutcome : null;
          if(outcome?.limit){
            this.player._huntLimitedObjects||={};
            this.player._huntLimitedObjects[stop.key]='The game server reported a daily search limit at '+searchLabel+'. This object is excluded for this session. No reset time or limit count was supplied. The scope may include other targets. Wait until the game allows searching; changing targets is not a confirmed fix.';
          }
          // Native WorldManager.setup_battle uses success:false for these ordinary outcomes.
          // Only a definitive response permits continuing; unknown/time-out results still stop.
          if (outcome && !outcome.disabled && !outcome.limit && (outcome.cooldown || outcome.drop)) {
            if(outcome.cooldown)this.stats.cooldowns++;else this.stats.drops++;
            this.cooldowns.set(stop.key,Date.now()+(this.player.left_traits?.includes(100)?21000:31000));
            this.log(outcome.cooldown?`Search object cooling down (${searchLabel}). Continuing when available.`:`Item drop instead of an encounter (${searchLabel}). Continuing search.`);
            return;
          }
          error.message+=` Search: ${searchLabel}.`;
          throw error;
        }
        this.log(`Searched ${stop.location.replaceAll('_',' ')} · area ${stop.area_id} · object ${stop.object_id}.`);
        if(result.limit){
          this.player._huntLimitedObjects||={};
          this.player._huntLimitedObjects[stop.key]='The game server reported a daily search limit at '+searchLabel+'. This object is excluded for this session.';
          throw new Error('The game server reported a daily search limit. [create_battle] Search: '+searchLabel+'.');
        }
        if(result.disabled)throw new Error('The game disabled this search object.');
        if (result.matchId) await this.join(result.matchId);
      }
    } catch(error) { this.fail(error); }
    finally { this.busy=false; }
  }
  async healWildTeam(){
    if(this.wildHealingSpent+10>this.config.wildHealBudget)throw new Error('Wild healing virtue budget reached. Increase the limit or heal manually.');
    if(!(this.player.virtue>=10))throw new Error('Need 10 virtue to heal the fainted wild team.');
    // Reserve first; an uncertain result must never trigger a second paid mutation.
    const team=[...this.player.team_order];this.wildHealingSpent+=10;
    try{await this.transport.rpc('heal_team');}catch(error){if(!error.uncertain)this.wildHealingSpent-=10;throw error;}
    this.stats.heals++;this.stats.virtueSpent+=10;await this.refresh();
    const confirmed=JSON.stringify(team)===JSON.stringify(this.player.team_order)&&team.every(id=>{const raw=this.player.miscrits.find(m=>m.id===id);const hp=raw?owned(raw,this.metadata).chp:NaN;return Number.isFinite(hp)&&hp>0;});
    if(!confirmed)throw new GameError('Healing was accepted but healthy team HP did not refresh. Sign in again to check the team.',true);
    this.log('Wild team healed with 10 virtue. Budget used: '+this.wildHealingSpent+' / '+this.config.wildHealBudget+'.');
  }
  async queueArena(){
    if(this.arenaRun.battles>=this.config.arenaBattleLimit){this.stop('Arena battle limit reached.');return;}
    const type=this.config.arenaType,info=await this.loadArenaInfo(type);
    if(info.info?.banned)throw new Error('Random Arena access is currently banned by the game.');
    arenaEligibility(this.player,type,this.metadata,this.protocol.arena,{allowInjured:this.config.arenaAllowInjured});
    if(!this.running)return;
    const q=this.arenaQueue={type,ticket:null,started:Date.now(),status:'Joining queue',cancelled:false,matched:false};
    const ticket=await this.transport.addArena(type);
    if(this.arenaQueue!==q)return;
    if(q.matched)return;
    q.ticket=ticket;q.matchTicket=ticket;q.status='Searching for opponent';
    if(!this.running){await this.cancelArenaQueue();return;}
    this.log('Searching '+ARENAS[type].name+' for an opponent.');
  }
  async loadArenaInfo(type){
    if(!isArena(type))throw new Error('Choose a supported arena.');
    const transport=this.transport,epoch=this.connectionEpoch,info=await transport.rpc(ARENAS[type].rpc);
    if(this.transport!==transport||this.connectionEpoch!==epoch||!this.player)throw new Error('Arena totals refresh cancelled.');
    this.arenaRecords[type]=arenaTotals(type,info);
    for(const member of info.team||[]){const raw=this.player.miscrits.find(m=>Number(m.id)===Number(member.id));if(raw&&Number.isFinite(member.chp))raw[raw.v===2?'c':'chp']=member.chp;}
    return info;
  }
  async refreshArenaTotals(type){
    if(!this.player||!this.transport?.connected||this.requiresLogin)throw new Error('Sign in before loading arena totals.');
    if(this.busy||this.running||this.battle||this.draft||this.reconnecting||this.arenaCancelPromise)throw new Error('Pause and finish the current arena activity before refreshing totals.');
    this.busy=true;
    try{await this.loadArenaInfo(type);}finally{this.busy=false;}
  }
  cancelArenaQueue(){
    if(this.arenaCancelPromise)return this.arenaCancelPromise;
    const q=this.arenaQueue;
    if(!q||!q.ticket||q.cancelled||q.matched)return Promise.resolve();
    q.cancelled=true;q.status='Cancelling queue';const ticket=q.ticket,transport=this.transport,epoch=this.connectionEpoch;
    this.arenaCancelPromise=(async()=>{
      try{await transport.removeArena(ticket);if(epoch===this.connectionEpoch&&!q.matched){q.ticket=null;q.status='Queue cancelled';}}
      catch(error){if(epoch!==this.connectionEpoch)return;if(!q.matched){q.ticket=null;q.status='Cancellation unconfirmed';error.uncertain=true;throw error;}}
    })().finally(()=>{this.arenaCancelPromise=null;});
    return this.arenaCancelPromise;
  }
  async arenaQueueTick(){
    const q=this.arenaQueue,elapsed=Date.now()-q.started;
    if(elapsed>=120000){await this.cancelArenaQueue();q.cancelled=true;this.stop('Arena opponent search timed out after 120 seconds.');return;}
    if(q.type!=='Random'&&q.ticket&&elapsed>=Number(this.protocol.arena?.bot_timeout||91)*1000){
      const ticket=q.ticket;q.ticket=null;q.status='Waiting for native bot assignment';
      // Native Default/Platinum queues remove their ticket after BOT_TIMEOUT; the server sends notification 42.
      try{await this.transport.removeArena(ticket);}catch(error){if(!q.matched)throw error;}
    }
  }
  async arenaMatched(event){
    const q=this.arenaQueue,id=event.data?.match_id;
    if(!q||q.matched||this.battle||this.draft||typeof id!=='string'||!id||Date.now()-q.started>150000)return;
    if(event.kind==='matched'&&(q.matchTicket||q.ticket)&&event.data.ticket!==(q.matchTicket||q.ticket))return;
    if(event.kind==='bot'&&q.type==='Random')return;
    q.matched=true;q.ticket=null;q.status='Opponent found';
    if(q.type==='Random'){
      this.draft={id,stage:'loading',pool:[],banned:[],submitted:{},started:Date.now(),updated:Date.now(),awaiting:false};
      await this.transport.join(id);this.transport.send(id,0,{});this.log('Random Arena draft joined.');
    }else{await this.join(id);this.log(ARENAS[q.type].name+' opponent found.');}
  }
  async draftTick(){
    const d=this.draft;
    if(Date.now()-d.updated>50000)throw new GameError('Random Arena draft timed out. Inspect the draft before reconnecting.',true);
    if(d.stage==='loading'&&!d.restartSent&&Date.now()-d.started>5000){d.restartSent=true;this.transport.send(d.id,9,{});return;}
    if(!['ban','pick'].includes(d.stage)||d.awaiting||d.submitted[d.stage])return;
    const count=d.stage==='ban'?6:4;
    await this.draftAction(d.stage,draftChoices(d.pool,d.stage==='pick'?d.banned:[],this.metadata,count),true);
  }
  async draftAction(kind,ids,automatic=false){
    const d=this.draft;
    if(!d||!this.transport?.connected||this.reconnecting)throw new Error('No connected Random Arena draft.');
    if(!automatic&&this.running)throw new Error('Pause automation before choosing a draft manually.');
    if(kind!==d.stage||!['ban','pick'].includes(kind)||d.awaiting||d.submitted[kind])throw new Error('Waiting for the next Random Arena stage.');
    const count=kind==='ban'?6:4;
    if(!Array.isArray(ids)||ids.length!==count||new Set(ids).size!==count||ids.some(id=>!Number.isInteger(id)||!d.pool.includes(id)||(kind==='pick'&&d.banned.includes(id))))throw new Error('Select exactly '+count+' available draft species.');
    d.awaiting=true;d.submitted[kind]=true;
    this.transport.send(d.id,kind==='ban'?2:3,{[kind==='ban'?'bans':'picks']:ids});
    this.log((automatic?'Auto':'Manual')+' Random Arena '+kind+': '+ids.map(id=>this.metadata.get(id)?.name||this.metadata.get(id)?.names?.[0]||id).join(', '));
  }
  async receiveDraft(id,opcode,data){
    const d=this.draft;if(!d||d.id!==id)return;d.updated=Date.now();
    if(opcode===1||opcode===9){
      const pool=opcode===9?data.pool:data;draftChoices(pool,[],this.metadata,6);
      if(d.pool.length&&JSON.stringify(d.pool)!==JSON.stringify(pool))throw new GameError('Random Arena draft pool changed unexpectedly.',true);
      d.pool=[...pool];if(d.stage==='loading')d.stage='ban';
      d.deadline=Date.now()+Math.max(0,40-Number(opcode===9?data.time||0:0))*1000;
    }else if(opcode===5){
      if(!Array.isArray(data)||data.some(id=>!d.pool.includes(id)))throw new GameError('Invalid Random Arena bans.',true);
      d.banned=[...new Set(data)];d.stage='pick';d.awaiting=Boolean(d.submitted.pick);d.deadline=Date.now()+40000;
    }else if(opcode===8){d.stage='preparing';d.awaiting=true;}
    else if(opcode===7){
      if(typeof data.matchId!=='string'||!data.matchId||data.matchId===id)throw new GameError('Random Arena returned an invalid battle ID.',true);
      d.stage='matched';await this.transport.leave(id);this.draft=null;await this.join(data.matchId);
    }else if(opcode===4){this.draft=null;await this.transport.leave(id);this.stop('Random Arena draft time limit reached.');}
    else if(opcode===-1)throw new GameError('Random Arena draft was rejected by the server.');
  }
  async combat() {
    const b=this.battle;
    if (b.joining || b.manual || b.finishing || b.awaitingAction || b.acted===b.serial) return;
    const families=b.type==='Wild' && this.config.mode==='capture_missing'?collectionFamilies(this.player):null;
    if(families)for(const family of b.keptFamilies||[])families.add(family);
    if(!['Wild','Campaign','Default','Platinum','Random'].includes(b.type)){this.stop('This battle type supports manual control only.');return;}
    const selectedPlan=this.config.trainSelected&&b.type==='Wild'?selectedTrainingPlan(this.player,this.config.replacementNames,this.catalog,this.metadata,this.collectionIndex):null;
    const trainOwned=Boolean(selectedPlan?.traineeIds.length);
    const kept=this.config.captureLowRatedTargets?b.keptFamilies:b.keptQualifyingFamilies;
    const upgrades=selectedPlan?new Set(this.catalog.species.filter(s=>selectedPlan.needsCapture.includes(s.name) && !kept?.includes(s.id)).map(s=>s.id)):null;
    const action=isArena(b.type)&&this.config.arenaStrategy==='smart'?arenaDecision(b,this.metadata,this.protocol):decision(b,this.config,this.catalog,{families,trainOwned,upgrades});
    if (!action) return;
    if (action.action==='manual') { b.manual=true; this.stop('Selected Miscrit found. Battle paused for manual play.'); return; }
    if (action.action==='stop') { this.stop(action.reason); return; }
    if(isArena(b.type)){b.strategyReason=action.reason||'Basic strategy: strongest available attack.';}
    await this.action(action.action,action.id,true);
  }
  async action(kind,id,automatic=false) {
    if(this.reconnecting || !this.transport?.connected)throw new Error('Wait for the game connection to recover.');
    const b=this.battle;
    if (!b || b.joining || b.winner) throw new Error('No active battle.');
    if (!automatic && this.running) throw new Error('Pause automation before manual play.');
    if (b.awaitingAction || b.acted===b.serial) throw new Error('Waiting for the server response.');
    if (kind==='keep') {
      if (!b.pending || !b.foe.miscrits[0].captured) throw new Error('No captured Miscrit to keep.');
      if (b.keepSent) throw new Error('Waiting for the capture confirmation.');
      b.keepSent=true; b.acted=b.serial; b.awaitingAction=true; b.actionSent=Date.now(); this.transport.send(b.id,11,{name:'',keep:true}); return;
    }
    if (b.nextTurn!==b.player.user_id || b.pending || b.player.miscrits[0].handicap) throw new Error('Wait for your turn.');
    const current=b.player.miscrits[0];
    const opcodes={ability:2,capture:10,flee:4,switch:1};
    if (!(kind in opcodes)) throw new Error('Unsupported battle action.');
    if (kind==='ability' && !current.abilities.some(a=>a.id===id && a.recharge===0 && a.remaining!==0)) throw new Error('Ability is unavailable.');
    if (kind==='switch' && (current.paralyzed || !b.player.miscrits.slice(1).some(m=>m.id===id && m.chp>0))) throw new Error('Cannot switch to that teammate.');
    if (kind==='capture' && (b.type!=='Wild' || b.foe.miscrits[0].attempts>0 || !(b.captureChance>0))) throw new Error('Free capture is unavailable. Paid retries are disabled.');
    b.acted=b.serial; b.awaitingAction=true; b.actionSent=Date.now();
    this.transport.send(b.id,opcodes[kind],['ability','switch'].includes(kind)?{id}:{});
    if(automatic&&kind==='switch'&&isArena(b.type))b.arenaSwitchedSinceAttack=true;
    if(kind==='capture')this.stats.captureAttempts++;
    if (kind==='ability') b.attacks++;
    this.log((automatic?'Auto: ':'Manual: ')+kind+(id!==undefined?' '+id:''));
  }
  async receive(id,opcode,data) {
    if(this.draft?.id===id){await this.receiveDraft(id,opcode,data);return;}
    const b=this.battle;
    if (!b || id!==b.id) return;
    b.updated=Date.now(); b.serial++;
    if(opcode===8 && b.joining && !b.player && !(data.actions?.length))return;
    if (opcode===0) {
      if (!data.player1?.miscrits?.length || !data.player2?.miscrits?.length) throw new GameError('Incomplete battle start.',true);
      b.type=data.type;b.pvp=Boolean(data.pvp); b.player=structuredClone(data.player1.user_id===this.player.user_id?data.player1:data.player2);
      if(!b.countedEncounter){this.stats.encounters++;b.countedEncounter=true;}
      b.foe=structuredClone(data.player1.user_id===this.player.user_id?data.player2:data.player1);
      if (b.player.user_id!==this.player.user_id) throw new GameError('Battle does not belong to the signed-in account.',true);
      for (const side of [b.player,b.foe]) for (const member of side.miscrits) {
        member.abilities=abilities(member,side,this.metadata,this.protocol,b.type==='Campaign'||b.pvp);
        member.turnStatuses={};member.arenaEffects={};
        const original=this.player.miscrits.find(m=>m.id===member.id);
        const enchanted=b.type==='Random'?member.abilities.map(a=>a.id):(original?.enchants||original?.en||[]);
        for (const ability of member.abilities) if ((side===b.player||b.type==='Random') && enchanted.includes(ability.id)) {
          ability.ap=Number(ability.ap||0)+Number(ability.enchant?.ap||0);
          if(isArena(b.type)){
            if(Number.isFinite(ability.enchant?.accuracy))ability.accuracy=(ability.accuracy??100)+ability.enchant.accuracy;
            if(Number.isFinite(ability.enchant?.turns))ability.turns=(ability.turns||0)+ability.enchant.turns;
            if(Array.isArray(ability.enchant?.additional))ability.additional=[...(ability.additional||[]),...structuredClone(ability.enchant.additional)];
          }
          ability.complexEnchant=Object.keys(ability.enchant||{}).some(key=>!['ap','accuracy','desc'].includes(key));
        }
        member.attempts ||=0;
      }
      for(const side of [b.player,b.foe]){
        if(isArena(b.type))for(const effect of Array.isArray(side.status)?side.status:[])if(effect.type){side.miscrits[0].arenaEffects[effect.type]=structuredClone(effect);if(effect.type==='Negate')side.miscrits[0].negated=true;}
        for(const effect of Array.isArray(side.status)?side.status:[])if(['Sleep','Confuse','Paralyze'].includes(effect.type))side.miscrits[0].turnStatuses[effect.type]=Number(effect.turns);
        this.statusFlags(side.miscrits[0]);
      }
      b.joining=false; b.pending=Boolean(data.pending);
      if (data.pending) b.foe.miscrits[0].captured=true;
      this.log('Encounter: '+b.foe.miscrits[0].name+' · '+b.type);
    } else {
      if (!b.player || !b.foe) throw new GameError('Battle update arrived before its start state.',true);
      const initiator=[b.player,b.foe].find(s=>s.user_id===data.user_id);
      if ((initiator===b.player && [1,2,3,4,5,6,7,10,11,13,14].includes(opcode)) || [4,9,12,14].includes(opcode)) b.awaitingAction=false;
      if ([1,2,3,4,5,6,7,10,11,13,14].includes(opcode) && !initiator && opcode!==4) throw new GameError('Unrecognized battle side.',true);
      if (opcode===1) this.switchTo(initiator,data.id,data.switches);
      if ([2,7,13].includes(opcode) && initiator) {
        const used=initiator.miscrits[0].abilities.find(a=>a.id===data.id);
        if(isArena(b.type)){
          const special=this.protocol.arena?.special_cooldowns?.[used?.type];
          const cooldown=opcode===13?(used?.nativeCooldown===-1?0:special?.[1]||0):(used?.nativeCooldown===-1?-1:special?.[0]??used?.nativeCooldown??0);
          if(used&&cooldown)used.recharge=cooldown;
          if(used?.remaining>0&&cooldown)used.remaining--;
          if(initiator===b.player)b.arenaSwitchedSinceAttack=false;
        }else{
          if (used && (opcode!==13 || used.nativeCooldown>0)) used.recharge=used.nativeCooldown;
          if (used?.remaining>0) used.remaining--;
        }
      }
      if (opcode===10) {
        const target=b.foe.miscrits[0]; target.captured=Boolean(data.captured); if (!data.captured) target.attempts++;
        if (data.captured) { b.pending=true; this.record('capture',`${target.name} captured`,target); }
      }
      if (opcode===11) {
        if (b.foe.miscrits[0].captured) {
          const member=b.foe.miscrits[0];b.countedKeeps ||= [];
          if(initiator===b.player&&!b.countedKeeps.includes(member.id)){
            const duplicate=this.player.miscrits.some(raw=>owned(raw,this.metadata).mId===member.mId)||(b.keptFamilies||[]).includes(member.mId);
            this.stats.captures++;if(duplicate)this.stats.duplicates++;
            if(member.rating>=17){this.stats.qualifiedCaptures++;this.notify('capture',`${member.name} captured and kept (${member.rating}/18).`);}
            b.countedKeeps.push(member.id);
          }
          const foe=b.foe.miscrits[0];b.keptFamilies ||= [];b.keptFamilies.push(foe.mId);
          if(foe.rating>=TRAINING_MIN_RATING){b.keptQualifyingFamilies ||= [];b.keptQualifyingFamilies.push(foe.mId);}
          if(initiator===b.player)this.removeCapturedTarget(foe);
        }
        b.pending=false;b.keepSent=false;
      }
      if (opcode===4 && data.success) { await this.finish('fled',data); return; }
      if (opcode===-1 || opcode===14 || opcode===15) throw new GameError(data.msg || 'Battle server rejected an action. Automation paused.');
      const arenaDamage={},arenaBattle=isArena(b.type);let arenaStateChanged=false;
      for (const action of data.actions || []) {
        if(action.type==='Special')continue; // Native client treats this as an informational effect.
        const supported=['Attack','Buff','Miss','Faint','ForceSwitch','Negate','Heal','Sleep','Confuse','Paralyze','Antiheal','Poison','Hot','Dot','AI','CI','SI','PI','Block','Barbed','Bleed','SwitchCurse','Ethereal','Disease','Bot','PoisonDamage','DotDamage','BleedDamage','SwitchCurseDamage','DiseaseDamage','BarbedDamage','BlockDamage','HotHeal','HotAntiheal','AntihealDamage','Immune','Woken','Cleanser','Purge','TimeBomb','TimeBombDamage','EtherealBlock'];
        if (!supported.includes(action.type)) throw new GameError('Unsupported battle effect: '+String(action.type)+'. Reconnect to restore server state.',true);
        const side=[b.player,b.foe].find(s=>s.user_id===action.target);
        if (!side) throw new GameError('Battle action has an unknown target.',true);
        const member=side.miscrits[0];
        if(arenaBattle){
          this.arenaEffect(member,action);
          if(['Buff','Negate','Purge','Cleanser','Bot','ForceSwitch','Faint'].includes(action.type))arenaStateChanged=true;
          if(action.type==='Attack'&&Number.isFinite(action.damage)&&action.damage>0&&initiator&&side!==initiator){const key=`${initiator.miscrits[0].id}:${member.id}:${data.id}`;arenaDamage[key]=(arenaDamage[key]||0)+action.damage;}
        }
        if (Number.isFinite(action.damage)) {
          member.chp=Math.max(0,Math.min(member.hp,member.chp-action.damage));
          if (opcode===2 && initiator===b.player && side===b.foe && action.type==='Attack') {
            const key=`${b.player.miscrits[0].id}:${member.id}:${data.id}`;
            b.damage[key]=Math.max(b.damage[key]||0,action.damage);
          }
        }
        if (['Heal','HotHeal'].includes(action.type)) member.chp=Math.max(0,Math.min(member.hp,member.chp+Number(action.ap||0)));
        if (action.type==='Faint') {
          if (!member.captured) member.chp=0;
          if (action.id===-1) b.winner=action.winner;
          else this.switchTo(side,action.id);
        }
        if (action.type==='ForceSwitch' && action.id!==-1) this.switchTo(side,action.id);
        if(['Sleep','Confuse','Paralyze'].includes(action.type)){
          member.turnStatuses[action.type]=Number(action.turns);this.statusFlags(member);
        }
        if(action.type==='Woken'){delete member.turnStatuses.Sleep;this.statusFlags(member);}
        if(action.type==='Cleanser'){
          if(arenaBattle){delete member.turnStatuses.Confuse;delete member.turnStatuses.Paralyze;}
          else member.turnStatuses={};
          this.statusFlags(member);
        }
        if (side===b.foe && ['Poison','Dot','TimeBomb','Bleed','Disease','Buff','Negate','Purge','Ethereal','Block'].includes(action.type)) b.damageRisk=true;
        if (side===b.player && ['Buff','Bot','Cleanser'].includes(action.type)) b.damageRisk=true;
      }
      if(arenaBattle){
        if(arenaStateChanged)b.arenaDamage={};
        else{b.arenaDamage||={};for(const [key,value]of Object.entries(arenaDamage))b.arenaDamage[key]=Math.min(b.arenaDamage[key]??Infinity,value);}
        if(initiator&&!([1,6,14].includes(opcode)))initiator.switches=0;
        if(data.turns===0)for(const side of [b.player,b.foe])for(const effect of Object.values(side.miscrits[0].arenaEffects||{}))if(['CI','SI','PI','AI','Antiheal','Bot','Ethereal'].includes(effect.type)&&effect.turns>0)effect.turns--;
      }
      if (data.turns===0 && !data.captured) for (const member of b.player.miscrits) for (const ability of member.abilities) if (ability.recharge>0) ability.recharge--;
      if(initiator){
        const member=initiator.miscrits[0];
        for(const type of Object.keys(member.turnStatuses))if(member.turnStatuses[type]>0)member.turnStatuses[type]--;
        this.statusFlags(member);
        if(arenaBattle)for(const type of ['Sleep','Confuse','Paralyze'])if(member.arenaEffects?.[type])member.arenaEffects[type].turns=member.turnStatuses[type]||0;
      }
      if (opcode===12) b.winner=data.loser===b.player.user_id?b.foe.user_id:b.player.user_id;
      if (opcode===9 || opcode===12) { await this.finish('ended',data); return; }
    }
    if (data.next_turn) b.nextTurn=data.next_turn;
    if ('capture_chance' in data) b.captureChance=Number(data.capture_chance);
    if ('pending' in data) b.pending=Boolean(data.pending);
    if(this.running && b.type==='Wild' && this.config.mode==='manual_target' && targetMatches(this.config,b.foe.miscrits[0],this.catalog)) {
      b.manual=true;this.stop('Selected Miscrit found. Battle paused for manual play.');
    }
    // READY advances the authoritative battle even while the human controls combat.
    if (opcode!==8) this.transport.send(b.id,8,{});
    if (b.pending && b.foe.miscrits[0].captured && this.running && !b.keepSent && !b.awaitingAction) await this.action('keep',undefined,true);
  }
  switchTo(side,id,switches=0) {
    if (!side) throw new GameError('Missing switch side.',true);
    const index=side.miscrits.findIndex(m=>m.id===id);
    if (index<0) throw new GameError('Server switch references an unknown teammate.',true);
    if (switches>3) side.miscrits[0].chp=Math.max(0,side.miscrits[0].chp-(15+(switches-4)*5));
    for (const a of side.miscrits[0].abilities) if (a.recharge>0) a.recharge=0;
    const previous=side.miscrits[0];previous.negated=false;previous.arenaEffects={};
    side.switches=switches;
    const [member]=side.miscrits.splice(index,1); side.miscrits.unshift(member);member.turnStatuses={};member.arenaEffects={};member.negated=false;this.statusFlags(member);
    if(side===this.battle?.foe){this.battle.attacks=0;this.battle.damageRisk=false;}
  }
  arenaEffect(member,action){
    member.arenaEffects||={};
    const type=({PoisonDamage:'Poison',DotDamage:'Dot',BleedDamage:'Bleed',DiseaseDamage:'Disease',HotHeal:'Hot',BlockDamage:'Block'})[action.type]||action.type;
    if(['Negate','Poison','Dot','Bleed','Disease','Antiheal','Paralyze','Sleep','Confuse','CI','SI','PI','AI','Hot','Block','Ethereal','Barbed','SwitchCurse'].includes(type)){
      member.arenaEffects[type]={...action,type};
      if(type==='Negate')member.negated=true;
      if(action.immunity>0){const immune={Sleep:'SI',Confuse:'CI',Paralyze:'PI',Antiheal:'AI'}[type];if(immune)member.arenaEffects[immune]={type:immune,turns:action.immunity};}
    }
    if(type==='Cleanser')for(const effect of ['Poison','Dot','Bleed','Disease','Antiheal','Paralyze','Confuse','SwitchCurse'])delete member.arenaEffects[effect];
    if(type==='Purge'){for(const effect of ['Negate','Hot','Block','Ethereal','Barbed','CI','SI','PI','AI'])delete member.arenaEffects[effect];member.negated=false;}
    if(type==='Woken')delete member.arenaEffects.Sleep;
  }
  statusFlags(member){
    member.turnStatuses ||= {};
    for(const type of Object.keys(member.turnStatuses))if(member.turnStatuses[type]===0)delete member.turnStatuses[type];
    if(member.turnStatuses.Sleep && member.turnStatuses.Confuse)delete member.turnStatuses.Sleep;
    member.handicap=Boolean(member.turnStatuses.Sleep||member.turnStatuses.Confuse);
    member.paralyzed=Boolean(member.turnStatuses.Paralyze);
  }
  record(kind,message,details={}) {
    this.history.unshift({time:new Date().toISOString(),kind,message,name:details.name,rating:details.rating});
    this.history.length=Math.min(this.history.length,2000); this.saveHistory(this.history);
  }
  removeCapturedTarget(foe) {
    if(!this.config.autoRemoveCapturedTargets)return;
    const entry=this.catalog.species.find(s=>s.id===foe.mId);
    if(!entry || !this.config.names.includes(entry.name))return;
    const next={...this.config,names:this.config.names.filter(name=>name!==entry.name),primaryTarget:this.config.primaryTarget===entry.name?'':this.config.primaryTarget};
    try {this.save(next);this.config=next;this.cursor=0;this.log(`${entry.name} kept and removed from hunt targets.${next.replacementNames.includes(entry.name)?' Separate training selection is unchanged.':''}`);}
    catch {this.stop('Capture kept, but saving target removal failed. Check your hunt settings before restarting.');}
  }
  async finish(reason,data) {
    const b=this.battle;
    if(!b||b.finishing)return;b.finishing=true;
    const won=b.winner===this.player.user_id;
    if(reason==='fled')this.stats.fled++;else if(won)this.stats.battlesWon++;
    const updates=data?.[this.player.user_id]?.updates;
    if(updates&&typeof updates==='object'&&!Array.isArray(updates))for(const member of b.player?.miscrits||[]){const xp=updates[String(member.id)];if(Number.isFinite(xp)&&xp>=0)this.stats.xpAwarded+=xp;}
    this.record('battle',`${b.type}: ${reason==='fled'?'fled':won?'victory':'defeat / finished'}`);
    if (b.type==='Campaign') {
      if (won) { this.wins++; this.lastProgress=this.stageBefore??null; }
      else this.stop('Campaign stopped after a defeat or incomplete battle.');
    }
    if(isArena(b.type)){
      this.arenaRun.type ||= b.type;this.arenaRun.battles++;
      if(won)this.arenaRun.wins++;else this.arenaRun.losses++;
      if(!won&&this.config.arenaStopOnLoss)this.stop('Arena stopped after a defeat. Check your team before continuing.');
      else if(this.arenaRun.battles>=this.config.arenaBattleLimit)this.stop('Arena battle limit reached.');
      try{await this.loadArenaInfo(b.type);}catch(error){const previous=this.arenaRecords[b.type]||{type:b.type,name:ARENAS[b.type].name};this.arenaRecords[b.type]={...previous,error:'Arena totals could not refresh. Use Refresh totals when idle.'};}
    }
    this.battle=null; await this.transport.leave(b.id); await this.refresh();
    this.log(reason==='fled'?'Returned from encounter.':won?'Battle won.':'Battle finished.');
  }
  snapshot() {
    const p=this.player;
    const roster=p ? p.miscrits.map(m=>({...owned(m,this.metadata),...trainingStatus(m,this.protocol),...teamVitals(m,this.metadata.get(Number(m.v===2?m.m:m.mId)))})) : [];
    let selectedTraining=null;
    if(p && this.config.trainSelected){try{selectedTraining=selectedTrainingPlan(p,this.config.replacementNames,this.catalog,this.metadata,this.collectionIndex);}catch(error){selectedTraining={error:error.message};}}
    let queue;try{queue=targetQueue({config:this.config,player:p,catalog:this.catalog,metadata:this.metadata,index:this.collectionIndex,cooldowns:this.cooldowns,cursor:this.cursor,currentSearch:this.currentSearch,battle:this.battle});}catch(error){queue={targets:[],current:null,next:null,message:error.message};}
    return {connected:Boolean(p && this.transport?.connected && !this.requiresLogin),reconnecting:this.reconnecting,requiresLogin:this.requiresLogin,connection:this.transport?.diagnostics?.()||{},busy:this.busy,running:this.running,uncertain:this.uncertain,status:this.status,selectedTraining,
      queue,lastStop:this.lastStop,sessionStats:this.stats.snapshot(),wildHealingSpent:this.wildHealingSpent,alerts:this.alerts,profiles:this.profiles.map(p=>({name:p.name})),
      config:this.config,wins:this.wins,events:this.events,history:this.history,collectionIndex:this.collectionIndex,huntAccessVersion:2,teamManagementVersion:1,huntAvailability:huntAvailability(p,this.catalog),
      arena:{records:this.arenaRecords,queue:this.arenaQueue?{type:this.arenaQueue.type,status:this.arenaQueue.status,searching:!this.arenaQueue.cancelled&&!this.arenaQueue.matched,elapsedSeconds:Math.floor((Date.now()-this.arenaQueue.started)/1000)}:null,run:this.arenaRun},draft:this.draft?structuredClone(this.draft):null,
      player:p?{username:p.username,name:p.display_name||p.username,level:p.level,virtue:p.virtue,gold:p.gold,platinum:p.platinum,area:p.area,team:p.team_order.map(id=>roster.find(m=>m.id===id)).filter(Boolean),roster}:null,
      battle:this.battle ? structuredClone(this.battle) : null};
  }
}
