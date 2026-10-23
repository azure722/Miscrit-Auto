import http from 'node:http';
import {readFileSync,writeFileSync,renameSync,existsSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Engine} from './lib/engine.mjs';
import {DEFAULTS} from './lib/model.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const readJSON=(name,fallback)=>{try{return JSON.parse(readFileSync(name,'utf8'));}catch{return fallback;}};
const atomic=(name,value)=>{writeFileSync(name+'.tmp',JSON.stringify(value,null,2));renameSync(name+'.tmp',name);};
export async function createApp({port=4318,fetchData=true,engine:provided}={}) {
  const dataDir=path.join(here,'data'); mkdirSync(dataDir,{recursive:true});
  const catalog=readJSON(path.join(here,'../Auto-Capture-Game-Installer/source/capture_catalog.json'),null);
  if (!catalog) throw new Error('Keep Miscrits-Web beside Auto-Capture-Game-Installer so it can load the mapping catalog.');
  const protocol=readJSON(path.join(dataDir,'protocol.json'),null);
  if (!protocol) throw new Error('Missing data/protocol.json.');
  protocol.arena=readJSON(path.join(dataDir,'arena-protocol.json'),null);
  const configPath=path.join(dataDir,'settings.json'),historyPath=path.join(dataDir,'history.json'),profilesPath=path.join(dataDir,'profiles.json');
  let config=readJSON(configPath,null);
  if (!config) {
    // Import preferences once; the native configuration is never written by this app.
    const old=readJSON(path.join(here,'../Auto-Capture-Game-Installer/Auto Capture Support/capture-config.json'),{});
    const canonical=list=>(list||[]).map(name=>catalog.species.find(s=>s.name.toLowerCase()===String(name).toLowerCase())?.name).filter(Boolean);
    config={...DEFAULTS,mode:old.combat_mode||old.mode||DEFAULTS.mode,names:canonical(old.miscrits),minRating:old.min_rating||0,
      captureThreshold:old.capture_threshold||70,fleeUnwanted:old.flee_unwanted??true,autoReplace:old.auto_replace_max_level??false,replacementNames:canonical(old.replacement_names)};
    if (!['fight','capture_any','capture_targeted','capture_rated','manual_target'].includes(config.mode)) config.mode=DEFAULTS.mode;
  }
  const engine=provided||new Engine({catalog,protocol,config,manualTeamManagement:true,save:next=>atomic(configPath,next),history:readJSON(historyPath,[]),saveHistory:items=>atomic(historyPath,items),profiles:readJSON(profilesPath,[]),saveProfiles:items=>atomic(profilesPath,items)});
  let dataStatus='Loading official abilities…';
  const loadData=async()=>{
    try {
      const response=await fetch('https://cdn.worldofmiscrits.com/miscrits.json',{signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error();
      const feed=await response.json();
      if (!Array.isArray(feed) || feed.length<100 || !feed[0].ability_order) throw new Error();
      engine.metadata=new Map(feed.map(s=>[s.id,s])); dataStatus='Official game data loaded';
      for (const entry of catalog.species) {
        const latest=engine.metadata.get(entry.id);
        if (latest) {entry.locations=latest.locations;entry.names=latest.names;entry.rarity=latest.rarity;}
      }
    } catch { dataStatus='Official ability data unavailable. Reopen this app to retry; login is disabled.'; }
  };
  const csrf=randomBytes(32).toString('hex');
  let ownerCookie=null;
  const safeEqual=(a,b)=>{if(typeof a!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/mark.svg':'mark.svg'};
  const server=http.createServer(async(req,res)=>{
    const expected=`127.0.0.1:${server.address().port}`;
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' https://cdn.worldofmiscrits.com; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (req.headers.host!==expected || (req.headers.origin && req.headers.origin!==`http://${expected}`)) {json(res,403,{error:'Local access only.'});return;}
    const url=new URL(req.url,`http://${expected}`);
    if (url.pathname==='/api/health' && req.method==='GET') {json(res,200,{app:'miscrits-browser',version:17,needsGame:false,connected:Boolean(engine.player&&engine.transport?.connected),reconnecting:Boolean(engine.reconnecting),running:Boolean(engine.running),busy:Boolean(engine.busy),activeBattle:Boolean(engine.battle)});return;}
    if (url.pathname==='/api/bootstrap' && req.method==='GET') {
      const cookie=req.headers.cookie?.split('; ').find(c=>c.startsWith('mc_owner='))?.slice(9);
      if (ownerCookie && !safeEqual(cookie,ownerCookie)) {json(res,403,{code:'BROWSER_OWNER_CONFLICT',error:'This website is connected to another browser or browser profile. Use the original window. To switch browsers, finish any battle, then run Stop Miscrits Website.cmd and Launch Miscrits Website.cmd.'});return;}
      if (!ownerCookie) ownerCookie=randomBytes(32).toString('hex');
      // Keep the same browser able to reopen while background automation continues.
      res.setHeader('Set-Cookie',`mc_owner=${ownerCookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
      json(res,200,{csrf,catalog:catalog.species.map(s=>({id:s.id,name:s.name,names:s.names,rarity:s.rarity,mapping_status:s.mapping_status,stops:s.stops.map(t=>({location:t.location,area_id:t.area_id,object_id:t.object_id,days:t.days}))})),dataStatus});return;
    }
    if (url.pathname.startsWith('/api/')) {
      const cookie=req.headers.cookie?.split('; ').find(c=>c.startsWith('mc_owner='))?.slice(9);
      if (!ownerCookie || !safeEqual(cookie,ownerCookie) || !safeEqual(req.headers['x-miscrits-csrf'],csrf)) {json(res,403,{code:'BROWSER_SESSION_STALE',error:'The local browser session needs to reconnect. Refresh this page and try again.'});return;}
      if (req.method==='GET' && url.pathname==='/api/state') {json(res,200,{...engine.snapshot(),dataStatus});return;}
      if (req.method!=='POST' || !String(req.headers['content-type']).startsWith('application/json')) {json(res,405,{error:'Unsupported request.'});return;}
      try {
        let length=0,body='';
        for await (const chunk of req) {length+=chunk.length;if(length>32768) throw new Error('Request too large.');body+=chunk;}
        const input=JSON.parse(body||'{}');
        switch(url.pathname) {
          case '/api/login':
            if (fetchData && dataStatus!=='Official game data loaded') throw new Error(dataStatus);
            await engine.login(input.identity,input.password); break;
          case '/api/logout': await engine.logout(); break;
          case '/api/reconnect': await engine.reconnect(); break;
          case '/api/settings': engine.updateConfig(input); break;
          case '/api/team/settings': engine.updateTeamSettings(input); break;
          case '/api/team/swap': await engine.swapTeam(input); break;
          case '/api/start': engine.start(); break;
          case '/api/pause': engine.stop();await engine.arenaCancelPromise; break;
          case '/api/arena/draft':if(engine.busy)throw new Error('Wait for the pending request.');await engine.draftAction(input.kind,input.ids);break;
          case '/api/arena/stats':await engine.refreshArenaTotals(input.type);break;
          case '/api/profiles/save':engine.saveProfile(input.name,input.config);break;
          case '/api/profiles/load':engine.loadProfile(input.name);break;
          case '/api/profiles/delete':engine.deleteProfile(input.name);break;
          case '/api/stats/reset':engine.resetStats();break;
          case '/api/action':
            if (engine.busy) throw new Error('Wait for the pending request.');
            await engine.action(input.kind,input.id); break;
          default: json(res,404,{error:'Unknown endpoint.'});return;
        }
        json(res,200,{ok:true});
      } catch(error) {json(res,400,{error:error.message||'Request failed.'});}
      return;
    }
    if (req.method!=='GET' || !files[url.pathname]) {res.writeHead(404);res.end('Not found');return;}
    try {
      const file=files[url.pathname];
      const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml'};
      res.writeHead(200,{'Content-Type':types[file.split('.').at(-1)],'Cache-Control':'no-cache'});
      res.end(readFileSync(path.join(here,'dist',file)));
    } catch {res.writeHead(500);res.end('Missing website file.');}
  });
  server.requestTimeout=30000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const timer=setInterval(()=>engine.tick().catch(error=>engine.fail(error)),1200); timer.unref();
  if (fetchData) void loadData(); else dataStatus='Test data';
  return {server,engine,close:async()=>{clearInterval(timer);engine.stop();engine.transport?.close();await new Promise(resolve=>server.close(resolve));}};
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=await createApp({port:Number(process.env.MISCRITS_WEB_PORT||4318)});
  console.log(`Miscrits Browser: http://127.0.0.1:${app.server.address().port}`);
  console.log('No Miscrits.exe required. Keep this backend running. Ctrl+C stops it.');
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{app.close().finally(()=>process.exit(0));});
}
