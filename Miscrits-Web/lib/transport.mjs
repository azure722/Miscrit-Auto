import WebSocket from '../vendor/ws/wrapper.mjs';
export class GameWebSocket extends WebSocket {
  constructor(url) {super(url,{perMessageDeflate:false,headers:{'User-Agent':'GodotEngine/4.6 (Windows)'}});}
}
// Native 2.23.0 uses Nakama JSON sockets and the official public client key.
const API = 'https://worldofmiscrits.com';
const KEY = 'a1c737cc188f54ab3658ba5da0e12ee5';
export class GameError extends Error {
  constructor(message, uncertain = false) { super(message); this.uncertain = uncertain; }
}
function safeReason(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\x00-\x1f]/g,' ').replace(/\b(?:Bearer|Basic)\s+\S+/gi,'[redacted]')
    .replace(/\beyJ[\w-]*\.[\w-]+\.[\w-]+\b/g,'[redacted]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi,'[redacted]')
    .replace(/\b(?:password|token|refresh_token|authorization)\b\s*[=:]\s*\S+/gi,'[redacted]').slice(0,240).trim();
}
export function unwrap(response, rpcId = '') {
  let value;
  try { value = typeof response === 'string' ? JSON.parse(response) : response; }
  catch { throw new GameError('Unreadable game response. Check server state before retrying.',true); }
  if (!value || typeof value.success !== 'boolean') throw new GameError('Incomplete game response. Check server state before retrying.',true);
  let data;
  try { data = typeof value.data === 'string' ? JSON.parse(value.data || '{}') : value.data ?? {}; }
  catch { throw new GameError('Unreadable game result. Check server state before retrying.',true); }
  if (value.success !== true) {
    const flags=Object.fromEntries(['cooldown','disabled','limit','drop'].map(key=>[key,Boolean(data?.[key])]));
    const reason=safeReason(data?.message || data?.msg || data?.reason || data?.error?.message || data?.error || value.message || value.error?.message || value.error);
    const known=flags.disabled?'Search object is disabled.':flags.limit?'The game server reported a daily search limit.':flags.cooldown?'Search object is cooling down.':flags.drop?'Search returned an item drop instead of an encounter.':'';
    const error=new GameError(`${known || 'The game server rejected the request.'}${rpcId?' ['+rpcId+']':''}${reason?' '+reason:!known?' No reason was supplied.':''}`);
    error.rejected=true;error.rpcId=rpcId;error.searchOutcome=flags;
    throw error;
  }
  return data;
}
export class Transport {
  constructor(onState, onClose, fetcher = fetch, Socket = GameWebSocket) {
    Object.assign(this, { onState, onClose, fetcher, Socket });
    this.pending = new Map(); this.counter = 0; this.session = null; this.socket = null;
    this.intentional=false; this.lastCloseCode=null; this.heartbeatsSent=0; this.heartbeatsAcknowledged=0;
  }
  async http(path, body, basic = false) {
    let response;
    try {
      response = await this.fetcher(API + path, {
        method: 'POST', signal: AbortSignal.timeout(25000),
        headers: { 'Content-Type': 'application/json', 'Accept':'application/json', 'User-Agent':'GodotEngine/4.6 (Windows)', 'Authorization': basic ? 'Basic ' + Buffer.from(KEY + ':').toString('base64') : 'Bearer ' + this.session.token },
        body: JSON.stringify(body)
      });
    } catch { throw new GameError('Cannot reach the game server. No request was retried.', true); }
    if (!response.ok) {
      const message = response.status === 401 ? 'Login or session rejected. Check your credentials and sign in again.' : `Game server returned HTTP ${response.status}.`;
      const error=new GameError(message, response.status >= 500);
      error.requiresLogin=[400,401,403].includes(response.status); throw error;
    }
    try { return await response.json(); } catch { throw new GameError('Game server returned an unreadable response.', true); }
  }
  async login(identity, password) {
    this.intentional=false;
    const email = identity.includes('@') ? identity : '';
    const query = new URLSearchParams({ create: 'false' });
    if (!email) query.set('username', identity);
    this.session = await this.http('/v2/account/authenticate/email?' + query, { email, password }, true);
    if (!this.session.token) throw new GameError('The game did not return a session.');
    await this.connect(await this.socketURL());
  }
  async socketURL() {
    const cacheResponse = await this.fetcher('https://cdn.worldofmiscrits.com/cache.json', { signal: AbortSignal.timeout(15000) });
    if (!cacheResponse.ok) throw new GameError('Cannot load the official server address.');
    const cache = await cacheResponse.json();
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(cache.server)) throw new GameError('The official server address has an unsupported format.');
    // Same socket destination/scheme as the native Nakama.create_socket(host, 7350).
    if (!this.session || this.intentional) throw new GameError('Connection cancelled.');
    return `ws://${cache.server}:7350/ws?${new URLSearchParams({lang:'en', status:'true', token:this.session.token, format:'json'})}`;
  }
  async refreshSession(force=false) {
    const original=this.session;
    if (!original || this.intentional) throw new GameError('Sign in to reconnect.');
    let expires=Infinity;
    try {expires=JSON.parse(Buffer.from(original.token.split('.')[1],'base64url')).exp*1000;}catch{}
    if (!force && expires>Date.now()+90000) return;
    if (!original.refresh_token) {
      if (expires<=Date.now()+90000) {const error=new GameError('Session expired. Sign in again.');error.requiresLogin=true;throw error;}
      return;
    }
    const refreshed=await this.http('/v2/account/session/refresh',{token:original.refresh_token},true);
    if (!refreshed.token) throw new GameError('The game did not refresh the session.');
    if (this.intentional || this.session!==original) throw new GameError('Connection cancelled.');
    this.session={...original,...refreshed};
  }
  reconnect() {
    if (this.reconnectTask) return this.reconnectTask;
    this.reconnectTask=(async()=>{
      let failure;
      for (const delay of [0,1000,3000]) {
        if (delay) await new Promise(resolve=>setTimeout(resolve,delay));
        if (!this.session || this.intentional) throw new GameError('Sign in to reconnect.');
        try {
          await this.refreshSession(true);
          if (this.connected) return;
          await this.connect(await this.socketURL()); return;
        } catch(error) {failure=error;if(error.requiresLogin || this.intentional) break;}
      }
      throw failure||new GameError('Cannot reconnect to the game service.');
    })().finally(()=>{this.reconnectTask=null;});
    return this.reconnectTask;
  }
  connect(url) {
    clearTimeout(this.heartbeat);
    return new Promise((resolve, reject) => {
      const previous=this.socket;
      const ws = this.socket = new this.Socket(url);
      if(previous && previous!==ws)previous.close();
      ws.on?.('pong',()=>{if(this.socket===ws){this.heartbeatsAcknowledged++;this.waitingPong=false;}});
      let opened=false;
      const timer = setTimeout(() => { ws.close(); reject(new GameError('Game connection timed out.')); }, 20000);
      ws.addEventListener('open', () => {
        if (this.socket!==ws || this.intentional) {ws.close();reject(new GameError('Connection cancelled.'));return;}
        opened=true;
        this.waitingPong=false;
        clearTimeout(timer);
        resolve(); this.keepAlive(ws);
      });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new GameError('Cannot connect to the game battle server.')); });
      ws.addEventListener('message', event => {
        if (this.socket!==ws) return;
        try { this.receive(JSON.parse(event.data)); }
        catch { this.onClose('Unreadable game message; automation stopped.'); ws.close(); }
      });
      ws.addEventListener('close', event => {
        clearTimeout(timer);
        if (!opened) reject(new GameError('Game connection closed before login completed.'));
        if (this.socket!==ws) return;
        clearTimeout(this.heartbeat); this.lastCloseCode=Number(event.code)||1006;
        let uncertain=false;
        for (const item of this.pending.values()) { uncertain ||= item.mutation;clearTimeout(item.timer);item.reject(new GameError('Game connection closed while awaiting a response.',item.mutation)); }
        this.pending.clear();
        if (!this.intentional) this.onClose(`Game connection closed (code ${this.lastCloseCode}).`,{code:this.lastCloseCode,uncertain});
      });
    });
  }
  keepAlive(ws) {
    if (this.socket!==ws || !this.connected || this.intentional) return;
    try {
      // Match the native client: use RFC 6455 control frames, never JSON ping RPCs.
      if(this.waitingPong){ws.terminate?.();if(this.socket===ws)ws.close();return;}
      if(typeof ws.ping!=='function')return;
      this.heartbeatsSent++;this.waitingPong=true;
      ws.ping();
    } catch {
      if (this.socket===ws && !this.intentional) ws.close();
      return;
    }
    if (this.socket===ws && !this.intentional) {this.heartbeat=setTimeout(()=>this.keepAlive(ws),10000);this.heartbeat.unref?.();}
  }
  get connected() { return this.socket?.readyState === 1; }
  receive(message) {
    if (message.cid && this.pending.has(message.cid)) {
      const item = this.pending.get(message.cid); this.pending.delete(message.cid); clearTimeout(item.timer);
      if (message.error) item.reject(new GameError('Game request rejected: ' + (safeReason(message.error.message) || Number(message.error.code) || 'no reason supplied')));
      else item.resolve(message);
    }
    if (message.match_data) {
      const match = message.match_data;
      const data = JSON.parse(Buffer.from(match.data || '', 'base64').toString('utf8'));
      // Nakama omits protobuf's default zero value on START frames.
      this.onState(match.match_id, Number(match.op_code ?? 0), data);
    }
    if(message.matchmaker_matched)this.onArena?.({kind:'matched',data:message.matchmaker_matched});
    for(const notification of message.notifications?.notifications||[]){
      if(Number(notification.code)!==42)continue;
      let data;try{data=typeof notification.content==='string'?JSON.parse(notification.content):notification.content;}catch{continue;}
      if(typeof data?.matchId==='string')this.onArena?.({kind:'bot',data:{match_id:data.matchId}});
    }
    if (message.error && !message.cid) this.onClose('The game reported a connection error.');
  }
  request(payload,timeoutMs=25000) {
    if (!this.connected) return Promise.reject(new GameError('The game is disconnected.'));
    return new Promise((resolve, reject) => {
      const cid = String(++this.counter);
      const mutation=Boolean((payload.rpc && !payload.rpc.id.startsWith('get_'))||payload.matchmaker_add||payload.matchmaker_remove);
      const timer = setTimeout(() => { this.pending.delete(cid); reject(new GameError('Game request timed out. Check state before retrying.', mutation)); }, timeoutMs);
      this.pending.set(cid, {resolve, reject, timer,mutation});
      try { this.socket.send(JSON.stringify({cid, ...payload})); }
      catch { clearTimeout(timer); this.pending.delete(cid); reject(new GameError('Unable to send the game request.', true)); }
    });
  }
  async rpc(id, payload = {}) {
    try {
      const result = await this.request({rpc:{id, payload:JSON.stringify(payload)}});
      return unwrap(result.rpc?.payload,id);
    } catch(error) {
      if (!error.rpcId) {error.rpcId=id;error.message+=` [${id}]`;}
      throw error;
    }
  }
  async join(id) { await this.request({match_join:{match_id:id}}); }
  async addArena(type){const result=await this.request({matchmaker_add:{query:'*',min_count:2,max_count:2,string_properties:{type}}});if(typeof result.matchmaker_ticket?.ticket!=='string')throw new GameError('Arena queue returned no ticket. Check server state before retrying.',true);return result.matchmaker_ticket.ticket;}
  async removeArena(ticket){await this.request({matchmaker_remove:{ticket}});}
  async leave(id) { await this.request({match_leave:{match_id:id}}); }
  send(id, opcode, data = {}) {
    if (!this.connected) throw new GameError('The game is disconnected.');
    this.socket.send(JSON.stringify({match_data_send:{match_id:id, op_code:opcode, data:Buffer.from(JSON.stringify(data)).toString('base64')}}));
  }
  diagnostics() {return {lastCloseCode:this.lastCloseCode,heartbeatsSent:this.heartbeatsSent,heartbeatsAcknowledged:this.heartbeatsAcknowledged};}
  close() {
    this.intentional=true;clearTimeout(this.heartbeat);
    const ws=this.socket;this.socket=null;this.session=null;
    for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new GameError('Signed out.',item.mutation));}this.pending.clear();
    ws?.close();
  }
}
