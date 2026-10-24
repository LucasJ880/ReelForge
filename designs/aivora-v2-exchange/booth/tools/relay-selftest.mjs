#!/usr/bin/env node
/*
 * Self-test for booth/relay.mjs — run the night before the show.
 *   node designs/aivora-v2-exchange/booth/tools/relay-selftest.mjs
 *
 * Spawns the relay on a random port with a throw-away data dir (never ~/.aivora-booth),
 * exercises static/bus/session/lead routes, Ctrl+C shutdown and restart persistence,
 * then exits 0 (all green) or 1.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RELAY = path.resolve(HERE, '..', 'relay.mjs');
const ROOT = path.resolve(HERE, '..', '..'); // designs/aivora-v2-exchange
const SELF_URL = '/booth/tools/relay-selftest.mjs';
const SECRET_EMAIL = `selftest-${process.pid}@example.invalid`;
const SECRET_PHONE = '+1 604 555 0199';

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  FAIL  ${name}\n        ${String(err && err.message ? err.message : err).split('\n').join('\n        ')}`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function request(port, { method = 'GET', path: p, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    const h = { ...headers };
    if (payload !== undefined && !Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/json';
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json;
        try {
          json = JSON.parse(buf.toString('utf8'));
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: buf, text: buf.toString('utf8'), json });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error(`timeout ${method} ${p}`)));
    req.end(payload);
  });
}

/** Minimal SSE client: collects parsed events, lets tests await the next matching one. */
function subscribe(port, room, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: `/bus/events?room=${room}`, agent: false, headers: { Accept: 'text/event-stream', ...headers } },
      (res) => {
        if (res.statusCode !== 200) return reject(new Error(`subscribe ${room}: HTTP ${res.statusCode}`));
        res.setEncoding('utf8');
        const sub = {
          res,
          headers: res.headers,
          events: [],
          waiters: [],
          ended: false,
          close: () => req.destroy(),
          next(pred = (e) => e.data !== undefined, ms = 3000) {
            const hit = sub.events.find(pred);
            if (hit) {
              sub.events.splice(sub.events.indexOf(hit), 1);
              return Promise.resolve(hit);
            }
            return new Promise((res2, rej2) => {
              const w = { pred, res: res2 };
              sub.waiters.push(w);
              setTimeout(() => {
                const i = sub.waiters.indexOf(w);
                if (i !== -1) {
                  sub.waiters.splice(i, 1);
                  rej2(new Error(`no matching SSE event in ${ms} ms`));
                }
              }, ms);
            });
          },
        };
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk;
          let i;
          while ((i = buf.indexOf('\n\n')) !== -1) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = { comments: [] };
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) ev.comments.push(line.slice(1).trim());
              else if (line.startsWith('data:')) ev.data = (ev.data === undefined ? '' : ev.data + '\n') + line.slice(5).replace(/^ /, '');
              else if (line.startsWith('id:')) ev.id = line.slice(3).trim();
              else if (line.startsWith('retry:')) ev.retry = Number(line.slice(6));
            }
            const w = sub.waiters.find((x) => x.pred(ev));
            if (w) {
              sub.waiters.splice(sub.waiters.indexOf(w), 1);
              w.res(ev);
            } else sub.events.push(ev);
          }
        });
        res.on('close', () => (sub.ended = true));
        resolve(sub);
      },
    );
    req.on('error', reject);
  });
}

/** Raw HTTP/1.1 exchange, for request targets Node's client refuses to send. Resolves the status line. */
function raw(port, text) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => s.end(text));
    let out = '';
    s.setEncoding('latin1');
    s.on('data', (d) => (out += d));
    s.on('end', () => resolve(out.split('\r\n')[0]));
    s.on('error', reject);
    s.setTimeout(3000, () => s.destroy(new Error('raw timeout')));
  });
}

/**
 * POST a chunked body (no Content-Length) of `total` bytes. Resolves the status code, or 'reset'
 * when the relay hung up mid-upload (it answers 413 and closes instead of draining the body).
 */
function postChunked(port, p, total) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: p, agent: false, headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', (err) => (err.code === 'EPIPE' || err.code === 'ECONNRESET' ? resolve('reset') : reject(err)));
    req.setTimeout(5000, () => req.destroy(new Error('chunked timeout')));
    req.write('{"pad":"');
    const piece = 'x'.repeat(8192);
    let sent = 0;
    const pump = () => {
      while (sent < total) {
        sent += piece.length;
        if (!req.write(piece)) return void req.once('drain', pump);
      }
      req.end('"}');
    };
    pump();
  });
}

function startRelay(port, dataDir, extra = []) {
  const child = spawn(process.execPath, [RELAY, '--port', String(port), '--host', '127.0.0.1', '--data-dir', dataDir, ...extra], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const proc = { child, out: '', exited: null };
  child.stdout.on('data', (d) => (proc.out += d));
  child.stderr.on('data', (d) => (proc.out += d));
  proc.exit = new Promise((resolve) => child.on('exit', (code, signal) => resolve((proc.exited = { code, signal }))));
  return proc;
}

async function waitReady(port, proc, ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (proc.exited) throw new Error(`relay exited early (${JSON.stringify(proc.exited)}):\n${proc.out}`);
    try {
      const r = await request(port, { path: '/bus/ping' });
      if (r.status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`relay not ready after ${ms} ms:\n${proc.out}`);
}

async function stopRelay(proc, ms = 4000) {
  if (proc.exited) return proc.exited;
  proc.child.kill('SIGINT');
  const timer = new Promise((resolve) => setTimeout(() => resolve('timeout'), ms));
  const r = await Promise.race([proc.exit, timer]);
  if (r === 'timeout') {
    proc.child.kill('SIGKILL');
    throw new Error(`relay did not exit within ${ms} ms of SIGINT`);
  }
  return r;
}

async function main() {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aivora-relay-selftest-'));
  const port = await freePort();
  console.log(`relay self-test · port ${port} · data ${dataDir}\n`);
  let proc = startRelay(port, dataDir);
  let sessionId;
  // Never hang the night before the show: a stuck check fails the whole run after 60 s.
  setTimeout(() => {
    console.log(`\n  FAIL  self-test timed out after 60 s (last passing check: ${results.at(-1)?.name || 'none'})`);
    try {
      proc.child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
    process.exit(1);
  }, 60_000).unref();

  try {
    await waitReady(port, proc);

    await check('GET /bus/ping → {ok, relay:"aivora-booth", version:1}', async () => {
      const r = await request(port, { path: '/bus/ping' });
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, { ok: true, relay: 'aivora-booth', version: 1 });
    });

    await check('startup banner prints the /booth/index.html URL', async () => {
      assert.match(proc.out, new RegExp(`http://127\\.0\\.0\\.1:${port}/booth/index\\.html`));
    });

    await check('GET / → 302 /booth/index.html', async () => {
      const r = await request(port, { path: '/' });
      assert.equal(r.status, 302);
      assert.equal(r.headers.location, '/booth/index.html');
    });

    await check('static file served with JS content type', async () => {
      const r = await request(port, { path: SELF_URL });
      assert.equal(r.status, 200);
      assert.match(r.headers['content-type'], /^text\/javascript/);
      assert.equal(r.body.length, fs.statSync(fileURLToPath(import.meta.url)).size);
      const again = await request(port, { path: SELF_URL, headers: { 'If-None-Match': r.headers.etag } });
      assert.equal(again.status, 304, 'conditional GET should be 304');
    });

    const mp4 = ['media', 'booth/media']
      .flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d)).map((f) => `${d}/${f}`) : []))
      .find((f) => f.endsWith('.mp4'));
    await check(`video Range requests (${mp4 || 'no mp4 found, using a .mjs file'})`, async () => {
      const url = '/' + (mp4 || 'booth/tools/relay-selftest.mjs');
      const size = fs.statSync(path.join(ROOT, url)).size;
      const a = await request(port, { path: url, headers: { Range: 'bytes=0-1' } });
      assert.equal(a.status, 206);
      assert.equal(a.headers['content-range'], `bytes 0-1/${size}`);
      assert.equal(a.body.length, 2);
      assert.equal(a.headers['accept-ranges'], 'bytes');
      if (mp4) assert.equal(a.headers['content-type'], 'video/mp4');
      const b = await request(port, { path: url, headers: { Range: 'bytes=-10' } });
      assert.equal(b.status, 206);
      assert.equal(b.headers['content-range'], `bytes ${size - 10}-${size - 1}/${size}`);
      const c = await request(port, { path: url, headers: { Range: `bytes=${size}-` } });
      assert.equal(c.status, 416);
      const h = await request(port, { method: 'HEAD', path: url });
      assert.equal(h.status, 200);
      assert.equal(Number(h.headers['content-length']), size);
      assert.equal(h.body.length, 0);
    });

    await check('Range abuse: multi-range, garbage, reversed, huge numbers, -0, If-Range mismatch', async () => {
      const url = '/' + (mp4 || 'booth/tools/relay-selftest.mjs');
      const size = fs.statSync(path.join(ROOT, url)).size;
      const huge = '9'.repeat(400);
      const cases = [
        ['bytes=0-1,5-9', 200, size], // multi-range: whole file, never multipart
        ['bytes=5-3', 200, size],
        ['items=0-1', 200, size],
        ['bytes=0x10-0x20', 200, size],
        ['bytes=-0', 416, 0],
        [`bytes=${huge}-`, 416, 0],
        [`bytes=0-${huge}`, 206, size],
        [`bytes=-${huge}`, 206, size],
        ['bytes=0-0', 206, 1],
      ];
      for (const [range, status, len] of cases) {
        const r = await request(port, { path: url, headers: { Range: range } });
        assert.equal(r.status, status, `${range.slice(0, 30)} → ${r.status}`);
        assert.equal(r.body.length, len, `${range.slice(0, 30)} body ${r.body.length}`);
      }
      const ir = await request(port, { path: url, headers: { Range: 'bytes=0-1', 'If-Range': '"stale"' } });
      assert.equal(ir.status, 200, 'If-Range mismatch must send the whole file');
    });

    await check('path traversal blocked (raw + encoded + double-encoded)', async () => {
      const pkgName = JSON.parse(fs.readFileSync(path.resolve(ROOT, '..', '..', 'package.json'), 'utf8')).name;
      for (const p of [
        '/../../package.json',
        '/../../../package.json',
        '/%2e%2e/%2e%2e/package.json',
        '/booth/..%2f..%2f..%2fpackage.json',
        '/%2E%2E%2F%2E%2E%2Fpackage.json',
        '/booth/%252e%252e/%252e%252e/%252e%252e/package.json',
        '/media/../../../CLAUDE.md',
      ]) {
        const r = await request(port, { path: p });
        assert.ok([403, 404].includes(r.status), `${p} → ${r.status} (want 403/404)`);
        assert.ok(!r.text.includes(pkgName) && !r.text.includes('Aivora — AI agent'), `${p} leaked repo content`);
      }
      const bs = await request(port, { path: '/..\\..\\package.json' });
      assert.ok(bs.status >= 400 && bs.status < 500, `backslash variant → ${bs.status}`);
    });

    await check('path tricks: NUL, %5c, drive letter, NTFS stream, overlong UTF-8, absolute-form, //', async () => {
      for (const [p, want] of [
        ['/booth/booth.js%00.png', 400],
        ['/booth/%00', 400],
        ['/booth/..%5c..%5c..%5cpackage.json', 400],
        ['/booth/%2e%2e%5c%2e%2e%5cpackage.json', 400],
        ['/C:/Windows/win.ini', 400],
        ['/booth/booth.js::$DATA', 400],
        ['/booth/%c0%ae%c0%ae/%c0%ae%c0%ae/package.json', 400],
        ['//etc/passwd', 404],
        ['/%2Fetc%2Fpasswd', 404],
        ['/booth/.%2frelay.mjs', 404],
      ]) {
        const r = await request(port, { path: p });
        assert.equal(r.status, want, `${p} → ${r.status}`);
      }
      assert.match(await raw(port, 'GET http://evil.example/../../package.json HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'), / 400 /);
      assert.match(await raw(port, 'GET /../../../package.json HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'), / 403 /);
      assert.match(await raw(port, 'GET /booth/..\\..\\..\\package.json HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'), / 400 /);
    });

    await check('Host header: DNS-rebinding names → 421; IP, localhost, *.local, own hostname accepted', async () => {
      for (const host of ['attacker.example', `attacker.example:${port}`, 'evil.127.0.0.1.nip.io', 'localhost.attacker.example']) {
        for (const p of ['/booth/index.html', '/api/info', '/bus/ping']) {
          const r = await request(port, { path: p, headers: { Host: host } });
          assert.equal(r.status, 421, `Host ${host} ${p} → ${r.status}`);
        }
      }
      for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `booth-laptop.local:${port}`, `[::1]:${port}`, `${os.hostname()}:${port}`]) {
        const r = await request(port, { path: '/bus/ping', headers: { Host: host } });
        assert.equal(r.status, 200, `Host ${host} → ${r.status}`);
      }
    });

    await check('no dotfiles, no directory listing, no non-web file types', async () => {
      for (const p of ['/.impeccable/design.json', '/booth/.DS_Store', '/%2eimpeccable/design.json', '/media/', '/booth/tools/', '/DESIGN.md']) {
        const r = await request(port, { path: p });
        assert.ok(r.status === 404 || r.status === 403, `${p} → ${r.status}`);
      }
    });

    await check('API rejects non-JSON (415), bad JSON (400), oversize (413), bad room (400)', async () => {
      const a = await request(port, { method: 'POST', path: '/bus/send?room=booth', headers: { 'Content-Type': 'text/plain' }, body: '{"a":1}' });
      assert.equal(a.status, 415);
      const b = await request(port, { method: 'POST', path: '/api/session', body: '{nope' });
      assert.equal(b.status, 400);
      assert.equal(b.json && b.json.error, 'invalid_json');
      const c = await request(port, { method: 'POST', path: '/bus/send?room=booth', body: { pad: 'x'.repeat(17 * 1024) } });
      assert.equal(c.status, 413);
      const d = await request(port, { method: 'POST', path: '/bus/send?room=Bad_Room', body: { a: 1 } });
      assert.equal(d.status, 400);
      const e = await request(port, { path: '/bus/events?room=../x' });
      assert.equal(e.status, 400);
    });

    await check('oversize chunked body (no Content-Length) → 413; JSON nested > 64 deep → 400, no 500', async () => {
      assert.equal(await postChunked(port, '/api/session', 64 * 1024), 413);
      const big = await postChunked(port, '/bus/send?room=booth', 2 * 1024 * 1024);
      assert.ok(big === 413 || big === 'reset', `2 MB chunked upload → ${big}`);
      assert.equal((await request(port, { path: '/bus/ping' })).status, 200, 'relay still answering');
      const deep = '['.repeat(8000) + ']'.repeat(8000); // < 16 KB, used to crash JSON.stringify → 500
      const r = await request(port, { method: 'POST', path: '/bus/send?room=booth', body: deep });
      assert.equal(r.status, 400, `deep JSON → ${r.status}`);
      assert.equal(r.json && r.json.error, 'too_deep');
      const ok = await request(port, { method: 'POST', path: '/bus/send?room=booth', body: '['.repeat(60) + ']'.repeat(60) });
      assert.equal(ok.status, 204, 'normal nesting still accepted');
      assert.ok(!/internal error/.test(proc.out), 'no internal error logged');
    });

    await check('SSE room names with CR/LF/NUL/uppercase/unicode/33 chars → 400', async () => {
      for (const room of ['booth%0d%0aevil', 'booth%0a', 'booth%0d%0adata:%20x', 'booth%00', 'BOOTH', '%E5%B1%95', 'a'.repeat(33), 'a%20b', 'booth%2f..']) {
        const r = await request(port, { path: `/bus/events?room=${room}` });
        assert.equal(r.status, 400, `events room=${room} → ${r.status}`);
        const s = await request(port, { method: 'POST', path: `/bus/send?room=${room}`, body: { a: 1 } });
        assert.equal(s.status, 400, `send room=${room} → ${s.status}`);
      }
    });

    await check('CORS: public websites refused (preflight, POST, SSE, reads); LAN pages on another port allowed', async () => {
      const spy = await subscribe(port, 'selftest');
      try {
        for (const origin of ['https://evil.example', 'http://8.8.8.8', 'null', 'http://192.168.1.5.nip.io', 'file://']) {
          const pre = await request(port, { method: 'OPTIONS', path: '/bus/send?room=selftest', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
          assert.equal(pre.status, 403, `preflight from ${origin} → ${pre.status}`);
          assert.equal(pre.headers['access-control-allow-origin'], undefined, `ACAO granted to ${origin}`);
          const post = await request(port, { method: 'POST', path: '/bus/send?room=selftest', headers: { Origin: origin }, body: { type: 'comment', text: 'injected' } });
          assert.equal(post.status, 403, `POST from ${origin} → ${post.status}`);
          for (const p of ['/bus/events?room=selftest', '/api/info', '/api/session/abcdefgh']) {
            const g = await request(port, { path: p, headers: { Origin: origin } });
            assert.equal(g.status, 403, `GET ${p} from ${origin} → ${g.status}`);
          }
        }
        await assert.rejects(spy.next(undefined, 300), 'a refused origin must not reach the bus');
        for (const origin of ['http://192.168.1.50:8080', 'http://10.0.0.7', 'http://172.20.10.2:3000', 'http://localhost:5173', 'http://booth-ipad.local']) {
          const pre = await request(port, { method: 'OPTIONS', path: '/bus/send?room=selftest', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
          assert.equal(pre.status, 204, `preflight from ${origin} → ${pre.status}`);
          assert.equal(pre.headers['access-control-allow-origin'], origin);
          assert.match(String(pre.headers.vary), /Origin/);
        }
        const same = await request(port, { method: 'POST', path: '/bus/send?room=selftest', headers: { Origin: `http://127.0.0.1:${port}` }, body: { type: 'same-origin' } });
        assert.equal(same.status, 204, 'same-origin POST');
        assert.equal(JSON.parse((await spy.next()).data).type, 'same-origin');
        // Referrer-Policy: no-referrer can make a same-origin POST say "Origin: null"; Sec-Fetch-Site tells the truth.
        const nul = await request(port, { method: 'POST', path: '/bus/send?room=selftest', headers: { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' }, body: { type: 'null-same-origin' } });
        assert.equal(nul.status, 204, 'Origin null + Sec-Fetch-Site same-origin');
        assert.equal(JSON.parse((await spy.next()).data).type, 'null-same-origin');
      } finally {
        spy.close();
      }
    });

    let firstId;
    await check('SSE round-trip: subscribe → send → receive (room-scoped)', async () => {
      const subA = await subscribe(port, 'selftest');
      const subB = await subscribe(port, 'other-room');
      try {
        assert.match(subA.headers['content-type'], /^text\/event-stream/);
        assert.match(subA.headers['cache-control'], /no-cache/);
        await subA.next((e) => e.comments.some((c) => c.startsWith('aivora-booth')));
        const msg = { type: 'selftest', n: Math.random(), text: '你好 booth\nline2\r\n\ndata: forged  \u0085', nested: { ok: true } };
        const r = await request(port, { method: 'POST', path: '/bus/send?room=selftest', body: JSON.stringify(msg, null, 2) });
        assert.equal(r.status, 204);
        const ev = await subA.next();
        assert.equal(ev.data, JSON.stringify(msg), 'payload must arrive as one data: line, unchanged');
        assert.deepEqual(JSON.parse(ev.data), msg);
        assert.ok(ev.id, 'event carries an id for reconnect replay');
        firstId = ev.id;
        await assert.rejects(subB.next(undefined, 400), 'other room must not receive it');
      } finally {
        subA.close();
        subB.close();
      }
    });

    await check('SSE reconnect with Last-Event-ID replays missed messages', async () => {
      assert.ok(firstId, 'needs the previous check');
      const missed = { type: 'missed', at: Date.now() };
      const r = await request(port, { method: 'POST', path: '/bus/send?room=selftest', body: missed });
      assert.equal(r.status, 204);
      const sub = await subscribe(port, 'selftest', { 'Last-Event-ID': firstId });
      try {
        const ev = await sub.next();
        assert.deepEqual(JSON.parse(ev.data), missed);
      } finally {
        sub.close();
      }
      const fresh = await subscribe(port, 'selftest');
      try {
        await assert.rejects(fresh.next(undefined, 400), 'a fresh subscriber must not get old messages');
      } finally {
        fresh.close();
      }
    });

    await check('session create → read → unknown 404', async () => {
      const payload = { biz: 'window-cleaning', lang: 'zh', chain: ['video', 'post', 'booked'], secs: 41 };
      const c = await request(port, { method: 'POST', path: '/api/session', body: payload });
      assert.equal(c.status, 201);
      assert.match(c.json.id, /^[a-z2-7]{8}$/);
      sessionId = c.json.id;
      const r = await request(port, { path: `/api/session/${sessionId}` });
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, payload);
      assert.equal((await request(port, { path: '/api/session/zzzzzzzz' })).status, 404);
      assert.equal((await request(port, { path: '/api/session/..%2f..' })).status, 404);
      assert.equal((await request(port, { method: 'POST', path: '/api/session', body: [1, 2] })).status, 400);
      const lines = fs.readFileSync(path.join(dataDir, 'sessions.jsonl'), 'utf8').trim().split('\n');
      assert.equal(JSON.parse(lines.at(-1)).id, sessionId);
    });

    await check('lead validation: missing/false consent, no contact, bad types → 400', async () => {
      const base = { lang: 'en', sid: sessionId || 'abcdefgh' };
      const cases = [
        [{ ...base, email: SECRET_EMAIL }, 'consentEmail'], // consent fields missing
        [{ ...base, email: SECRET_EMAIL, consentEmail: false, consentWhatsApp: false }, 'consent_required'],
        [{ ...base, whatsapp: SECRET_PHONE, consentEmail: true, consentWhatsApp: false }, 'consent_required'],
        [{ ...base, consentEmail: true, consentWhatsApp: true }, 'contact_required'],
        [{ ...base, email: 'not-an-email', consentEmail: true, consentWhatsApp: false }, 'email'],
        [{ ...base, email: SECRET_EMAIL, consentEmail: 'yes', consentWhatsApp: false }, 'consentEmail'],
        [{ ...base, lang: 7, email: SECRET_EMAIL, consentEmail: true, consentWhatsApp: false }, 'lang'],
        [{ ...base, wechat: 'wx_aivora01', consentEmail: false, consentWhatsApp: false }, 'consent_required'],
        [{ ...base, wechat: '1bad', consentEmail: false, consentWhatsApp: false, consentWeChat: true }, 'wechat'],
        [{ ...base, wechat: 'wx_aivora01', consentEmail: false, consentWhatsApp: false, consentWeChat: 'yes' }, 'consentWeChat'],
      ];
      for (const [body, expect] of cases) {
        const r = await request(port, { method: 'POST', path: '/api/lead', body });
        assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.status}`);
        assert.ok(r.json && (r.json.error === expect || r.json.field === expect), `expected ${expect}, got ${r.text}`);
      }
      assert.ok(!fs.existsSync(path.join(dataDir, 'leads.jsonl')), 'rejected leads must not be written');
    });

    await check('valid lead → 201, stored with server ts, unconsented contact dropped', async () => {
      const r = await request(port, {
        method: 'POST',
        path: '/api/lead',
        body: { lang: 'zh', sid: sessionId, email: SECRET_EMAIL, whatsapp: SECRET_PHONE, consentEmail: true, consentWhatsApp: false, note: '想看清洁行业案例' },
      });
      assert.equal(r.status, 201);
      assert.deepEqual(r.json, { ok: true });
      const lines = fs.readFileSync(path.join(dataDir, 'leads.jsonl'), 'utf8').trim().split('\n');
      assert.equal(lines.length, 1);
      const lead = JSON.parse(lines[0]);
      assert.equal(lead.email, SECRET_EMAIL);
      assert.equal(lead.whatsapp, undefined, 'WhatsApp without consent must not be stored');
      assert.equal(lead.sessionKnown, true);
      assert.ok(Math.abs(Date.parse(lead.ts) - Date.now()) < 60_000, 'server timestamp');
      const mode = fs.statSync(path.join(dataDir, 'leads.jsonl')).mode & 0o777;
      assert.equal(mode & 0o077, 0, `leads.jsonl should be private, mode ${mode.toString(8)}`);
    });

    await check('GET /api/info exposes counts only', async () => {
      const r = await request(port, { path: '/api/info' });
      assert.equal(r.status, 200);
      assert.equal(r.json.leads, 1);
      assert.ok(Array.isArray(r.json.origins));
      assert.ok(!r.text.includes(SECRET_EMAIL));
    });

    await check('WeChat-only lead with its own consent → 201 and stored', async () => {
      const before = fs.existsSync(path.join(dataDir, 'leads.jsonl')) ? fs.readFileSync(path.join(dataDir, 'leads.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length : 0;
      const r = await request(port, { method: 'POST', path: '/api/lead', body: { lang: 'zh', wechat: 'wx_aivora01', consentEmail: false, consentWhatsApp: false, consentWeChat: true } });
      assert.equal(r.status, 201, r.text);
      const lines = fs.readFileSync(path.join(dataDir, 'leads.jsonl'), 'utf8').trim().split('\n');
      assert.equal(lines.length, before + 1);
      const lead = JSON.parse(lines.at(-1));
      assert.equal(lead.wechat, 'wx_aivora01');
      assert.equal(lead.consentWeChat, true);
      assert.equal(lead.sid, null);
    });

    await check('lead from a self-contained ?d= link (sid null/absent) is stored; control chars in email → 400', async () => {
      const file = path.join(dataDir, 'leads.jsonl');
      const before = fs.readFileSync(file, 'utf8').trim().split('\n').length;
      const a = await request(port, { method: 'POST', path: '/api/lead', body: { lang: 'en', sid: null, whatsapp: SECRET_PHONE, consentEmail: false, consentWhatsApp: true } });
      assert.equal(a.status, 201, `sid null → ${a.text}`);
      const b = await request(port, { method: 'POST', path: '/api/lead', body: { lang: 'zh', email: SECRET_EMAIL, consentEmail: true, consentWhatsApp: false } });
      assert.equal(b.status, 201, `sid absent → ${b.text}`);
      for (const email of [`x\u001b[31m${SECRET_EMAIL}`, `${SECRET_EMAIL}\u0000`, `a ${SECRET_EMAIL}`]) {
        const c = await request(port, { method: 'POST', path: '/api/lead', body: { lang: 'en', sid: null, email, consentEmail: true, consentWhatsApp: false } });
        assert.equal(c.status, 400, `control char email → ${c.status}`);
        assert.equal(c.json.field, 'email');
      }
      const bad = await request(port, { method: 'POST', path: '/api/lead', body: { lang: 'en', sid: { $ne: 1 }, email: SECRET_EMAIL, consentEmail: true, consentWhatsApp: false } });
      assert.equal(bad.status, 400, 'non-string sid still rejected');
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
      assert.equal(lines.length, before + 2);
      const last = JSON.parse(lines.at(-2));
      assert.equal(last.sid, null);
      assert.equal(last.whatsapp, SECRET_PHONE);
      assert.equal(last.sessionKnown, false);
    });

    await check('session id guessing: unknown ids cost a token → 429 (even for real ids) once spent', async () => {
      let limited = null;
      for (let i = 0; i < 60 && !limited; i++) {
        const r = await request(port, { path: `/api/session/${'abcdefg'}${'234567'[i % 6]}` });
        if (r.status === 429) limited = { r, i };
        else assert.equal(r.status, 404);
      }
      assert.ok(limited, 'expected 429 within 60 unknown-id lookups');
      assert.ok(limited.i <= 31, `429 only after ${limited.i} misses`);
      assert.ok(Number(limited.r.headers['retry-after']) >= 1);
      const real = await request(port, { path: `/api/session/${sessionId}` });
      assert.equal(real.status, 429, 'while blocked, hits must not be distinguishable from misses');
    });

    await check('one device cannot hold every SSE slot; a room flood cannot lock out "booth"', async () => {
      const subs = [];
      try {
        for (let i = 0; i < 16; i++) subs.push(await subscribe(port, 'selftest'));
        const extra = await request(port, { path: '/bus/events?room=selftest' });
        assert.equal(extra.status, 503, `17th stream from one device → ${extra.status}`);
        assert.equal(extra.json && extra.json.error, 'too_many_streams_from_device');
      } finally {
        for (const s of subs) s.close();
      }
      await new Promise((r) => setTimeout(r, 150));
      const codes = [];
      for (let i = 0; i < 40; i++) codes.push((await request(port, { method: 'POST', path: `/bus/send?room=flood-${i}`, body: { i } })).status);
      assert.ok(codes.includes(503), 'room table should fill up');
      const b = await subscribe(port, 'booth'); // rejects on non-200
      b.close();
      await new Promise((r) => setTimeout(r, 100));
    });

    await check('per-IP POST rate limit → 429 with Retry-After', async () => {
      let limited = null;
      for (let i = 0; i < 80 && !limited; i++) {
        const r = await request(port, { method: 'POST', path: '/api/lead', body: {} });
        if (r.status === 429) limited = r;
      }
      assert.ok(limited, 'expected a 429 within 80 POSTs');
      assert.ok(Number(limited.headers['retry-after']) >= 1);
    });

    await check('SIGINT: open SSE streams close, process exits 0', async () => {
      const sub = await subscribe(port, 'booth');
      const r = await stopRelay(proc);
      assert.equal(r.code, 0, `exit ${JSON.stringify(r)}`);
      await new Promise((res) => setTimeout(res, 100));
      assert.ok(sub.ended, 'SSE stream should be closed by shutdown');
    });

    await check('contact fields never reach the relay log', async () => {
      assert.ok(!proc.out.includes(SECRET_EMAIL), 'email leaked to stdout/stderr');
      assert.ok(!proc.out.includes(SECRET_PHONE), 'phone leaked to stdout/stderr');
      assert.match(proc.out, /lead saved/);
    });

    await check('restart: sessions survive; over-long/corrupt jsonl lines skipped; lead file re-tightened', async () => {
      // Damage the data the way a crash or a flood would: a 200 KB line with no JSON, a torn line.
      const after = JSON.stringify({ id: 'zzzz2345', ts: new Date().toISOString(), data: { after: true } });
      fs.appendFileSync(path.join(dataDir, 'sessions.jsonl'), 'x'.repeat(200 * 1024) + '\n' + after + '\n{"id":"abcdefgh","da\n');
      fs.chmodSync(path.join(dataDir, 'leads.jsonl'), 0o644);
      proc = startRelay(port, dataDir, ['--verbose', '--allow-host', 'booth.lan']);
      await waitReady(port, proc);
      const r = await request(port, { path: `/api/session/${sessionId}` });
      assert.equal(r.status, 200);
      assert.equal(r.json.biz, 'window-cleaning');
      assert.deepEqual((await request(port, { path: '/api/session/zzzz2345' })).json, { after: true }, 'line after the over-long one still loads');
      assert.match(proc.out, /skipped 2 unreadable line/);
      assert.match(proc.out, /leads 4\)/, 'lead count read from file');
      assert.equal(fs.statSync(path.join(dataDir, 'leads.jsonl')).mode & 0o077, 0, 'leads.jsonl made private again');
      assert.equal((await request(port, { path: '/bus/ping', headers: { Host: `booth.lan:${port}` } })).status, 200, '--allow-host name accepted');
      assert.equal((await request(port, { path: '/bus/ping', headers: { Host: 'other.lan' } })).status, 421, 'other names still refused');
    });

    await check('--verbose: bus "type" cannot smuggle escape codes, fake lines or contacts into the log', async () => {
      const evil = `\u001b[2J\n[00:00:00] api  lead saved · ${SECRET_EMAIL}`;
      const r = await request(port, { method: 'POST', path: '/bus/send?room=booth', body: { type: evil, email: SECRET_EMAIL } });
      assert.equal(r.status, 204);
      await new Promise((res) => setTimeout(res, 100));
      assert.match(proc.out, /bus {2}> booth · /);
      assert.ok(!proc.out.includes('\u001b'), 'escape code reached the log');
      assert.ok(!proc.out.includes(SECRET_EMAIL), 'email reached the log');
      assert.ok(!/\n\[00:00:00\]/.test(proc.out), 'forged log line');
      assert.equal((await stopRelay(proc)).code, 0);
    });

    await check('data dir reached through a symlink into the repo is refused before anything is created', async () => {
      const link = path.join(dataDir, 'link-into-repo');
      fs.symlinkSync(path.join(ROOT, 'booth'), link, 'dir');
      const target = path.join(ROOT, 'booth', `.relay-selftest-must-not-exist-${process.pid}`);
      try {
        const p = startRelay(0, path.join(link, path.basename(target), 'data'));
        const done = await Promise.race([p.exit, new Promise((r) => setTimeout(() => r('timeout'), 5000))]);
        if (done === 'timeout') p.child.kill('SIGKILL');
        assert.equal(done.code, 1, `relay should refuse, got ${JSON.stringify(done)}`);
        assert.match(p.out, /inside the repository/);
        assert.ok(!fs.existsSync(target), `created ${target}`);
      } finally {
        fs.rmSync(target, { recursive: true, force: true });
        fs.unlinkSync(link);
      }
    });
  } finally {
    if (!proc.exited) {
      proc.child.kill('SIGKILL');
      await proc.exit;
    }
    await fsp.rm(dataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` · ${failed.length} FAILED` : ''}`);
  if (failed.length) {
    console.log('\n--- relay output ---\n' + proc.out);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('self-test crashed:', err);
  process.exit(1);
});
