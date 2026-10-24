#!/usr/bin/env node
/*
 * Aivora booth relay — zero-dependency LAN relay for the trade-show booth kit.
 * 展台局域网中继：零依赖，Node 18+。让展台上的 2~3 台设备（客户手机 iPad / 老板控制台 / 大屏）
 * 在没有外网的情况下互相通信，并承接扫码结果页的 session 与留资表单。
 *
 *   node designs/aivora-v2-exchange/booth/relay.mjs [--port 4317] [--host 0.0.0.0]
 *        [--data-dir ~/.aivora-booth] [--rate 60] [--verbose]
 *
 * Routes
 *   GET  /                         → 302 /booth/index.html
 *   GET  /<file>                   → static, only under designs/aivora-v2-exchange (Range for video)
 *   GET  /bus/ping                 → {ok:true, relay:"aivora-booth", version:1}
 *   GET  /bus/events?room=booth    → Server-Sent Events (heartbeat comment every 15 s)
 *   POST /bus/send?room=booth      → JSON ≤ 16 KB, broadcast to every subscriber of the room → 204
 *   POST /api/session              → JSON ≤ 8 KB → 201 {id}
 *   GET  /api/session/<id>         → stored JSON | 404
 *   POST /api/lead                 → JSON ≤ 4 KB → 201 {ok:true} | 400 {ok:false, error, field?}
 *   GET  /api/info                 → LAN origins + counts (no personal data), for building QR links
 *
 * Data (sessions.jsonl / leads.jsonl) lives in ~/.aivora-booth — never inside the repo.
 * Contact fields are never written to stdout; the log only shows counts.
 *
 * Hardening (reviewed 2026-10-23)
 *   - Host header must be an IP literal, localhost, *.local, this machine's name or --allow-host
 *     (blocks DNS rebinding from a website some booth device happens to open).
 *   - /bus/* and /api/* refuse cross-site browser requests: CORS is only granted to same-origin
 *     pages and to pages on a private LAN / loopback / .local origin — never "*" and never "null".
 *   - Per-device caps: SSE streams, session-id misses (no id guessing), POST rate.
 *   - The default "booth" room is pinned so other rooms can never crowd it out.
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';

export const RELAY_NAME = 'aivora-booth';
export const VERSION = 1;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = path.resolve(HERE, '..');

const LIMITS = {
  busBody: 16 * 1024,
  sessionBody: 8 * 1024,
  leadBody: 4 * 1024,
  heartbeatMs: 15_000,
  maxRooms: 32,
  maxSubsPerRoom: 64,
  maxSubsTotal: 256,
  maxBacklogBytes: 1024 * 1024, // a subscriber that stops reading is dropped past this
  replayCount: 50, // per room, replayed to a reconnecting EventSource (Last-Event-ID)
  replayBytes: 256 * 1024,
  replayAgeMs: 120_000,
  sessionsInMemory: 5000,
  maxSubsPerIp: 16, // one device (or the laptop with every booth tab open) never needs more
  sessionMissesPerMin: 30, // GET /api/session/<unknown id> per device before 429 (no id guessing)
  maxJsonDepth: 64,
  maxLineBytes: 64 * 1024, // jsonl lines longer than this are skipped on startup, never loaded
};

const PINNED_ROOM = 'booth'; // the room every booth page uses; never swept, never refused
const ROOM_RE = /^[a-z0-9-]{1,32}$/;
const ID_RE = /^[a-z2-7]{8}$/;
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

const MIME = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

/* ───────── small helpers ───────── */

const stamp = () => new Date().toTimeString().slice(0, 8);
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}
function findRepoRoot(start) {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}
function expandHome(p) {
  return p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function newId() {
  let n = 0;
  for (const byte of crypto.randomBytes(5)) n = n * 256 + byte; // 40 bits = 8 base32 chars
  let s = '';
  for (let i = 0; i < 8; i++) {
    s = B32[n % 32] + s;
    n = Math.floor(n / 32);
  }
  return s;
}
function httpError(status, code, extra) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  e.extra = extra;
  return e;
}
function sendJson(res, status, obj, headers = {}) {
  if (res.headersSent) return void res.destroy();
  const body = status === 204 ? '' : JSON.stringify(obj);
  res.writeHead(status, {
    ...BASE_HEADERS,
    'Cache-Control': 'no-store',
    ...(status === 204 ? {} : { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }),
    ...headers,
  });
  res.end(body);
}
function sendText(res, status, text, headers = {}) {
  if (res.headersSent) return void res.destroy();
  res.writeHead(status, {
    ...BASE_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(text);
}
function clientIp(req) {
  const a = req.socket.remoteAddress || 'unknown';
  return a.startsWith('::ffff:') ? a.slice(7) : a;
}

/** Iterative (no recursion, so no stack overflow) check that JSON nests at most `max` levels. */
function depthWithin(value, max) {
  const stack = [[value, 1]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if (d > max) return false;
    for (const child of Object.values(v)) if (child !== null && typeof child === 'object') stack.push([child, d + 1]);
  }
  return true;
}

/* ───────── Host / Origin policy ───────── */

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** "Host" header value or URL host → lowercased hostname without port or IPv6 brackets. */
function hostnameOf(hostPort) {
  const h = String(hostPort).trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? null : h.slice(1, end);
  }
  const colon = h.indexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}
function isIpLiteral(name) {
  return IPV4_RE.test(name) || (name.includes(':') && /^[0-9a-f:.]+(%[\w.-]+)?$/.test(name));
}
/** Loopback, RFC 1918, CGNAT, link-local, IPv6 ULA / link-local / loopback. */
function isPrivateIp(name) {
  if (IPV4_RE.test(name)) {
    const [a, b] = name.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (!isIpLiteral(name)) return false;
  const v6 = name.replace(/%.*$/, '');
  if (v6 === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateIp(mapped[1]);
  return /^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6); // fc00::/7, fe80::/10 (full 4-digit group)
}

/**
 * Names that can only point at this machine or the booth LAN. A DNS name outside this list could be
 * rebound by a website to the relay's address, so the relay refuses to answer to it.
 */
function makeNamePolicy(allowHosts) {
  const own = new Set();
  const h = os.hostname().toLowerCase();
  if (h) {
    own.add(h);
    own.add(h.replace(/\.local$/, ''));
    own.add(h.replace(/\.local$/, '') + '.local');
  }
  const extra = new Set(allowHosts.map((x) => x.toLowerCase()));
  const anyHost = extra.has('*');
  const localName = (name) =>
    name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local') || own.has(name) || extra.has(name);
  return {
    /** Host header check: any IP literal is fine (rebinding needs a DNS name). */
    hostOk(hostHeader) {
      if (anyHost || hostHeader === undefined) return true;
      const name = hostnameOf(hostHeader);
      return Boolean(name) && (isIpLiteral(name) || localName(name));
    },
    /** Cross-origin pages allowed to use /bus and /api: LAN / loopback / .local only. */
    originOk(origin) {
      let u;
      try {
        u = new URL(origin);
      } catch {
        return false;
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      const name = hostnameOf(u.host);
      return Boolean(name) && (isPrivateIp(name) || localName(name));
    },
  };
}

/** realpath of the nearest existing ancestor + the not-yet-created rest (so a check happens before mkdir). */
async function resolveThroughSymlinks(p) {
  const rest = [];
  for (let cur = p; ; cur = path.dirname(cur)) {
    try {
      return path.join(await fsp.realpath(cur), ...rest.reverse());
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
      if (path.dirname(cur) === cur) return p;
      rest.push(path.basename(cur));
    }
  }
}

/**
 * Stream a JSON-lines file line by line without ever holding the whole file (a multi-GB file
 * would otherwise stop the relay from starting). Lines over `maxBytes` are skipped.
 */
async function forEachLine(file, onLine, maxBytes = LIMITS.maxLineBytes) {
  let parts = [];
  let len = 0;
  let overflow = false;
  let oversize = 0;
  const finish = () => {
    if (overflow) oversize++;
    else if (len) {
      const line = Buffer.concat(parts, len).toString('utf8');
      if (line.trim() !== '') onLine(line);
    }
    parts = [];
    len = 0;
    overflow = false;
  };
  const add = (piece) => {
    if (overflow || !piece.length) return;
    if (len + piece.length > maxBytes) {
      overflow = true;
      parts = [];
      len = 0;
      return;
    }
    parts.push(piece);
    len += piece.length;
  };
  try {
    for await (const chunk of fs.createReadStream(file, { highWaterMark: 256 * 1024 })) {
      let start = 0;
      for (let nl = chunk.indexOf(10); nl !== -1; nl = chunk.indexOf(10, start)) {
        add(chunk.subarray(start, nl));
        finish();
        start = nl + 1;
      }
      add(chunk.subarray(start));
    }
  } catch (err) {
    if (err.code === 'ENOENT') return { oversize: 0 };
    throw err;
  }
  finish();
  return { oversize };
}

/** Every non-internal IPv4 address, private LAN ranges first, link-local last. */
export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push({ name, address: a.address });
    }
  }
  const rank = (ip) =>
    /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) ? 0 : /^169\.254\./.test(ip) ? 2 : 1;
  return out.sort((x, y) => rank(x.address) - rank(y.address));
}

/** Read a JSON body with a hard size cap. Rejects non-JSON content types. */
function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    const ct = String(req.headers['content-type'] || '');
    if (!/^application\/(?:[\w.+-]*\+)?json\s*(?:;|$)/i.test(ct)) {
      return reject(httpError(415, 'unsupported_media_type'));
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) return reject(httpError(413, 'too_large'));
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (e) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) return fail(httpError(413, 'too_large'));
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      } catch {
        return reject(httpError(400, 'invalid_utf8'));
      }
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        return reject(httpError(400, 'invalid_json'));
      }
      // Deep nesting would overflow JSON.stringify's stack later (500 + stack trace in the log).
      if (!depthWithin(value, LIMITS.maxJsonDepth)) return reject(httpError(400, 'too_deep'));
      resolve(value);
    });
    req.on('error', () => fail(httpError(400, 'aborted')));
    req.on('close', () => fail(httpError(400, 'aborted')));
  });
}

/** Append-only JSON-lines file; writes are serialized so lines never interleave. */
class JsonlLog {
  constructor(file) {
    this.file = file;
    this.tail = Promise.resolve();
  }
  append(obj) {
    const line = JSON.stringify(obj) + '\n';
    const p = this.tail.then(() => fsp.appendFile(this.file, line, { encoding: 'utf8', mode: 0o600 }));
    this.tail = p.catch(() => {});
    return p;
  }
  flush() {
    return this.tail;
  }
}

/** Token bucket per client IP. */
class RateLimiter {
  constructor(perMinute) {
    this.cap = perMinute;
    this.perMs = perMinute / 60_000;
    this.buckets = new Map();
  }
  /** @returns 0 when allowed, otherwise seconds until the next token. */
  take(key, now = Date.now()) {
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { tokens: this.cap, t: now }));
    b.tokens = Math.min(this.cap, b.tokens + (now - b.t) * this.perMs);
    b.t = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.max(1, Math.ceil((1 - b.tokens) / this.perMs / 1000));
  }
  /** Like take() but consumes nothing: 0 when a token is available. */
  peek(key, now = Date.now()) {
    const b = this.buckets.get(key);
    if (!b) return 0;
    const tokens = Math.min(this.cap, b.tokens + (now - b.t) * this.perMs);
    return tokens >= 1 ? 0 : Math.max(1, Math.ceil((1 - tokens) / this.perMs / 1000));
  }
  sweep(now = Date.now()) {
    for (const [k, b] of this.buckets) if (b.tokens + (now - b.t) * this.perMs >= this.cap) this.buckets.delete(k);
  }
}

/* ───────── lead validation ───────── */

const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,185}\.[^\s@<>".]{2,63}$/;
const PHONE_RE = /^\+?[0-9][0-9 ().-]{4,22}[0-9]$/;
const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;
const SID_RE = /^[A-Za-z0-9_-]{1,32}$/;
// 微信号：字母开头 6–20 位（字母、数字、- _），或直接填手机号
const WECHAT_RE = /^(?:[A-Za-z][-_A-Za-z0-9]{5,19}|\+?[0-9]{6,15})$/;
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
// eslint-disable-next-line no-control-regex
const ANY_CTRL_RE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

function optionalString(v) {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== 'string') return { bad: true };
  const s = v.trim();
  return { value: s === '' ? null : s };
}

/**
 * Lead contract: {lang, sid?, email?, whatsapp?, wechat?, consentEmail, consentWhatsApp, consentWeChat?, note?}.
 * sid may be null/absent: result.html opened from a self-contained ?d= link has no session id,
 * and rejecting those leads would leave them stranded in the visitor's own browser.
 * At least one contact must come with its matching consent; a contact given without
 * consent is dropped (not stored).
 */
export function validateLead(b) {
  const bad = (error, field) => ({ error, field });
  if (!isPlainObject(b)) return bad('expected_object');
  if (typeof b.lang !== 'string' || !LANG_RE.test(b.lang)) return bad('invalid_field', 'lang');
  const sid = b.sid === undefined || b.sid === null || b.sid === '' ? null : b.sid;
  if (sid !== null && (typeof sid !== 'string' || !SID_RE.test(sid))) return bad('invalid_field', 'sid');
  if (typeof b.consentEmail !== 'boolean') return bad('invalid_field', 'consentEmail');
  if (typeof b.consentWhatsApp !== 'boolean') return bad('invalid_field', 'consentWhatsApp');
  if (b.consentWeChat !== undefined && typeof b.consentWeChat !== 'boolean') return bad('invalid_field', 'consentWeChat');

  const email = optionalString(b.email);
  if (
    email.bad ||
    (email.value && (email.value.length > 254 || ANY_CTRL_RE.test(email.value) || !EMAIL_RE.test(email.value)))
  ) {
    return bad('invalid_field', 'email');
  }
  const wa = optionalString(b.whatsapp);
  if (wa.bad) return bad('invalid_field', 'whatsapp');
  if (wa.value) {
    const digits = wa.value.replace(/\D/g, '').length;
    if (!PHONE_RE.test(wa.value) || digits < 6 || digits > 15) return bad('invalid_field', 'whatsapp');
  }
  const wx = optionalString(b.wechat);
  if (wx.bad || (wx.value && !WECHAT_RE.test(wx.value))) return bad('invalid_field', 'wechat');
  const note = optionalString(b.note);
  if (note.bad || (note.value && note.value.length > 1000)) return bad('invalid_field', 'note');

  if (!email.value && !wa.value && !wx.value) return bad('contact_required');
  const keepEmail = Boolean(email.value) && b.consentEmail === true;
  const keepWa = Boolean(wa.value) && b.consentWhatsApp === true;
  const keepWx = Boolean(wx.value) && b.consentWeChat === true;
  if (!keepEmail && !keepWa && !keepWx) return bad('consent_required');

  const lead = { lang: b.lang, sid, consentEmail: b.consentEmail, consentWhatsApp: b.consentWhatsApp, consentWeChat: b.consentWeChat === true };
  if (keepEmail) lead.email = email.value;
  if (keepWa) lead.whatsapp = wa.value;
  if (keepWx) lead.wechat = wx.value;
  if (note.value) lead.note = note.value.replace(CTRL_RE, '');
  return { lead };
}

/* ───────── relay ───────── */

export async function startRelay(options = {}) {
  const opts = {
    port: 4317,
    host: '0.0.0.0',
    dataDir: process.env.AIVORA_BOOTH_DATA || path.join(os.homedir(), '.aivora-booth'),
    rate: 60,
    verbose: false,
    allowHosts: [],
    log: (line) => console.log(`[${stamp()}] ${line}`),
    warn: (line) => console.error(`[${stamp()}] ! ${line}`),
    ...options,
  };
  const { log, warn } = opts;
  const names = makeNamePolicy(opts.allowHosts || []);

  // Data dir: refuse anything inside the repo or the static root. Checked lexically, then through
  // symlinks of the part that already exists (before mkdir, so nothing gets created in the repo),
  // then once more on the final realpath.
  const dataDir = path.resolve(expandHome(String(opts.dataDir)));
  const rootReal = await fsp.realpath(STATIC_ROOT);
  const repoRoot = findRepoRoot(rootReal);
  const forbidden = [STATIC_ROOT, rootReal, repoRoot, repoRoot && fs.realpathSync(repoRoot)].filter(Boolean);
  const assertOutsideRepo = (p) => {
    if (forbidden.some((f) => isInside(p, f))) {
      throw new Error(`data dir ${p} is inside the repository — booth data must live outside it (default ~/.aivora-booth)`);
    }
  };
  assertOutsideRepo(dataDir);
  assertOutsideRepo(await resolveThroughSymlinks(dataDir));
  await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const dataReal = await fsp.realpath(dataDir);
  assertOutsideRepo(dataReal);
  const sessionFile = path.join(dataReal, 'sessions.jsonl');
  const leadFile = path.join(dataReal, 'leads.jsonl');
  // appendFile's mode only applies when it creates the file: tighten files left by older runs.
  for (const f of [sessionFile, leadFile]) {
    try {
      if (((await fsp.stat(f)).mode & 0o077) !== 0) await fsp.chmod(f, 0o600);
    } catch (err) {
      if (err.code !== 'ENOENT') warn(`could not make ${path.basename(f)} private: ${err.code || err.message}`);
    }
  }
  const sessionLog = new JsonlLog(sessionFile);
  const leadLog = new JsonlLog(leadFile);

  // Sessions survive a relay restart: reload them so printed QR codes keep working.
  const sessions = new Map();
  const remember = (id, data) => {
    sessions.delete(id);
    sessions.set(id, data);
    if (sessions.size > LIMITS.sessionsInMemory) sessions.delete(sessions.keys().next().value);
  };
  let skipped = 0;
  const sessionScan = await forEachLine(sessionFile, (line) => {
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec.id === 'string' && ID_RE.test(rec.id) && isPlainObject(rec.data)) remember(rec.id, rec.data);
      else skipped++;
    } catch {
      skipped++;
    }
  });
  skipped += sessionScan.oversize;
  if (skipped) warn(`sessions.jsonl: skipped ${skipped} unreadable line(s)`);
  let leadTotal = 0;
  const leadScan = await forEachLine(leadFile, () => leadTotal++);
  if (leadScan.oversize) warn(`leads.jsonl: ${leadScan.oversize} over-long line(s) not counted`);
  let leadsThisRun = 0;

  const apiLimiter = new RateLimiter(opts.rate);
  const busLimiter = new RateLimiter(opts.rate * 10);
  const missLimiter = new RateLimiter(LIMITS.sessionMissesPerMin);

  /* bus state */
  const BOOT = crypto.randomBytes(3).toString('hex');
  let seq = 0;
  const rooms = new Map(); // name → { subs:Set<{res, ip}>, buffer:[{seq, at, frame}], bytes }
  rooms.set(PINNED_ROOM, { subs: new Set(), buffer: [], bytes: 0 }); // never swept: see sweepRooms
  let subsTotal = 0;
  const subsByIp = new Map(); // ip → open SSE streams
  const ensureRoom = (name) => {
    let room = rooms.get(name);
    if (!room) {
      if (rooms.size >= LIMITS.maxRooms) sweepRooms();
      if (rooms.size >= LIMITS.maxRooms) return null;
      rooms.set(name, (room = { subs: new Set(), buffer: [], bytes: 0 }));
    }
    return room;
  };
  const trimBuffer = (room, now = Date.now()) => {
    while (
      room.buffer.length &&
      (room.buffer.length > LIMITS.replayCount || room.bytes > LIMITS.replayBytes || now - room.buffer[0].at > LIMITS.replayAgeMs)
    ) {
      room.bytes -= room.buffer.shift().frame.length;
    }
  };
  function sweepRooms() {
    const now = Date.now();
    for (const [name, room] of rooms) {
      trimBuffer(room, now);
      if (!room.subs.size && !room.buffer.length && name !== PINNED_ROOM) rooms.delete(name);
    }
  }
  const writeFrame = (sub, frame) => {
    const res = sub.res;
    if (res.destroyed || res.writableEnded) return false;
    if (res.writableLength > LIMITS.maxBacklogBytes) {
      warn(`bus  dropping a subscriber that stopped reading (${sub.ip})`);
      res.destroy();
      return false;
    }
    res.write(frame);
    return true;
  };
  const broadcast = (room, line) => {
    seq += 1;
    const frame = `id: ${BOOT}-${seq}\ndata: ${line}\n\n`;
    room.buffer.push({ seq, at: Date.now(), frame });
    room.bytes += frame.length;
    trimBuffer(room);
    let delivered = 0;
    for (const sub of room.subs) if (writeFrame(sub, frame)) delivered++;
    return delivered;
  };
  const heartbeat = setInterval(() => {
    const frame = `: hb ${Date.now()}\n\n`;
    for (const room of rooms.values()) for (const sub of room.subs) writeFrame(sub, frame);
  }, LIMITS.heartbeatMs);
  const janitor = setInterval(() => {
    sweepRooms();
    apiLimiter.sweep();
    busLimiter.sweep();
    missLimiter.sweep();
  }, 60_000);
  heartbeat.unref();
  janitor.unref();

  const roomFrom = (query) => {
    const r = query.get('room');
    const room = r === null || r === '' ? 'booth' : r;
    return ROOM_RE.test(room) ? room : null;
  };

  /* handlers */

  function handleEvents(req, res, query, ip) {
    const name = roomFrom(query);
    if (!name) return sendJson(res, 400, { ok: false, error: 'invalid_room' });
    const room = ensureRoom(name);
    if (!room) return sendJson(res, 503, { ok: false, error: 'too_many_rooms' });
    // Per-device cap first, so one device can never take every slot of the booth room.
    if ((subsByIp.get(ip) || 0) >= LIMITS.maxSubsPerIp) {
      return sendJson(res, 503, { ok: false, error: 'too_many_streams_from_device' }, { 'Retry-After': '5' });
    }
    if (room.subs.size >= LIMITS.maxSubsPerRoom || subsTotal >= LIMITS.maxSubsTotal) {
      return sendJson(res, 503, { ok: false, error: 'too_many_subscribers' }, { 'Retry-After': '5' });
    }
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true, 10_000);
    res.writeHead(200, {
      ...BASE_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      Pragma: 'no-cache',
      Expires: '0',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 2000\n: ${RELAY_NAME} v${VERSION} room=${name}\n\n`);

    // Reconnecting EventSource sends Last-Event-ID: replay what it missed (≤ 2 min, ≤ 50 msgs).
    const lastId = String(req.headers['last-event-id'] || query.get('lastEventId') || '');
    const m = /^([0-9a-f]{6})-(\d{1,15})$/.exec(lastId);
    if (m) {
      const after = m[1] === BOOT ? Number(m[2]) : 0; // other boot → everything buffered is new
      trimBuffer(room);
      for (const e of room.buffer) if (e.seq > after) res.write(e.frame);
    }

    const sub = { res, ip };
    room.subs.add(sub);
    subsTotal++;
    subsByIp.set(ip, (subsByIp.get(ip) || 0) + 1);
    log(`bus  + ${name} · ${room.subs.size} listening · ${ip}`);
    res.on('error', () => {});
    res.on('close', () => {
      if (room.subs.delete(sub)) {
        subsTotal--;
        const left = (subsByIp.get(ip) || 1) - 1;
        if (left > 0) subsByIp.set(ip, left);
        else subsByIp.delete(ip);
        if (!closing) log(`bus  - ${name} · ${room.subs.size} listening · ${ip}`);
      }
    });
  }

  async function handleSend(req, res, query) {
    const name = roomFrom(query);
    if (!name) return sendJson(res, 400, { ok: false, error: 'invalid_room' });
    const value = await readJsonBody(req, LIMITS.busBody);
    const room = ensureRoom(name);
    if (!room) return sendJson(res, 503, { ok: false, error: 'too_many_rooms' });
    const line = JSON.stringify(value); // one line, whatever whitespace the sender used
    const delivered = broadcast(room, line);
    if (opts.verbose) {
      // type is sender-controlled: keep it to a short token so it cannot smuggle escape codes,
      // fake log lines or contact details into the terminal.
      const type =
        isPlainObject(value) && typeof value.type === 'string'
          ? value.type.slice(0, 40).replace(/[^\w:.-]/g, '?')
          : typeof value;
      log(`bus  > ${name} · ${type} · ${line.length} B → ${delivered}`);
    }
    sendJson(res, 204, null, { 'X-Aivora-Delivered': String(delivered) });
  }

  async function handleSessionCreate(req, res) {
    const data = await readJsonBody(req, LIMITS.sessionBody);
    if (!isPlainObject(data)) return sendJson(res, 400, { ok: false, error: 'expected_object' });
    let id = newId();
    while (sessions.has(id)) id = newId();
    remember(id, data);
    try {
      await sessionLog.append({ id, ts: new Date().toISOString(), data });
    } catch (err) {
      warn(`session ${id} kept in memory only — could not write ${sessionFile}: ${err.code || err.message}`);
    }
    log(`api  session ${id} · ${sessions.size} in memory`);
    sendJson(res, 201, { id });
  }

  /** 40-bit ids are only unguessable if guessing is slow: misses cost a token, none left → 429. */
  function handleSessionRead(res, rawId, ip) {
    const wait = missLimiter.peek(ip);
    if (wait) return sendJson(res, 429, { ok: false, error: 'rate_limited' }, { 'Retry-After': String(wait) });
    const data = /^[A-Za-z2-7]{8}$/.test(rawId) ? sessions.get(rawId.toLowerCase()) : undefined;
    if (!data) {
      missLimiter.take(ip);
      return sendJson(res, 404, { ok: false, error: 'not_found' });
    }
    sendJson(res, 200, data);
  }

  async function handleLead(req, res) {
    const body = await readJsonBody(req, LIMITS.leadBody);
    const v = validateLead(body);
    if (v.error) {
      return sendJson(res, 400, { ok: false, error: v.error, ...(v.field ? { field: v.field } : {}) });
    }
    const record = { ts: new Date().toISOString(), ...v.lead, sessionKnown: sessions.has(v.lead.sid) };
    try {
      await leadLog.append(record);
    } catch (err) {
      warn(`lead NOT saved — cannot write ${leadFile}: ${err.code || err.message}`);
      return sendJson(res, 500, { ok: false, error: 'storage_failed' });
    }
    leadTotal++;
    leadsThisRun++;
    log(`api  lead saved · ${leadsThisRun} this run · ${leadTotal} in file`);
    sendJson(res, 201, { ok: true });
  }

  function handleInfo(res, port) {
    const roomCounts = {};
    for (const [name, room] of rooms) roomCounts[name] = room.subs.size;
    sendJson(res, 200, {
      ok: true,
      relay: RELAY_NAME,
      version: VERSION,
      port,
      origins: lanAddresses().map((a) => `http://${a.address}:${port}`),
      rooms: roomCounts,
      sessions: sessions.size,
      leads: leadTotal,
      uptimeSec: Math.round(process.uptime()),
    });
  }

  async function serveStatic(req, res, rawPath) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method Not Allowed\n', { Allow: 'GET, HEAD' });
    let decoded;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      return sendText(res, 400, 'Bad Request\n');
    }
    // NUL, backslash (Windows separator) and ':' (drive letters, NTFS alternate data streams).
    if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes(':')) return sendText(res, 400, 'Bad Request\n');
    const segs = decoded.split('/').filter(Boolean);
    if (segs.includes('..')) return sendText(res, 403, 'Forbidden\n');
    if (segs.some((s) => s.startsWith('.'))) return sendText(res, 404, 'Not Found\n'); // dotfiles / dot-dirs
    const abs = path.resolve(rootReal, ...segs);
    if (!isInside(abs, rootReal)) return sendText(res, 403, 'Forbidden\n');

    let real;
    let st;
    try {
      real = await fsp.realpath(abs);
      if (!isInside(real, rootReal)) return sendText(res, 403, 'Forbidden\n'); // symlink escaping the root
      // Same dotfile rule on the resolved path: catches symlinks into dot-dirs and Windows
      // 8.3 short names (IMPECC~1 → .impeccable) that the URL check cannot see.
      if (path.relative(rootReal, real).split(path.sep).some((s) => s.startsWith('.'))) {
        return sendText(res, 404, 'Not Found\n');
      }
      st = await fsp.stat(real);
    } catch {
      return sendText(res, 404, 'Not Found\n');
    }
    if (st.isDirectory()) {
      // No listings. A folder with an index.html redirects to it; anything else is 404.
      try {
        if ((await fsp.stat(path.join(real, 'index.html'))).isFile()) {
          const loc = '/' + [...segs, 'index.html'].map(encodeURIComponent).join('/');
          res.writeHead(302, { ...BASE_HEADERS, Location: loc, 'Cache-Control': 'no-store', 'Content-Length': 0 });
          return res.end();
        }
      } catch {
        /* fall through */
      }
      return sendText(res, 404, 'Not Found\n');
    }
    const type = st.isFile() ? MIME[path.extname(real).slice(1).toLowerCase()] : null;
    if (!type) return sendText(res, 404, 'Not Found\n');

    const size = st.size;
    const etag = `"${size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const lastModified = new Date(Math.floor(st.mtimeMs / 1000) * 1000).toUTCString();
    const headers = {
      ...BASE_HEADERS,
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      ETag: etag,
      'Last-Modified': lastModified,
    };
    const inm = req.headers['if-none-match'];
    const ims = Date.parse(req.headers['if-modified-since'] || '');
    const etagMatch = (list) => list.split(',').some((t) => t.trim().replace(/^W\//, '') === etag || t.trim() === '*');
    if (inm ? etagMatch(inm) : Number.isFinite(ims) && Math.floor(st.mtimeMs / 1000) * 1000 <= ims) {
      res.writeHead(304, headers);
      return res.end();
    }

    let range = null;
    const ifRange = req.headers['if-range'];
    if (req.headers.range && (!ifRange || ifRange === etag || ifRange === lastModified)) {
      range = parseRange(req.headers.range, size);
      if (range === 'unsatisfiable') {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
        return res.end();
      }
    }
    if (range) {
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Content-Length': range.end - range.start + 1,
      });
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': size });
    }
    if (req.method === 'HEAD' || size === 0) return res.end();
    pipeline(fs.createReadStream(real, range || undefined), res, () => {}); // errors / disconnects: just stop
  }

  /* router */

  let boundPort = opts.port;
  let closing = false;

  async function route(req, res) {
    const ip = clientIp(req);
    const url = req.url || '/';
    const qi = url.indexOf('?');
    const rawPath = qi === -1 ? url : url.slice(0, qi);
    const query = new URLSearchParams(qi === -1 ? '' : url.slice(qi + 1));
    if (!rawPath.startsWith('/')) return sendText(res, 400, 'Bad Request\n');

    // DNS rebinding: a website whose name suddenly resolves to this laptop arrives with its own
    // name in Host. Only answer to names that can only mean this machine / the booth LAN.
    if (!names.hostOk(req.headers.host)) {
      return sendText(
        res,
        421,
        'Misdirected Request: open the relay by its IP address (see the relay banner), or start it with --allow-host <name>.\n' +
          '请用中继启动时打印的 IP 地址打开；如需用域名访问，启动时加 --allow-host <域名>。\n',
        { Connection: 'close' },
      );
    }

    const isBus = rawPath.startsWith('/bus/');
    if (isBus || rawPath.startsWith('/api/')) {
      // Cross-site guard. Browsers always send Origin on cross-origin requests, so a request
      // from a page on the internet is refused here (also as a preflight) instead of being
      // waved through by "Access-Control-Allow-Origin: *".
      res.setHeader('Vary', 'Origin');
      const origin = req.headers.origin;
      const fetchSite = req.headers['sec-fetch-site'];
      let sameOrigin = fetchSite === 'same-origin';
      if (!sameOrigin && origin && origin !== 'null') {
        try {
          sameOrigin = new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase();
        } catch {
          sameOrigin = false;
        }
      }
      if (origin !== undefined && !sameOrigin) {
        if (origin === 'null' || !names.originOk(origin)) {
          return sendJson(res, 403, { ok: false, error: 'origin_not_allowed' }, { Connection: 'close' });
        }
        res.setHeader('Access-Control-Allow-Origin', origin); // a booth page on another LAN port
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID',
          'Access-Control-Max-Age': '600',
          'Content-Length': 0,
        });
        return res.end();
      }
      if (req.method === 'POST') {
        const wait = (isBus ? busLimiter : apiLimiter).take(ip);
        if (wait) return sendJson(res, 429, { ok: false, error: 'rate_limited' }, { 'Retry-After': String(wait), Connection: 'close' });
      }
      const allow = (methods) => {
        if (methods.includes(req.method)) return true;
        sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: methods.join(', '), Connection: 'close' });
        return false;
      };
      if (rawPath === '/bus/ping') return allow(['GET']) && sendJson(res, 200, { ok: true, relay: RELAY_NAME, version: VERSION });
      if (rawPath === '/bus/events') return allow(['GET']) && handleEvents(req, res, query, ip);
      if (rawPath === '/bus/send') return allow(['POST']) && handleSend(req, res, query);
      if (rawPath === '/api/session') return allow(['POST']) && handleSessionCreate(req, res);
      if (rawPath === '/api/lead') return allow(['POST']) && handleLead(req, res);
      if (rawPath === '/api/info') return allow(['GET']) && handleInfo(res, boundPort);
      const sm = /^\/api\/session\/([^/]+)$/.exec(rawPath);
      if (sm) return allow(['GET']) && handleSessionRead(res, sm[1], ip);
      return sendJson(res, 404, { ok: false, error: 'not_found' });
    }

    if (rawPath === '/' || rawPath === '/booth' || rawPath === '/booth/') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method Not Allowed\n', { Allow: 'GET, HEAD' });
      res.writeHead(302, { ...BASE_HEADERS, Location: '/booth/index.html', 'Cache-Control': 'no-store', 'Content-Length': 0 });
      return res.end();
    }
    return serveStatic(req, res, rawPath);
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      if (err && err.status) {
        // Body was not (fully) read on 413/415: close the connection instead of draining it.
        const close = err.status === 413 || err.status === 415 ? { Connection: 'close' } : {};
        if (err.code === 'aborted') return void res.destroy();
        return sendJson(res, err.status, { ok: false, error: err.code }, close);
      }
      warn(`internal error on ${req.method} ${String(req.url).slice(0, 80)}: ${err && err.stack ? err.stack : err}`);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal' });
      else res.destroy();
    });
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 10_000;
  const sockets = new Set();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  boundPort = server.address().port;
  server.on('error', (err) => warn(`server error: ${err.message}`));

  async function close() {
    if (closing) return;
    closing = true;
    clearInterval(heartbeat);
    clearInterval(janitor);
    for (const room of rooms.values()) {
      for (const sub of room.subs) {
        try {
          sub.res.end(': relay shutting down\n\n');
        } catch {
          /* ignore */
        }
      }
    }
    await new Promise((resolve) => {
      const done = setTimeout(resolve, 2000);
      server.close(() => {
        clearTimeout(done);
        resolve();
      });
      setTimeout(() => {
        for (const s of sockets) s.destroy(); // idle keep-alive + ended SSE sockets
      }, 300).unref();
    });
    for (const s of sockets) s.destroy();
    await Promise.all([sessionLog.flush(), leadLog.flush()]);
  }

  return {
    server,
    port: boundPort,
    host: opts.host,
    dataDir: dataReal,
    staticRoot: rootReal,
    counts: () => ({ sessions: sessions.size, leadsInFile: leadTotal, leadsThisRun }),
    close,
  };
}

/** RFC 7233 single byte range. null → ignore the header (serve 200); 'unsatisfiable' → 416. */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null; // multi-range or garbage: full body
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  if (m[2] !== '' && Number(m[2]) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end: m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1) };
}

/* ───────── CLI ───────── */

const USAGE = `Aivora booth relay v${VERSION}

  node relay.mjs [--port 4317] [--host 0.0.0.0] [--data-dir ~/.aivora-booth] [--rate 60] [--verbose]
                 [--allow-host name[,name]]

  --port        TCP port (0 = random free port)                 default 4317
  --host        address to bind; 0.0.0.0 = every network        default 0.0.0.0
  --data-dir    where sessions.jsonl / leads.jsonl are appended default ~/.aivora-booth
                (also AIVORA_BOOTH_DATA; refused if inside the repo)
  --rate        POSTs per minute per device for /api/*; /bus/send gets 10x   default 60
  --verbose     log every bus message (type + size only, never the payload)
  --allow-host  extra host names the relay answers to (IP addresses, localhost, *.local and
                this machine's name always work). Repeatable or comma-separated.
`;

function parseArgs(argv) {
  const opts = {};
  const int = (v, flag, min, max) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${flag} expects an integer ${min}-${max}, got "${v}"`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    let flag = argv[i];
    let inline;
    const eq = flag.indexOf('=');
    if (flag.startsWith('--') && eq > 0) {
      inline = flag.slice(eq + 1);
      flag = flag.slice(0, eq);
    }
    const value = () => {
      if (inline !== undefined) return inline;
      if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
      return argv[++i];
    };
    switch (flag) {
      case '--port':
      case '-p':
        opts.port = int(value(), flag, 0, 65535);
        break;
      case '--host':
        opts.host = value();
        break;
      case '--data-dir':
        opts.dataDir = value();
        break;
      case '--rate':
        opts.rate = int(value(), flag, 1, 100_000);
        break;
      case '--verbose':
      case '-v':
        opts.verbose = true;
        break;
      case '--allow-host': {
        const list = value()
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        for (const h of list) {
          if (h !== '*' && !/^[a-z0-9.-]{1,253}$/.test(h)) throw new Error(`--allow-host expects host names, got "${h}"`);
        }
        opts.allowHosts = [...(opts.allowHosts || []), ...list];
        break;
      }
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        throw new Error(`unknown option "${flag}"`);
    }
  }
  return opts;
}

function banner(relay) {
  const { port, host } = relay;
  const page = '/booth/index.html';
  const lines = ['', `  Aivora booth relay v${VERSION}  ·  展台局域网中继`, ''];
  const wildcard = host === '0.0.0.0' || host === '::';
  if (wildcard) {
    const lan = lanAddresses();
    lines.push('  Open on every booth device / 在每台展台设备上打开：');
    for (const a of lan) lines.push(`    http://${a.address}:${port}${page}    (${a.name})`);
    if (!lan.length) {
      lines.push('    (no LAN IPv4 yet — join the booth Wi-Fi/hotspot; the relay keeps listening)');
      lines.push('    （尚未连上局域网：连上展台 Wi-Fi / 热点即可，无需重启）');
    }
    lines.push(`    http://127.0.0.1:${port}${page}    (this machine / 本机)`);
  } else {
    lines.push('  Open / 打开：', `    http://${host.includes(':') ? `[${host}]` : host}:${port}${page}`);
  }
  const c = relay.counts();
  lines.push(
    '',
    `  static  ${relay.staticRoot}`,
    `  data    ${relay.dataDir}   (sessions ${c.sessions} · leads ${c.leadsInFile})`,
    `  bus     /bus/events?room=booth · /bus/send?room=booth · /bus/ping`,
    '',
    '  Ctrl+C to stop / 按 Ctrl+C 停止',
    '',
  );
  console.log(lines.join('\n'));
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`relay: ${err.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  let relay;
  try {
    relay = await startRelay(opts);
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`relay: port ${opts.port ?? 4317} is busy — another relay running? Try --port ${(opts.port ?? 4317) + 1}`);
    } else if (err.code === 'EADDRNOTAVAIL') {
      console.error(`relay: ${opts.host} is not an address of this machine (use 0.0.0.0)`);
    } else {
      console.error(`relay: ${err.message}`);
    }
    process.exit(1);
  }
  banner(relay);

  // Booth uptime beats purity: log unexpected errors and keep serving.
  process.on('uncaughtException', (err) => console.error(`[${stamp()}] ! unexpected error (still running):`, err));

  let stopping = false;
  const stop = async (signal) => {
    if (stopping) process.exit(130); // second Ctrl+C: leave now
    stopping = true;
    console.log(`\n[${stamp()}] ${signal} — closing streams and flushing data…`);
    await relay.close();
    const c = relay.counts();
    console.log(`[${stamp()}] stopped · leads this run ${c.leadsThisRun} · ${c.leadsInFile} in ${relay.dataDir}`);
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) main();
