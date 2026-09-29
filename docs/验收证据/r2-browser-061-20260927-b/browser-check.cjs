// 仅检查本轮恢复实例；临时凭据只在内存使用，不记录请求体或浏览器会话。
// 与 run a 的差异：按只读语义放行产品既有的 POST /api/notes/:id/related，仍禁止其它写请求和全部模型请求。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH);
const { expect } = require(path.join(process.env.PLAYWRIGHT_MODULE_PATH, 'test'));
const work = path.join(require('node:os').tmpdir(), 'zhiliao-r2-061-20260927-d');
const output = __dirname;
const base = 'http://127.0.0.1:3313';
// 相关笔记只做候选召回与可选冲突判断，不写库，是编辑器固定发出的既有请求。
const readOnlyPosts = [/^\/api\/notes\/[^/]+\/related$/];
const env = Object.fromEntries(fs.readFileSync(path.join(work, 'restore.env'), 'utf8').trim().split(/\r?\n/).map(line => {
  const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
}));
assert.equal(env.R2_RUN, '061-20260927-d');
assert.equal(env.R2_ROLE, 'restore');
assert.equal(env.R2_PORT, '3313');
const seed = JSON.parse(fs.readFileSync(path.join(work, 'source/seed.json'), 'utf8'));
const source = JSON.parse(fs.readFileSync(path.join(work, 'source-state.json'), 'utf8'));
assert.equal(source.modelConfigured, false);
assert.equal(source.weeklyReviewEnabled, false);
const shots = path.join(output, 'browser');
fs.mkdirSync(shots, { recursive: true });
const reportPath = path.join(output, 'browser.json');
assert.ok(!fs.existsSync(reportPath), '不重跑或覆盖浏览器结果');
const report = { started: new Date().toISOString(), status: 'running', attempts: 1, inputRun: env.R2_RUN, base, imageChecks: [], screenshots: [], cases: [], pageErrors: [], consoleErrors: [], failedResponses: [], blockedRequests: [], readOnlyRequests: [], modelRequests: [] };
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
let browser;
let page;
let fatalError;
let rejectFatal;
const fatal = new Promise((_, reject) => { rejectFatal = reject; });
fatal.catch(() => {});
function failNow(message) {
  if (!fatalError) { fatalError = new Error(message); rejectFatal(fatalError); }
}
async function checkpoint(name, action) {
  if (fatalError) throw fatalError;
  const item = { name, started: new Date().toISOString(), status: 'running' };
  report.cases.push(item); save();
  try { await Promise.race([action(), fatal]); if (fatalError) throw fatalError; item.status = 'passed'; }
  catch (error) { item.status = 'failed'; throw error; }
  finally { item.finished = new Date().toISOString(); save(); }
}
async function shot(name) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const finite = document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime));
    await Promise.all(finite.map(animation => animation.finished.catch(() => {})));
  });
  await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: false });
  report.screenshots.push({ file: 'browser/' + name + '.png', finiteAnimationsFinished: true });
}
async function openNote(id, text) {
  const response = await page.goto(base + '/notes/' + id, { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200);
  await expect(page.locator('.note-detail')).toContainText(text);
}
async function checkImage(url, mime) {
  const img = page.locator(`img[src='${url}']`);
  await expect(img).toHaveCount(1);
  await img.scrollIntoViewIfNeeded();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth === 96 && el.naturalHeight === 64)).toBe(true);
  assert.equal(new URL(url, base).origin, base);
  // 使用浏览器实际登录态；只返回图片响应，不读取 Cookie。
  const response = await page.evaluate(async imageUrl => {
    const result = await fetch(imageUrl, { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    return { status: result.status, mime: result.headers.get('content-type'), bytes: Array.from(new Uint8Array(await result.arrayBuffer())) };
  }, url);
  const bytes = Buffer.from(response.bytes);
  const filename = url.split('/').pop();
  const dimensions = await img.evaluate(el => ({ width: el.naturalWidth, height: el.naturalHeight }));
  const check = { url, status: response.status, mime: response.mime, ...dimensions, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), expectedSha256: source.files[filename].sha256 };
  report.imageChecks.push(check); save();
  assert.equal(response.status, 200);
  assert.equal(response.mime, mime);
  assert.equal(check.sha256, check.expectedSha256);
}
(async () => {
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.R2_CHROMIUM_PATH });
    report.browserVersion = browser.version();
    report.playwrightVersion = require(path.join(process.env.PLAYWRIGHT_MODULE_PATH, 'package.json')).version;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = route.request().url();
      const method = route.request().method();
      const target = new URL(url);
      if (target.origin === base) {
        if (['/api/chat', '/api/chat/confirm', '/api/llm/test'].includes(target.pathname)) {
          report.modelRequests.push(target.pathname); failNow('禁止模型请求'); return route.abort();
        }
        if (['GET', 'HEAD'].includes(method)) return route.continue();
        if (target.pathname === '/api/auth/login' && method === 'POST') return route.continue();
        if (method === 'POST' && readOnlyPosts.some(pattern => pattern.test(target.pathname))) {
          report.readOnlyRequests.push(target.pathname); return route.continue();
        }
        report.blockedRequests.push(method + ' ' + target.pathname); failNow('禁止额外写请求'); return route.abort();
      }
      report.blockedRequests.push(target.origin + target.pathname); failNow('禁止外部请求'); return route.abort();
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => { report.pageErrors.push(error.message); failNow('未处理页面错误'); });
    page.on('console', message => { if (message.type() === 'error') { report.consoleErrors.push(message.text()); failNow('浏览器控制台错误'); } });
    page.on('response', response => { if (response.status() >= 400) { report.failedResponses.push({ url: response.url(), status: response.status() }); failNow('页面 HTTP 错误'); } });
    await checkpoint('真实登录', async () => {
      await page.goto(base + '/login', { waitUntil: 'networkidle' });
      await page.getByPlaceholder('请输入访问密码').fill(env.R2_PASSWORD);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.waitForURL(base + '/', { waitUntil: 'networkidle' });
      await expect(page.getByPlaceholder('请输入访问密码')).toHaveCount(0);
      await shot('01-home');
    });
    await checkpoint('短笔记恢复', async () => {
      await openNote(seed.ids.short, '雨后青竹'); await shot('02-short');
    });
    await checkpoint('长文表格与 PNG', async () => {
      // 编辑器在正文稳定 900 ms 后固定发出相关笔记请求；先挂等待，再打开长文。
      const related = page.waitForResponse(response => readOnlyPosts.some(pattern => pattern.test(new URL(response.url()).pathname)), { timeout: 20000 }).catch(() => null);
      await openNote(seed.ids.long, '保留原始正文');
      await expect(page.locator('.note-detail table')).toContainText('42');
      await checkImage(seed.urls['pattern.png'], 'image/png'); await shot('03-long-png');
      const relatedResponse = await related;
      assert.ok(relatedResponse, '未观察到相关笔记只读请求');
      assert.equal(relatedResponse.status(), 200);
    });
    await checkpoint('HEIC 展示图与字节', async () => {
      await openNote(seed.ids.image, '琥珀圆环');
      await checkImage(seed.urls['pattern.heic'], 'image/jpeg'); await shot('04-heic-jpeg');
    });
    await checkpoint('搜索并打开结果', async () => {
      await page.goto(base + '/search', { waitUntil: 'networkidle' });
      await page.getByPlaceholder('搜索标题、正文、标签').fill('雨后青竹');
      const hit = page.locator(`main a[href='/notes/${seed.ids.short}']`);
      await expect(hit).toBeVisible(); await shot('05-search');
      await hit.click();
      await expect(page).toHaveURL(base + '/notes/' + seed.ids.short);
      await expect(page.locator('.note-detail')).toContainText('雨后青竹');
    });
    await checkpoint('历史会话与来源', async () => {
      await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
      const panel = page.locator(`aside[aria-label='AI 助手']`);
      await panel.getByRole('button', { name: '历史', exact: true }).click();
      await panel.getByRole('button', { name: /R2 合成历史/ }).click();
      await expect(panel).toContainText('这是固定合成历史，不是真实模型输出。');
      await panel.getByRole('button', { name: /来源 · 1/ }).click();
      await expect(panel.locator('li')).toContainText('R2 标题:改名');
      await shot('06-history-source');
    });
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.consoleErrors, []);
    assert.deepEqual(report.failedResponses, []);
    assert.deepEqual(report.blockedRequests, []);
    assert.deepEqual(report.modelRequests, []);
    assert.ok(report.readOnlyRequests.length >= 1, '只读相关笔记请求未被放行');
    assert.ok(report.readOnlyRequests.every(item => readOnlyPosts.some(pattern => pattern.test(item))), '只读请求不在允许清单内');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.stack || error.message).replaceAll(env.R2_PASSWORD, '[redacted]').replaceAll(env.R2_SECRET, '[redacted]');
    // 登录失败时不截图，避免保留输入凭据。
    if (page && !page.url().includes('/login')) await shot('failure').catch(() => {});
    process.exitCode = 1;
  } finally {
    report.finished = new Date().toISOString(); save();
    if (browser) await browser.close();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.map(({ name, status }) => ({ name, status })) }));
  }
})();
