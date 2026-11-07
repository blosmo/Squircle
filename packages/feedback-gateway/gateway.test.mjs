import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateway, issueToken, openStore } from './gateway.mjs';
import { createFeedback } from '../feedback-web/index.mjs';
const secret = 's'.repeat(32), adminToken = 'a'.repeat(32);
const token = issueToken(secret, 'demo', 'customer');
const report = { requestID: 'request-123456789', kind: 'bug', text: 'Playback skips.', context: { screen: 'Reader' } };
function fixture(fetcher = async () => ({ ok: true, json: async () => ({ ok: true, data: { agent: { thread_id: 'internal-thread' } } }) }), path = ':memory:') {
  const db = openStore(path);
  const handler = createGateway({ db, secret, adminToken, apps: { demo: { project: 'project-123', mode: 'implement' }, other: { project: 'other', mode: 'propose' } }, squircleURL: 'http://127.0.0.1:3847', controlToken: 'private-control', fetcher });
  async function request(method, url, data, auth = token) {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    req.method = method; req.url = url; req.headers = { authorization: `Bearer ${auth}` };
    let status;
    return new Promise(resolve => handler(req, { writeHead: s => status = s, end: value => resolve({ status, body: JSON.parse(value) }) }));
  }
  return { db, request };
}
test('scoped customer submission dispatches to configured project and never returns secrets', async () => {
  let sent;
  const f = fixture(async (url, options) => {
    sent = JSON.parse(options.body);
    assert.equal(url.pathname, '/v1/agents');
    assert.equal(options.headers.Authorization, 'Bearer private-control');
    return { ok: true, json: async () => ({ ok: true, data: { agent: { thread_id: 'internal-thread' } } }) };
  });
  const response = await f.request('POST', '/v1/feedback', { ...report, project: 'injected-project' });
  assert.equal(response.status, 202); assert.equal(response.body.state, 'delivered');
  assert.equal(sent.project_id, 'project-123');
  assert.match(sent.message, /untrusted/); assert.match(sent.message, /Playback skips/);
  assert.doesNotMatch(JSON.stringify(response.body), /internal-thread|private-control|customer/);
  assert.equal((await f.request('GET', `/v1/feedback/${response.body.id}`, undefined, issueToken(secret, 'other', 'customer'))).status, 404);
  assert.equal((await f.request('GET', `/v1/feedback/${response.body.id}`, undefined, issueToken(secret, 'demo', 'stranger'))).status, 404);
  f.db.close();
});
test('same request is idempotent, changed content conflicts', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { ok: true, json: async () => ({ ok: true, data: { agent: { thread_id: 'thread' } } }) }; });
  const first = await f.request('POST', '/v1/feedback', report);
  assert.deepEqual(await f.request('POST', '/v1/feedback', report), first);
  assert.equal(calls, 1);
  assert.equal((await f.request('POST', '/v1/feedback', { ...report, text: 'Different' })).status, 409);
  f.db.close();
});
test('ambiguous delivery is not automatically retried, operator must reconcile', async () => {
  let calls = 0; const f = fixture(async () => { calls++; throw Error('Connection lost after commit'); });
  const first = await f.request('POST', '/v1/feedback', report);
  assert.equal(first.body.state, 'delivery_unknown');
  await f.request('POST', '/v1/feedback', report); assert.equal(calls, 1);
  const path = `/v1/admin/feedback/${first.body.id}`;
  assert.equal((await f.request('POST', path, { action: 'retry' }, adminToken)).status, 409);
  assert.equal((await f.request('POST', path, { state: 'ready', summary: 'Fixed in build 2' })).status, 401);
  assert.equal((await f.request('POST', path, { state: 'ready', summary: 'Fixed in build 2' }, adminToken)).body.result.summary, 'Fixed in build 2');
  f.db.close();
});
test('restart preserves reports and marks in-flight delivery unknown', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'feedback-'));
  try {
    const f = fixture(undefined, join(dir, 'reports.db'));
    const response = await f.request('POST', '/v1/feedback', report);
    f.db.prepare("UPDATE feedback SET state='dispatching'").run(); f.db.close();
    const second = fixture(undefined, join(dir, 'reports.db'));
    assert.equal((await second.request('GET', `/v1/feedback/${response.body.id}`)).body.state, 'delivery_unknown');
    second.db.close();
  } finally { rmSync(dir, { recursive: true }); }
});
test('rejects forged, expired, malformed, oversized and rate-limited submissions', async () => {
  const f = fixture();
  for (const auth of [token + 'x', issueToken(secret, 'demo', 'customer', 1)]) assert.equal((await f.request('POST', '/v1/feedback', report, auth)).status, 401);
  assert.equal((await f.request('POST', '/v1/feedback', { ...report, context: null })).status, 400);
  assert.equal((await f.request('POST', '/v1/feedback', { ...report, text: 'x'.repeat(17000) })).status, 413);
  for (let i = 0; i < 10; i++) assert.equal((await f.request('POST', '/v1/feedback', { ...report, requestID: `request-${String(i).padStart(16, '0')}` })).status, 202);
  assert.equal((await f.request('POST', '/v1/feedback', report)).status, 429);
  f.db.close();
});
test('web client submits and reads customer progress through gateway contract', async () => {
  const f = fixture();
  const client = createFeedback({ endpoint: 'https://feedback.example.com', token: async () => token, fetcher: async (url, options) => {
    const response = await f.request(options.method, url.pathname, options.body ? JSON.parse(options.body) : undefined, options.headers.Authorization.slice(7));
    return { ok: response.status < 300, status: response.status, json: async () => response.body };
  } });
  const response = await client.submit(report);
  assert.equal((await client.status(response.id)).state, 'delivered');
  f.db.close();
});
test('HTTP end-to-end: web SDK through gateway to a local Squircle protocol peer', async () => {
  const { createServer } = await import('node:http');
  const { once } = await import('node:events');
  let delivered;
  const peer = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer control');
    let raw = ''; for await (const part of req) raw += part;
    delivered = JSON.parse(raw);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, data: { agent: { thread_id: 'test-thread' } } }));
  });
  peer.listen(0, '127.0.0.1'); await once(peer, 'listening');
  const db = openStore(':memory:');
  const gateway = createServer(createGateway({ db, secret, adminToken, apps: { demo: { project: 'test-project', mode: 'implement' } }, squircleURL: `http://127.0.0.1:${peer.address().port}`, controlToken: 'control' }));
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  try {
    const sdk = createFeedback({ endpoint: `http://127.0.0.1:${gateway.address().port}`, token: async () => token });
    const receipt = await sdk.submit(report);
    assert.equal(receipt.state, 'delivered');
    assert.equal(delivered.project_id, 'test-project');
    assert.equal((await sdk.status(receipt.id)).id, receipt.id);
  } finally {
    await Promise.all([new Promise(resolve => gateway.close(resolve)), new Promise(resolve => peer.close(resolve))]); db.close();
  }
});
