import Peer, { type DataConnection } from 'peerjs';
import { clamp, NET_LEAD, PAINT_COLORS, UNDERGLOW_COLORS, type DiffKey, DIFFS } from '../core/config';
import { CAR_SPECS, type CarId } from '../cars/carSpecs';
import { TRACKS, type TrackId } from '../tracks/trackData';

const RELAY_URLS = [
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
];
const NET_PREFIX = 'apexnext-v2-';
const MAX_PLAYERS = 8;
const LINK_TIMEOUT = 12000;

export interface PlayerProfile {
  name: string;
  type: CarId;
  color: string;
  underglow: string;
}

export interface LobbyPlayer extends PlayerProfile {
  id: string;
  host: boolean;
  relay?: boolean;
}

export interface GridEntry extends PlayerProfile {
  id: string;
  ai: boolean;
  skill: number;
}

export interface RaceStartConfig {
  trackId: TrackId;
  laps: number;
  difficulty: DiffKey;
  grid: GridEntry[];
}

export function cleanProfile(p: Partial<PlayerProfile> | null | undefined, fallbackName = 'Driver'): PlayerProfile {
  const obj = p && typeof p === 'object' ? p : {};
  const name = String(obj.name ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 14);
  const type = obj.type && CAR_SPECS[obj.type as CarId] ? (obj.type as CarId) : 'r34';
  const color = typeof obj.color === 'string' && /^#[0-9a-f]{6}$/i.test(obj.color) ? obj.color : PAINT_COLORS[0].hex;
  const underglow =
    obj.underglow === 'off' || (typeof obj.underglow === 'string' && /^#[0-9a-f]{6}$/i.test(obj.underglow))
      ? obj.underglow
      : UNDERGLOW_COLORS[0].hex;
  return { name: name || fallbackName, type, color, underglow };
}

class MiniMqtt {
  private url: string;
  private onMsg: (topic: string, text: string) => void;
  private onClose?: () => void;
  private buf = new Uint8Array(0);
  ok = false;
  private pid = 1;
  private ws: WebSocket | null = null;
  private ping: ReturnType<typeof setInterval> | undefined;
  private _res: (() => void) | null = null;

  constructor(url: string, onMsg: (topic: string, text: string) => void, onClose?: () => void) {
    this.url = url;
    this.onMsg = onMsg;
    this.onClose = onClose;
  }

  static str(s: string): Uint8Array {
    const b = new TextEncoder().encode(s);
    const o = new Uint8Array(b.length + 2);
    o[0] = b.length >> 8;
    o[1] = b.length & 255;
    o.set(b, 2);
    return o;
  }

  static packet(head: number, parts: Uint8Array[]): Uint8Array {
    let len = 0;
    for (const p of parts) len += p.length;
    const lb: number[] = [];
    let n = len;
    do {
      let d = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) d |= 128;
      lb.push(d);
    } while (n > 0);
    const o = new Uint8Array(1 + lb.length + len);
    o[0] = head;
    o.set(lb, 1);
    let off = 1 + lb.length;
    for (const p of parts) {
      o.set(p, off);
      off += p.length;
    }
    return o;
  }

  connect(): Promise<void> {
    return new Promise((res, rej) => {
      let settled = false;
      const ws = (this.ws = new WebSocket(this.url, 'mqtt'));
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.close();
          rej(new Error('timeout'));
        }
      }, 6000);
      this._res = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          res();
        }
      };
      ws.onopen = () =>
        ws.send(
          MiniMqtt.packet(0x10, [
            MiniMqtt.str('MQTT'),
            new Uint8Array([4, 2, 0, 30]),
            MiniMqtt.str('an' + Math.random().toString(36).slice(2, 12)),
          ])
        );
      ws.onmessage = e => this.feed(new Uint8Array(e.data as ArrayBuffer));
      ws.onclose = () => {
        clearInterval(this.ping);
        const was = this.ok;
        this.ok = false;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          rej(new Error('closed'));
        } else if (was && this.onClose) {
          this.onClose();
        }
      };
      ws.onerror = () => {};
    });
  }

  private feed(chunk: Uint8Array): void {
    const b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf);
    b.set(chunk, this.buf.length);
    this.buf = b;
    for (;;) {
      const buf = this.buf;
      if (buf.length < 2) return;
      let len = 0;
      let mult = 1;
      let i = 1;
      let done = false;
      for (; i < buf.length && i < 5; i++) {
        len += (buf[i] & 127) * mult;
        mult *= 128;
        if (!(buf[i] & 128)) {
          done = true;
          i++;
          break;
        }
      }
      if (!done || buf.length < i + len) return;
      this.handle(buf[0], buf.subarray(i, i + len));
      this.buf = buf.slice(i + len);
    }
  }

  private handle(head: number, body: Uint8Array): void {
    const type = head >> 4;
    if (type === 2) {
      if (body[1] === 0) {
        this.ok = true;
        this.ping = setInterval(() => this.raw(new Uint8Array([0xc0, 0])), 20000);
        this._res?.();
      } else {
        this.close();
      }
    } else if (type === 3) {
      const tl = (body[0] << 8) | body[1];
      const qos = (head >> 1) & 3;
      const dec = new TextDecoder();
      this.onMsg(dec.decode(body.subarray(2, 2 + tl)), dec.decode(body.subarray(2 + tl + (qos ? 2 : 0))));
    }
  }

  private raw(p: Uint8Array): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(p);
  }

  sub(topic: string): void {
    this.raw(MiniMqtt.packet(0x82, [new Uint8Array([0, (this.pid++ & 127) + 1]), MiniMqtt.str(topic), new Uint8Array([0])]));
  }

  pub(topic: string, text: string): void {
    if (this.ok) this.raw(MiniMqtt.packet(0x30, [MiniMqtt.str(topic), new TextEncoder().encode(text)]));
  }

  close(): void {
    clearInterval(this.ping);
    this.ok = false;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.onclose = null;
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }
}

interface NetLink {
  peer: string;
  relay: boolean;
  open: boolean;
  last?: number;
  lead?: number;
  send: (msg: unknown) => void;
  close: () => void;
}

class Relay {
  private url: string;
  private subs: string[];
  private onMsg: (topic: string, text: string) => void;
  private dead = false;
  private mq: MiniMqtt | null = null;
  link?: NetLink;

  constructor(url: string, subs: string[], onMsg: (topic: string, text: string) => void) {
    this.url = url;
    this.subs = subs;
    this.onMsg = onMsg;
  }

  get ok(): boolean {
    return !!(this.mq && this.mq.ok);
  }

  start(): Promise<void> {
    const mq = (this.mq = new MiniMqtt(this.url, this.onMsg, () => this.retry()));
    return mq.connect().then(() => {
      if (this.dead) {
        mq.close();
        return;
      }
      for (const s of this.subs) mq.sub(s);
    });
  }

  private retry(): void {
    if (!this.dead) {
      setTimeout(() => {
        if (!this.dead) this.start().catch(() => this.retry());
      }, 1500);
    }
  }

  pub(topic: string, text: string): void {
    if (this.mq) this.mq.pub(topic, text);
  }

  close(): void {
    this.dead = true;
    if (this.mq) this.mq.close();
  }
}

export interface NetCallbacks {
  onLobby: () => void;
  onLeft: (id: string) => void;
  onNetClosed: (reason: string) => void;
  beginRace: (cfg: RaceStartConfig, myId: string) => void;
  applyStates: (list: (string | number)[][], lead: number) => void;
  showLobby: () => void;
}

export class Net {
  private cb: NetCallbacks;
  private session = 0;
  private forceRelay = /relay/i.test(location.hash);

  private peer: Peer | null = null;
  private relay: Relay | null = null;
  private base = '';
  private conns = new Map<string, NetLink>();
  private link: NetLink | null = null;
  private beat: ReturnType<typeof setInterval> | undefined;

  isHost = false;
  active = false;
  racing = false;
  viaRelay = false;
  directUp = false;
  relayUp = false;
  code = '';
  myId = '';
  players: LobbyPlayer[] = [];
  trackId: TrackId = 'tokyo';
  laps = 3;
  latest: Record<string, (string | number)[]> = {};
  rtt = 0;
  lead = NET_LEAD;
  private lastHeard = 0;

  constructor(cb: NetCallbacks) {
    this.cb = cb;
    this.reset();
  }

  reset(): void {
    clearInterval(this.beat);
    this.session++;
    this.peer = null;
    this.relay = null;
    this.base = '';
    this.conns.clear();
    this.link = null;
    this.isHost = false;
    this.active = false;
    this.racing = false;
    this.viaRelay = false;
    this.directUp = false;
    this.relayUp = false;
    this.code = '';
    this.myId = '';
    this.players = [];
    this.latest = {};
    this.rtt = 0;
    this.lead = NET_LEAD;
    this.lastHeard = 0;
  }

  static async openRelay(subs: string[], onMsg: (topic: string, text: string) => void): Promise<Relay | null> {
    const tries = RELAY_URLS.map(u => {
      const r = new Relay(u, subs, onMsg);
      return r.start().then(
        () => r,
        () => {
          r.close();
          return null;
        }
      );
    });
    for (let i = 0; i < tries.length; i++) {
      const r = await tries[i];
      if (r) {
        for (const t of tries.slice(i + 1)) t.then(x => x && x.close());
        return r;
      }
    }
    return null;
  }

  async host(profile: PlayerProfile, trackId: TrackId, laps: number): Promise<void> {
    const sid = this.session;
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[(Math.random() * chars.length) | 0];
    const base = 'apexnext/v2/' + code;

    const direct = this.forceRelay
      ? Promise.resolve(false)
      : new Promise<boolean>(res => {
          if (sid !== this.session) return res(false);
          const peer = (this.peer = new Peer(NET_PREFIX + code));
          let done = false;
          const end = (v: boolean) => {
            if (!done) {
              done = true;
              clearTimeout(timer);
              res(v);
            }
          };
          const timer = setTimeout(() => end(false), 10000);
          peer.on('open', () => end(true));
          peer.on('connection', c => {
            if (sid === this.session) this.onConn(c);
          });
          peer.on('disconnected', () => {
            if (this.peer === peer && !peer.destroyed) {
              try {
                peer.reconnect();
              } catch {
                /* retry */
              }
            }
          });
          peer.on('error', () => end(false));
        });

    const relay = Net.openRelay([base + '/u/+'], (topic, text) => {
      if (sid === this.session) this.relayIn(topic, text);
    });

    const [d, r] = await Promise.all([direct, relay]);
    if (sid !== this.session) {
      r?.close();
      throw new Error('Cancelled');
    }
    if (!d && !r) {
      this.leave();
      throw new Error('Could not reach matchmaking servers — check internet connection');
    }
    if (!d && this.peer) {
      try {
        this.peer.destroy();
      } catch {
        /* ignore */
      }
      this.peer = null;
    }

    this.relay = r;
    this.base = base;
    this.directUp = !!d;
    this.relayUp = !!r;
    this.isHost = true;
    this.active = true;
    this.code = code;
    this.myId = 'host';
    this.trackId = trackId;
    this.laps = laps;
    this.players = [{ id: 'host', host: true, ...cleanProfile(profile) }];
    this.beat = setInterval(() => this.hostBeat(), 2000);
  }

  setHostSettings(trackId: TrackId, laps: number): void {
    if (!this.isHost) return;
    this.trackId = trackId;
    this.laps = laps;
    this.broadcastLobby();
  }

  private onConn(c: DataConnection): void {
    const link: NetLink = {
      peer: c.peer,
      relay: false,
      get open() {
        return c.open;
      },
      send: m => c.send(m),
      close: () => c.close(),
    };
    c.on('data', m => this.hostMsg(link, m as Record<string, unknown>));
    c.on('close', () => this.drop(link));
    c.on('error', () => this.drop(link));
  }

  private relayIn(topic: string, text: string): void {
    const id = topic.slice(topic.lastIndexOf('/') + 1);
    if (!/^r[a-z0-9]{6,12}$/.test(id)) return;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    let link = this.conns.get(id);
    if (!link) {
      if (!m || m.t !== 'hello') return;
      link = {
        peer: id,
        relay: true,
        open: true,
        last: 0,
        lead: NET_LEAD,
        close() {
          this.open = false;
        },
        send: msg => {
          if (this.relay) this.relay.pub(this.base + '/d/' + id, JSON.stringify(msg));
        },
      };
    } else if (!link.relay) {
      return;
    }
    this.hostMsg(link, m);
  }

  private hostMsg(c: NetLink, m: Record<string, unknown>): void {
    if (!m || typeof m !== 'object') return;
    c.last = performance.now();
    const known = this.conns.get(c.peer) === c;
    if (m.t === 'hello') {
      if (known) {
        c.send({ t: 'welcome', id: c.peer });
        return;
      }
      if (this.conns.has(c.peer)) return;
      if (this.players.length >= MAX_PLAYERS) {
        try {
          c.send({ t: 'full' });
        } catch {
          /* ignore */
        }
        setTimeout(() => c.close(), 400);
        return;
      }
      this.conns.set(c.peer, c);
      this.players.push({ id: c.peer, host: false, relay: !!c.relay, ...cleanProfile(m as Partial<PlayerProfile>) });
      c.send({ t: 'welcome', id: c.peer });
      this.broadcastLobby();
      this.cb.onLobby();
    } else if (!known) {
      return;
    } else if (m.t === 's') {
      const arr = Array.isArray(m.c) ? m.c[0] : null;
      if (!Array.isArray(arr) || arr.length > 16) return;
      arr[0] = c.peer;
      this.latest[c.peer] = arr;
      this.cb.applyStates([arr], c.lead || NET_LEAD);
    } else if (m.t === 'ping') {
      if (typeof m.rtt === 'number' && Number.isFinite(m.rtt) && m.rtt > 0) {
        c.lead = clamp(m.rtt / 2000, 0.02, 0.4);
      }
      c.send({ t: 'pong', ts: m.ts });
    } else if (m.t === 'bye') {
      this.drop(c);
    }
  }

  private hostBeat(): void {
    const now = performance.now();
    for (const c of [...this.conns.values()]) {
      if (now - (c.last || 0) > LINK_TIMEOUT) this.drop(c);
    }
    this.broadcast({ t: 'hb' });
  }

  private drop(c: NetLink): void {
    if (this.conns.get(c.peer) !== c) return;
    if (c.relay) c.open = false;
    else {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.conns.delete(c.peer);
    delete this.latest[c.peer];
    this.players = this.players.filter(p => p.id !== c.peer);
    this.broadcast({ t: 'left', id: c.peer });
    this.broadcastLobby();
    this.cb.onLeft(c.peer);
    this.cb.onLobby();
  }

  broadcast(m: unknown, relayToo = true): void {
    let anyRelay = false;
    for (const c of this.conns.values()) {
      if (c.relay) {
        anyRelay = true;
        continue;
      }
      if (c.open) {
        try {
          c.send(m);
        } catch {
          /* ignore */
        }
      }
    }
    if (anyRelay && relayToo && this.relay) {
      this.relay.pub(this.base + '/d/all', JSON.stringify(m));
    }
  }

  broadcastLobby(): void {
    this.broadcast({
      t: 'lobby',
      players: this.players,
      racing: this.racing,
      trackId: this.trackId,
      laps: this.laps,
    });
  }

  join(code: string, profile: PlayerProfile, progress: (msg: string) => void = () => {}): Promise<void> {
    const sid = this.session;
    const base = 'apexnext/v2/' + code;
    const rid =
      'r' +
      Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[(Math.random() * 36) | 0]).join('');
    const hello = JSON.stringify({ t: 'hello', ...cleanProfile(profile) });

    return new Promise((res, rej) => {
      let done = false;
      let relayMode = false;
      const relays: Relay[] = [];

      const fail = (msg: string) => {
        if (done) return;
        done = true;
        clearTimeout(t1);
        clearTimeout(t2);
        for (const r of relays) r.close();
        if (sid === this.session) this.leave();
        rej(new Error(msg));
      };

      const win = (link: NetLink, id: string, keep: Relay | null) => {
        if (done || sid !== this.session) return;
        done = true;
        clearTimeout(t1);
        clearTimeout(t2);
        for (const r of relays) if (r !== keep) r.close();
        if (link.relay && this.peer) {
          try {
            this.peer.destroy();
          } catch {
            /* ignore */
          }
          this.peer = null;
        }
        this.link = link;
        this.viaRelay = !!link.relay;
        this.relay = keep;
        this.active = true;
        this.isHost = false;
        this.myId = id;
        this.code = code;
        this.lastHeard = performance.now();
        this.beat = setInterval(() => this.clientBeat(), 2000);
        res();
      };

      const onData = (m: Record<string, unknown>, link: NetLink, keep: Relay | null) => {
        if (!m || typeof m !== 'object' || sid !== this.session) return;
        if (!done) {
          if (m.t === 'welcome') win(link, String(m.id), keep);
          else if (m.t === 'full') fail('That room is full');
          return;
        }
        if (this.link === link) {
          this.lastHeard = performance.now();
          this.clientMsg(m);
        }
      };

      const goRelay = () => {
        if (done || relayMode) return;
        relayMode = true;
        progress('Direct connection unavailable — connecting via relay…');
        if (this.peer) {
          try {
            this.peer.destroy();
          } catch {
            /* ignore */
          }
          this.peer = null;
        }
        for (const r of relays) if (r.ok) r.pub(base + '/u/' + rid, hello);
      };

      for (const url of RELAY_URLS) {
        const r = new Relay(url, [base + '/d/' + rid, base + '/d/all'], (_topic, text) => {
          let m: Record<string, unknown>;
          try {
            m = JSON.parse(text);
          } catch {
            return;
          }
          if (r.link) onData(m, r.link, r);
        });
        r.link = {
          peer: rid,
          relay: true,
          open: true,
          send: m => r.pub(base + '/u/' + rid, JSON.stringify(m)),
          close() {},
        };
        relays.push(r);
        r.start().then(
          () => {
            if (done) {
              if (this.relay !== r) r.close();
            } else if (relayMode) {
              r.pub(base + '/u/' + rid, hello);
            }
          },
          () => {}
        );
      }

      if (this.forceRelay) {
        goRelay();
      } else {
        try {
          const peer = (this.peer = new Peer());
          peer.on('open', () => {
            if (done || relayMode) return;
            const conn = peer.connect(NET_PREFIX + code, { reliable: true });
            const link: NetLink = {
              peer: conn.peer,
              relay: false,
              get open() {
                return conn.open;
              },
              send: m => conn.send(m),
              close: () => conn.close(),
            };
            conn.on('open', () => conn.send(JSON.parse(hello)));
            conn.on('data', m => onData(m as Record<string, unknown>, link, null));
            conn.on('close', () => {
              if (!done) goRelay();
              else if (this.link === link && this.active) this.cb.onNetClosed('The host left the room');
            });
          });
          peer.on('error', () => goRelay());
        } catch {
          goRelay();
        }
      }

      const t1 = setTimeout(goRelay, 5500);
      const t2 = setTimeout(
        () => fail('Could not join room ' + code + ' — check the code and that the host is in the lobby'),
        20000
      );
    });
  }

  private clientBeat(): void {
    if (!this.active || !this.link) return;
    if (performance.now() - this.lastHeard > LINK_TIMEOUT) {
      this.cb.onNetClosed('Lost connection to the host');
      return;
    }
    try {
      this.link.send({ t: 'ping', ts: performance.now(), rtt: this.rtt });
    } catch {
      /* ignore */
    }
  }

  private clientMsg(m: Record<string, unknown>): void {
    switch (m.t) {
      case 'lobby':
        if (!Array.isArray(m.players)) return;
        this.players = (m.players as Record<string, unknown>[]).slice(0, MAX_PLAYERS).map(p => ({
          id: String(p?.id),
          host: !!p?.host,
          relay: !!p?.relay,
          ...cleanProfile(p as Partial<PlayerProfile>),
        }));
        this.racing = !!m.racing;
        if (typeof m.trackId === 'string' && TRACKS[m.trackId as TrackId]) {
          this.trackId = m.trackId as TrackId;
        }
        if (typeof m.laps === 'number') this.laps = clamp(m.laps, 1, 10);
        this.cb.onLobby();
        break;

      case 'start':
        if (!Array.isArray(m.grid) || !m.grid.length || m.grid.length > MAX_PLAYERS + 6) return;
        this.racing = true;
        this.cb.beginRace(
          {
            trackId: typeof m.trackId === 'string' && TRACKS[m.trackId as TrackId] ? (m.trackId as TrackId) : 'tokyo',
            laps: clamp(Number(m.laps) || 3, 1, 10),
            difficulty: typeof m.difficulty === 'string' && DIFFS[m.difficulty as DiffKey] ? (m.difficulty as DiffKey) : 'normal',
            grid: (m.grid as Record<string, unknown>[]).map(e => ({
              id: String(e?.id),
              ai: !!e?.ai,
              skill: clamp(Number(e?.skill) || 1, 0.8, 1),
              ...cleanProfile(e as Partial<PlayerProfile>),
            })),
          },
          this.myId
        );
        break;

      case 's':
        if (Array.isArray(m.c)) this.cb.applyStates(m.c as (string | number)[][], this.lead);
        break;

      case 'pong': {
        const s = performance.now() - Number(m.ts);
        if (Number.isFinite(s) && s >= 0 && s < 5000) {
          this.rtt = this.rtt ? this.rtt * 0.7 + s * 0.3 : s;
          this.lead = clamp(this.rtt / 2000, 0.02, 0.4);
        }
        break;
      }

      case 'left':
        this.cb.onLeft(String(m.id));
        break;

      case 'tolobby':
        this.racing = false;
        this.cb.showLobby();
        break;

      case 'closed':
        this.cb.onNetClosed('The host left the room');
        break;
    }
  }

  sendStates(cars: { remote: boolean; pack: () => (string | number)[] }[], tick: number): void {
    const packs: (string | number)[][] = [];
    for (const c of cars) if (!c.remote) packs.push(c.pack());
    if (this.isHost) {
      for (const id in this.latest) packs.push(this.latest[id]);
      this.broadcast({ t: 's', c: packs }, tick % 2 === 0);
    } else if (this.link && this.link.open && !(this.link.relay && tick % 2)) {
      try {
        this.link.send({ t: 's', c: packs });
      } catch {
        /* ignore */
      }
    }
  }

  leave(): void {
    if (this.active) {
      try {
        if (this.isHost) this.broadcast({ t: 'closed' });
        else if (this.link) this.link.send({ t: 'bye' });
      } catch {
        /* ignore */
      }
    }
    const p = this.peer;
    const r = this.relay;
    this.reset();
    if (r) r.close();
    if (p) {
      setTimeout(() => {
        try {
          p.destroy();
        } catch {
          /* ignore */
        }
      }, 300);
    }
  }
}

