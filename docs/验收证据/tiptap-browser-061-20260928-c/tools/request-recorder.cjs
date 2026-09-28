// 浏览器请求只存固定元数据字段，逐事件落盘；不读取头、Cookie、查询参数或正文。
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');

function createRequestRecorder(context, file, base, secrets, onError) {
  assert.ok(secrets.every(value => typeof value === 'string' && value.length > 0));
  fs.writeFileSync(file, '', { flag: 'wx' });
  const requests = new Map();
  const errors = [];
  const listeners = [];
  let sequence = 0;
  let finalized = false;
  const redact = value => secrets.reduce((text, secret) => text
    .replaceAll(secret, '[redacted]')
    .replaceAll(encodeURIComponent(secret), '[redacted]'), String(value));
  function location(rawUrl) {
    const url = new URL(rawUrl);
    // 用户信息、查询串与片段一律不落盘；外部地址仅用于定位被拦截的请求。
    if (!['http:', 'https:'].includes(url.protocol)) {
      // data 等地址的路径可能就是正文，不能作为普通路径记录。
      return { origin: url.protocol, pathname: '[非 HTTP 路径已省略]' };
    }
    let pathname = url.pathname;
    try { pathname = decodeURIComponent(pathname); } catch { /* 非法转义保留编码形式。 */ }
    return { origin: redact(url.origin), pathname: redact(pathname) };
  }
  function emit(id, event, fields = {}) {
    assert.ok(!finalized, '请求记录已经结束');
    const row = { sequence: ++sequence, requestId: id, event, time: new Date().toISOString(), ...fields };
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
  }
  function track(request) {
    if (requests.has(request)) return requests.get(request);
    const entry = { id: requests.size + 1, started: performance.now(), method: request.method(),
      ...location(request.url()), status: null, terminal: null, decision: null };
    requests.set(request, entry);
    const prior = request.redirectedFrom();
    emit(entry.id, 'request', { method: entry.method, origin: entry.origin, pathname: entry.pathname,
      resourceType: request.resourceType(), navigation: request.isNavigationRequest(),
      redirectedFrom: prior ? (requests.get(prior)?.id ?? null) : null });
    return entry;
  }
  function protect(action) {
    try { return action(); }
    catch {
      // 不把异常原文写进元数据，避免错误信息含 URL、凭据或响应片段。
      errors.push('请求元数据记录失败');
      onError('请求元数据记录失败');
      return undefined;
    }
  }
  function listen(event, action) {
    const handler = value => protect(() => action(value));
    context.on(event, handler);
    listeners.push([event, handler]);
  }
  listen('request', track);
  listen('response', response => {
    const entry = track(response.request());
    entry.status = response.status();
    emit(entry.id, 'response', { status: entry.status });
  });
  for (const event of ['requestfinished', 'requestfailed']) {
    listen(event, request => {
      const entry = track(request);
      assert.equal(entry.terminal, null, '请求结束事件重复');
      entry.terminal = event;
      emit(entry.id, event, { status: entry.status, elapsedMs: Math.round(performance.now() - entry.started) });
    });
  }
  return {
    location,
    decision(request, decision) {
      return protect(() => {
        const entry = track(request);
        assert.equal(entry.decision, null, '请求守卫决定重复');
        entry.decision = decision;
        emit(entry.id, 'guard', { decision });
        return true;
      });
    },
    finish() {
      // 浏览器关闭之后再汇总，关闭时的取消请求也必须具有真实结束事件。
      for (const [event, listener] of listeners) context.off(event, listener);
      finalized = true;
      const entries = [...requests.values()];
      const incompleteIds = entries.filter(item => !item.terminal || (item.terminal === 'requestfinished' && item.status === null)).map(item => item.id);
      return { file: require('node:path').basename(file), requests: entries.length, events: sequence,
        finished: entries.filter(item => item.terminal === 'requestfinished').length,
        failed: entries.filter(item => item.terminal === 'requestfailed').length,
        incompleteIds, errors,
        loginRecorded: entries.some(item => item.origin === base && item.pathname === '/api/auth/login' && item.method === 'POST' && item.status === 200),
        readsRecorded: entries.some(item => item.origin === base && ['GET', 'HEAD'].includes(item.method) && item.status === 200),
        sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
    },
  };
}

module.exports = { createRequestRecorder };
