// Local control panel. Start with:  npm start   then open http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createBot } = require('./e2e/bot');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const APP_USERNAME = process.env.APP_USERNAME || 'admin';
const APP_PASSWORD = process.env.APP_PASSWORD;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

if (!LOOPBACK_HOSTS.has(HOST) && !APP_PASSWORD) {
    throw new Error('APP_PASSWORD is required when HOST is not a loopback address.');
}
if (APP_PASSWORD && Buffer.byteLength(APP_PASSWORD, 'utf8') < 16) {
    throw new Error('APP_PASSWORD must be at least 16 characters long.');
}

const REL = { father: 1, mother: 1, son: 1, daughter: 1, brother: 1, sister: 1, spouse: 1 };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Four fully independent bots. Each has its own browser, config, status and console log.
const BOT_COUNT = 4;
const bots = {};
for (let i = 1; i <= BOT_COUNT; i++) {
    bots[i] = { id: i, running: false, logs: [], username: '', runner: createBot(i) };
}
const clients = new Set();

// The bots must never crash the server, whatever a browser or the website does.
process.on('uncaughtException', (e) => console.error('Uncaught exception (ignored):', e && e.stack || e));
process.on('unhandledRejection', (e) => console.error('Unhandled rejection (ignored):', e && e.stack || e));

function safeEqual(actual, expected) {
    const actualBuffer = Buffer.from(actual, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    return actualBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function isAuthorized(req) {
    if (!APP_PASSWORD) return true;
    const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(req.headers.authorization || '');
    if (!match) return false;

    const credentials = Buffer.from(match[1], 'base64').toString('utf8');
    const separator = credentials.indexOf(':');
    if (separator < 0) return false;

    return safeEqual(credentials.slice(0, separator), APP_USERNAME)
        && safeEqual(credentials.slice(separator + 1), APP_PASSWORD);
}

const pad = (n) => String(n).padStart(2, '0');
function stamp(text) {
    const d = new Date();
    const t = `[${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}] `;
    return String(text).replace(/^(\n*)/, `$1${t}`);
}

function emit(botId, type, data) {
    if (type === 'log') {
        data = stamp(data);
        const b = bots[botId];
        b.logs.push(data);
        if (b.logs.length > 2000) b.logs.shift();
    }
    const line = JSON.stringify({ bot: botId, type, data });
    for (const c of clients) c.write(`data: ${line}\n\n`);
}

function startBot(botId, cfg) {
    const b = bots[botId];
    b.running = true; b.logs = []; b.username = cfg.username;
    emit(botId, 'status', { running: true });
    for (const other of Object.values(bots)) {
        if (other.id !== botId && other.running && other.username === cfg.username) {
            emit(botId, 'log', `⚠️ Bot ${other.id} is running with the SAME account. The wishlist belongs to the account, so the two bots can clear each other's wishlist. Use a different account per bot.`);
        }
    }
    b.runner.run(cfg, (line) => emit(botId, 'log', line))
        .catch((e) => emit(botId, 'log', `🛑 ${e.message}`))
        .finally(() => { b.running = false; emit(botId, 'status', { running: false }); });
}

function stopBot(botId) {
    const b = bots[botId];
    if (b.running) { emit(botId, 'log', '⏹ Stop requested...'); b.runner.stop(); }
}

function validate(b) {
    const err = [];
    if (!b.username || !b.password) err.push('Enter the username and password.');
    const dates = (b.dates || []).filter(Boolean).map((d) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
        if (!m) { err.push(`Invalid date: ${d}`); return null; }
        const day = String(parseInt(m[3], 10)), month = MONTHS[parseInt(m[2], 10) - 1];
        return { label: `${month} ${day}`, day, month, year: m[1] };
    }).filter(Boolean);
    if (!dates.length) err.push('Add at least one date.');
    const rows = [...new Set(String(b.pilgrimRows || '').split(/[\s,]+/).filter(Boolean).map(Number))];
    if (!rows.length || rows.some((n) => !Number.isInteger(n) || n < 1)) err.push('Pilgrim rows must be numbers from 1, e.g. 2,3,4,5.');
    const checkNominee = (n, who) => {
        if (!/^[a-zA-Z ]+$/.test(n.name || '') || n.name.length > 32) err.push(`${who}: name must be letters/spaces, max 32.`);
        if (!/^[0-9]{1,3}$/.test(String(n.age || ''))) err.push(`${who}: age must be 1 to 3 digits.`);
        if (!(String(n.relation || '').toLowerCase() in REL)) err.push(`${who}: choose a relation.`);
    };
    checkNominee(b.nominee || {}, 'Nominee');
    const overrides = {};
    for (const o of b.overrides || []) {
        checkNominee(o, `Row ${o.row} nominee`);
        overrides[o.row] = { name: o.name, age: String(o.age), relation: o.relation };
    }
    const slots = String(b.slots || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (b.slotMode === 'particular' && !slots.length) err.push('Add at least one preferred slot, or switch to Auto.');
    return { err, cfg: {
        username: b.username, password: b.password, dates, pilgrimRows: rows,
        nominee: { name: (b.nominee || {}).name, age: String((b.nominee || {}).age), relation: (b.nominee || {}).relation },
        overrides, slotMode: b.slotMode === 'particular' ? 'particular' : 'auto', slots,
        routeValue: String(b.routeValue || '1'),
        maxRetries: Math.min(100, Math.max(1, Math.floor(+b.maxRetries) || 5)),
        retryDelaySec: Math.max(1, +b.retryDelaySec || 5),
        cooldownSec: Math.max(1, +b.cooldownSec || 60),
        headless: b.headless !== false, useInstalledChrome: !!b.useInstalledChrome,
    } };
}

function readBody(req) {
    return new Promise((res) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { res(JSON.parse(d || '{}')); } catch { res({}); } }); });
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
    if (!isAuthorized(req)) {
        res.writeHead(401, {
            'WWW-Authenticate': 'Basic realm="Sabarimala Booking Console", charset="UTF-8"',
            'Cache-Control': 'no-store',
        });
        return res.end('Authentication required.');
    }

    const url = String(req.url || '').split('?')[0];

    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    }
    if (url === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        const init = {};
        for (const b of Object.values(bots)) init[b.id] = { running: b.running, logs: b.logs };
        res.write(`data: ${JSON.stringify({ type: 'init', data: { bots: init } })}\n\n`);
        clients.add(res);
        return req.on('close', () => clients.delete(res));
    }

    // POST /api/bots/<1-4>/start | /api/bots/<1-4>/stop   (/api/stop alone stops every bot)
    const m = /^\/api\/(?:bots\/(\d+)\/)?(start|stop)$/.exec(url);
    if (req.method === 'POST' && m) {
        const action = m[2];
        if (!m[1] && action === 'stop') {
            Object.keys(bots).forEach((id) => stopBot(+id));
            return json(res, 200, { ok: true });
        }
        const botId = m[1] ? parseInt(m[1], 10) : 1;
        if (!bots[botId]) return json(res, 404, { errors: [`There is no Bot ${botId}.`] });

        if (action === 'stop') {
            stopBot(botId);
            return json(res, 200, { ok: true });
        }
        if (bots[botId].running) return json(res, 409, { errors: [`Bot ${botId} is already running.`] });
        const { err, cfg } = validate(await readBody(req));
        if (err.length) return json(res, 400, { errors: err });
        startBot(botId, cfg);
        return json(res, 200, { ok: true });
    }
    res.writeHead(404); res.end('Not found');
}).listen(PORT, HOST, () => console.log(`Open http://localhost:${PORT}  (Bot 1-4 tabs, or http://localhost:${PORT}/#bot2 etc.)`));
