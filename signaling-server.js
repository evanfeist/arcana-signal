// signaling-server.js — Minimal WebRTC signaling relay (WS)
// Deploy to any host that supports WebSockets over HTTPS/WSS.
// Run locally: node signaling-server.js  (PORT=8080 default)

const { createServer } = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const server = createServer((req, res) => {
  res.writeHead(200, {'Content-Type':'text/plain'});
  res.end('Arcana signaling server is running.\n');
});
const wss = new WebSocketServer({ server });

// Registry: hostId -> { ws: hostWS, guest: guestWS|null }
const hosts = new Map();

function send(ws, obj){ try{ ws && ws.readyState===1 && ws.send(JSON.stringify(obj)); }catch{} }
function relay(hostId, sender, obj){
  const entry = hosts.get(hostId); if(!entry) return;
  const other = (sender===entry.ws) ? entry.guest : entry.ws;
  if (other) send(other, obj);
}

wss.on('connection', (ws, req) => {
  ws._role = null;
  ws._hostId = null;
  ws._alive = true;
  ws.on('pong', () => ws._alive = true);

  ws.on('message', (raw) => {
    let msg={}; try{ msg = JSON.parse(String(raw)); }catch{ return; }

    if (msg.type === 'host') {
      const { hostId } = msg;
      if (!hostId) return send(ws, { type:'host-error', reason:'no-hostId' });
      const prev = hosts.get(hostId);
      if (prev && prev.ws !== ws) {
        try{ prev.ws.close(); }catch{}; try{ prev.guest?.close(); }catch{};
      }
      hosts.set(hostId, { ws, guest:null });
      ws._role='host'; ws._hostId=hostId;
      return send(ws, { type:'host-ok', hostId });
    }

    if (msg.type === 'join') {
      const { hostId } = msg;
      const entry = hosts.get(hostId);
      if (!entry || entry.ws.readyState !== 1) {
        return send(ws, { type:'join-error', reason:'host-not-found' });
      }
      if (entry.guest && entry.guest !== ws) {
        try{ entry.guest.close(); }catch{};
      }
      entry.guest = ws; ws._role='guest'; ws._hostId=hostId;
      send(ws, { type:'join-ok', hostId });
      return send(entry.ws, { type:'guest-joined', hostId });
    }

    if (msg.type === 'signal' && msg.hostId && msg.payload) {
      return relay(msg.hostId, ws, { type:'signal', hostId:msg.hostId, payload:msg.payload });
    }
  });

  ws.on('close', () => {
    const hostId = ws._hostId; const role = ws._role;
    if (!hostId) return;
    const entry = hosts.get(hostId); if (!entry) return;

    if (role === 'host') {
      if (entry.guest) send(entry.guest, { type:'host-left', hostId });
      hosts.delete(hostId);
    } else if (role === 'guest') {
      if (entry.guest === ws) entry.guest = null;
      if (entry.ws && entry.ws.readyState === 1) send(entry.ws, { type:'guest-left', hostId });
    }
  });
});

// Heartbeat (keep-alive / dead connection cleanup)
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws._alive) { try{ ws.terminate(); }catch{}; return; }
    ws._alive = false;
    try{ ws.ping(); }catch{}
  });
}, 30000);

server.listen(PORT, () => {
  console.log(`Signaling on :${PORT}`);
});