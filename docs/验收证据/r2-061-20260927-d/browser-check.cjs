// 仅检查本轮恢复实例；临时凭据只在内存使用，不记录请求体或浏览器会话。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH);
const { expect } = require(path.join(process.env.PLAYWRIGHT_MODULE_PATH, 'test'));
const work = __dirname;
const base = 'http://127.0.0.1:3313';
const env = Object.fromEntries(fs.readFileSync(path.join(work, 'restore.env'), 'utf8').trim().split(/\r?\n/).map(line => {
  const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
}));
assert.equal(env.R2_RUN, '061-20260927-d');
assert.equal(env.R2_ROLE, 'restore');
assert.equal(env.R2_PORT, '3313');
const seed = JSON.parse(fs.readFileSync(path.join(work, 'source/seed.json'), 'utf8'));
const source = JSON.parse(fs.readFileSync(path.join(work, 'source-state.json'), 'utf8'));
const shots = path.join(work, 'browser');
fs.mkdirSync(shots, { recursive: true });
const reportPath = path.join(work, 'browser.json');
assert.ok(!fs.existsSync(reportPath), '不重跑或覆盖浏览器结果');
const report = { started: new Date().toISOString(), status: 'running', cases: [], pageErrors: [], consoleErrors: [], failedResponses: [], blockedRequests: [], modelRequests: [] };
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
let browser;
let page;
async function checkpoint(name, action) {
  const item = { name, started: new Date().toISOString(), status: 'running' };
  report.cases.push(item); save();
  try { await action(); item.status = 'passed'; }
  catch (error) { item.status = 'failed'; throw error; }
  finally { item.finished = new Date().toISOString(); save(); }
}
async function shot(name) {
  await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: false });
}
async function openNote(id, text) {
  const response = await page.goto(base + '/notes/' + id, { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200);
  await expect(page.locator('.note-detail')).toContainText(text);
}
async function checkImage(url, mime) {
  const img = page.locator('img[src="' + url + '"]');
  await expect(img).toHaveCount(1);
  await img.scrollIntoViewIfNeeded();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth === 96 && el.naturalHeight === 64)).toBe(true);
  const response = await page.request.get(base + url);
  assert.equal(response.status(), 200);
  assert.equal(response.headers()['content-type'], mime);
  const bytes = await response.body();
  const filename = url.split('/').pop();
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), source.files[filename].sha256);
}
(async () => {
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.R2_CHROMIUM_PATH });
    report.browserVersion = browser.version();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(base + '/')) {
        const target = new URL(url);
        if (target.pathname === '/api/chat' || target.pathname === '/api/llm/test') report.modelRequests.push(target.pathname);
        return route.continue();
      }
      report.blockedRequests.push(url); return route.abort();
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) report.failedResponses.push({ url: response.url(), status: response.status() }); });
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
      await openNote(seed.ids.long, '保留原始正文');
      await expect(page.locator('.note-detail table')).toContainText('42');
      await checkImage(seed.urls['pattern.png'], 'image/png'); await shot('03-long-png');
    });
    await checkpoint('HEIC 展示图与字节', async () => {
      await openNote(seed.ids.image, '琥珀圆环');
      await checkImage(seed.urls['pattern.heic'], 'image/jpeg'); await shot('04-heic-jpeg');
    });
    await checkpoint('搜索并打开结果', async () => {
      await page.goto(base + '/search', { waitUntil: 'networkidle' });
      await page.getByPlaceholder('搜索标题、正文、标签').fill('雨后青竹');
      const hit = page.locator('main a[href="/notes/' + seed.ids.short + '"]');
      await expect(hit).toBeVisible(); await shot('05-search');
      await hit.click();
      await expect(page).toHaveURL(base + '/notes/' + seed.ids.short);
      await expect(page.locator('.note-detail')).toContainText('雨后青竹');
    });
    await checkpoint('历史会话与来源', async () => {
      await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
      const panel = page.locator('aside[aria-label="AI 助手"]');
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
