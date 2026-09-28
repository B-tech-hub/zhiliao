// TipTap 补丁真实浏览器验收：每次运行只执行一轮（mermaid=0 或 1），失败即停、不重试。
// 由 TipTap run b 复制：改用 GFM 初始表格，增加全部请求的脱敏元数据记录，原写入边界保持。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequestRecorder } = require('./request-recorder.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH);
const { expect } = require(path.join(process.env.PLAYWRIGHT_MODULE_PATH, 'test'));
const round = process.argv[2];
assert.ok(['0', '1'].includes(round));
const work = process.env.T_WORK;
const env = Object.fromEntries(fs.readFileSync(path.join(work, 'app.env'), 'utf8').trim().split(/\r?\n/).map(line => {
  const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
}));
assert.equal(env.T_RUN, 't061-20260928-c');
const base = 'http://127.0.0.1:' + env.T_PORT;
const seed = JSON.parse(fs.readFileSync(path.join(work, 'evidence', 'seed-m' + round + '.json'), 'utf8'));
const noteIds = new Set(Object.values(seed.ids));
// 危险笔记里故意引用的不存在图片：0.6.1 文件名校验先返回 400（run a 误按 404 预期而停止），该状态与对应控制台报错属预期，单独记录
const expectedMissing = '/api/images/missing-xss.png';
const output = process.env.T_OUTPUT;
const shots = path.join(output, 'browser');
fs.mkdirSync(shots, { recursive: true });
const reportPath = path.join(output, 'browser-m' + round + '.json');
assert.ok(!fs.existsSync(reportPath), '不重跑或覆盖浏览器结果');
const report = { started: new Date().toISOString(), status: 'running', attempts: 1, round: 'm' + round, base, cases: [], screenshots: [], dbChecks: [], pageErrors: [], consoleErrors: [], failedResponses: [], expectedMissing: [], blockedRequests: [], allowedWrites: [], readOnlyRequests: [], modelRequests: [], dialogs: [] };
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
let browser; let page; let network; let fatalError; let rejectFatal;
const fatal = new Promise((_, reject) => { rejectFatal = reject; });
fatal.catch(() => {});
function failNow(message) { if (!fatalError) { fatalError = new Error(message); rejectFatal(fatalError); } }
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
    const finite = document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime));
    await Promise.all(finite.map(a => a.finished.catch(() => {})));
  });
  const file = 'm' + round + '-' + name + '.png';
  await page.screenshot({ path: path.join(shots, file), fullPage: false });
  report.screenshots.push('browser/' + file);
}
async function openNote(key) {
  const response = await page.goto(base + '/notes/' + seed.ids[key], { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200);
  await expect(page.locator('.note-detail')).toContainText(seed.content[key].split('\n')[0]);
}
// 用浏览器登录态读取数据库中的正文（GET 详情接口直接返回库内 content）
const dbContent = key => page.evaluate(async id => (await (await fetch('/api/notes/' + id, { cache: 'no-store' })).json()).note.content, seed.ids[key]);
async function waitDb(key, predicate, label) {
  let content = '';
  await expect.poll(async () => { content = await dbContent(key); return predicate(content); }, { timeout: 15000, intervals: [500] }).toBe(true);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  report.dbChecks.push({ key, label, content }); save();
  return content;
}
const editorImg = url => page.locator(`.ProseMirror img[src='${url}']`);
async function imageAttrs(url) {
  const img = editorImg(url);
  await expect(img).toHaveCount(1);
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth === 96)).toBe(true);
  return img.evaluate(el => ({ width: el.getAttribute('width'), marginLeft: el.style.marginLeft, marginRight: el.style.marginRight }));
}
async function selectImage(url) {
  await editorImg(url).click();
  await expect(page.locator("button[title='宽度 50%']")).toBeVisible();
}
const clickTool = title => page.locator(`button[title='${title}']`).click();
const imgLine = (content, url) => content.split('\n').find(line => line.includes(url)) || '';
(async () => {
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.T_CHROMIUM_PATH });
    report.browserVersion = browser.version();
    report.playwrightVersion = require(path.join(process.env.PLAYWRIGHT_MODULE_PATH, 'package.json')).version;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
    network = createRequestRecorder(context, path.join(output, 'requests-m' + round + '.jsonl'), base, [env.T_PASSWORD, env.T_SECRET], failNow);
    await context.route('**/*', route => {
      const request = route.request(); const method = request.method(); const target = new URL(request.url());
      const decide = (decision, allowed) => network.decision(request, decision) && allowed ? route.continue() : route.abort();
      if (target.origin !== base) { report.blockedRequests.push(network.location(request.url())); failNow('禁止外部请求'); return decide('blocked-external', false); }
      if (['/api/chat', '/api/chat/confirm', '/api/llm/test'].includes(target.pathname) || /\/(reprocess|transcribe)$/.test(target.pathname)) {
        report.modelRequests.push(method + ' ' + target.pathname); failNow('禁止模型请求'); return decide('blocked-model', false);
      }
      if (['GET', 'HEAD'].includes(method)) return decide('allowed-read', true);
      if (method === 'POST' && target.pathname === '/api/auth/login') return decide('allowed-login', true);
      const note = target.pathname.match(/^\/api\/notes\/([^/]+)(\/related)?$/);
      if (note && noteIds.has(note[1]) && method === 'POST' && note[2]) { report.readOnlyRequests.push(target.pathname); return decide('allowed-related', true); }
      if (note && noteIds.has(note[1]) && method === 'PATCH' && !note[2]) { report.allowedWrites.push('PATCH ' + target.pathname); return decide('allowed-patch', true); }
      report.blockedRequests.push(method + ' ' + target.pathname); failNow('禁止额外写请求'); return decide('blocked-write', false);
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('dialog', dialog => { report.dialogs.push(dialog.message()); failNow('页面弹出对话框'); dialog.dismiss().catch(() => {}); });
    page.on('pageerror', error => { report.pageErrors.push(error.message); failNow('未处理页面错误'); });
    page.on('console', message => {
      if (message.type() !== 'error') return;
      if (message.location().url.endsWith(expectedMissing)) { report.expectedMissing.push('console: ' + message.text()); return; }
      report.consoleErrors.push(message.text()); failNow('浏览器控制台错误');
    });
    page.on('response', response => {
      if (response.status() < 400) return;
      if (new URL(response.url()).pathname === expectedMissing && response.status() === 400) { report.expectedMissing.push('400 ' + expectedMissing); return; }
      report.failedResponses.push({ ...network.location(response.url()), status: response.status() }); failNow('页面 HTTP 错误');
    });
    await checkpoint('真实登录', async () => {
      await page.goto(base + '/login', { waitUntil: 'networkidle' });
      await page.getByPlaceholder('请输入访问密码').fill(env.T_PASSWORD);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.waitForURL(base + '/', { waitUntil: 'networkidle' });
    });
    await checkpoint('宽度 50% + 居中保存重开', async () => {
      const url = seed.urls.center;
      await openNote('center'); await selectImage(url);
      await clickTool('宽度 50%'); await clickTool('居中');
      const content = await waitDb('center', c => /width="50%"/.test(imgLine(c, url)) && /margin-left: auto; margin-right: auto/.test(imgLine(c, url)), '50%+居中');
      assert.ok(imgLine(content, url).startsWith('<img'));
      await page.reload({ waitUntil: 'networkidle' });
      assert.deepEqual(await imageAttrs(url), { width: '50%', marginLeft: 'auto', marginRight: 'auto' });
      await shot('01-center');
    });
    await checkpoint('仅宽度 75%', async () => {
      const url = seed.urls.width;
      await openNote('width'); await selectImage(url); await clickTool('宽度 75%');
      await waitDb('width', c => /^<img[^>]*width="75%"/.test(imgLine(c, url)) && !/style=/.test(imgLine(c, url)), '仅 75%');
      await page.reload({ waitUntil: 'networkidle' });
      assert.deepEqual(await imageAttrs(url), { width: '75%', marginLeft: '', marginRight: '' });
      await shot('02-width');
    });
    await checkpoint('仅右对齐', async () => {
      const url = seed.urls.right;
      await openNote('right'); await selectImage(url); await clickTool('右对齐');
      await waitDb('right', c => /^<img[^>]*style="display: block; margin-left: auto;"/.test(imgLine(c, url)) && !/width=/.test(imgLine(c, url)), '仅右对齐');
      await page.reload({ waitUntil: 'networkidle' });
      assert.deepEqual(await imageAttrs(url), { width: null, marginLeft: 'auto', marginRight: '' });
      await shot('03-right');
    });
    await checkpoint('普通图片保持 Markdown', async () => {
      const url = seed.urls.plain;
      await openNote('plain');
      await page.locator('.ProseMirror p', { hasText: '尾段。' }).click();
      await page.keyboard.press('End'); await page.keyboard.type('补');
      await waitDb('plain', c => c.includes('尾段。补') && imgLine(c, url).startsWith('![丁](' + url + ')') && !c.includes('<img'), '普通图片');
      await page.reload({ waitUntil: 'networkidle' });
      assert.deepEqual(await imageAttrs(url), { width: null, marginLeft: '', marginRight: '' });
      await shot('04-plain');
    });
    await checkpoint('图片紧邻 GFM 初始表格编辑往返', async () => {
      const url = seed.urls.table;
      assert.ok(!/<\/?table\b/i.test(seed.content.table), '初始输入不能是 HTML 表格');
      assert.match(seed.content.table, /<img[^>]*>\n\n\| 表头 \| 数值 \|\n\| --- \| --- \|\n\| 内容 \| 42 \|/);
      await openNote('table');
      assert.equal(await dbContent('table'), seed.content.table, '首次打开前后必须仍为 GFM 种子');
      report.tableInitial = { format: 'GFM', content: seed.content.table };
      save();
      await expect(page.locator('.ProseMirror table tr')).toHaveCount(2);
      await page.locator('.ProseMirror td', { hasText: '内容' }).click();
      await page.keyboard.press('End'); await page.keyboard.type('改');
      const content = await waitDb('table', c => c.includes('内容改') && /width="50%"/.test(imgLine(c, url)), '相邻表格');
      assert.ok(!/\|/.test(imgLine(content, url)), '图片与表格粘在同一行');
      assert.match(content, /^\|\s*表头\s*\|\s*数值\s*\|/m);
      await page.reload({ waitUntil: 'networkidle' });
      const rows = await page.locator('.ProseMirror table tr').evaluateAll(trs => trs.map(tr => Array.from(tr.children, c => c.textContent.trim())));
      assert.deepEqual(rows, [['表头', '数值'], ['内容改', '42']]);
      assert.equal((await imageAttrs(url)).width, '50%');
      await shot('05-table');
    });
    await checkpoint('危险属性不生效', async () => {
      await openNote('danger');
      await page.waitForTimeout(1500);
      const result = await page.evaluate(() => ({
        xss: window.__xss ?? null,
        onAttrs: Array.from(document.querySelectorAll('.note-detail *')).flatMap(el => Array.from(el.attributes).filter(a => /^on/i.test(a.name)).map(a => el.tagName + ' ' + a.name)),
        jsLinks: document.querySelectorAll(".note-detail a[href^='javascript' i]").length,
        styles: Array.from(document.querySelectorAll('.ProseMirror img')).map(el => el.getAttribute('style') || ''),
      }));
      report.dangerResult = result; save();
      assert.equal(result.xss, null); assert.deepEqual(result.onAttrs, []); assert.equal(result.jsLinks, 0);
      assert.ok(result.styles.every(s => !/javascript/i.test(s)), 'style 注入保留');
      assert.deepEqual(await imageAttrs(seed.urls.danger), { width: '50%', marginLeft: 'auto', marginRight: 'auto' });
      await shot('06-danger');
    });
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []);
    assert.deepEqual(report.failedResponses, []); assert.deepEqual(report.blockedRequests, []);
    assert.deepEqual(report.modelRequests, []); assert.deepEqual(report.dialogs, []);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.stack || error.message).replaceAll(env.T_PASSWORD, '[redacted]').replaceAll(env.T_SECRET, '[redacted]');
    if (page && !page.url().includes('/login')) await shot('failure').catch(() => {});
    process.exitCode = 1;
  } finally {
    try {
      if (browser) await browser.close();
    } catch {
      report.status = 'failed'; report.closeError = '浏览器关闭失败'; process.exitCode = 1;
    }
    try {
      assert.ok(network, '请求记录器未初始化');
      report.requestMetadata = network.finish();
      assert.deepEqual(report.requestMetadata.errors, []);
      assert.deepEqual(report.requestMetadata.incompleteIds, []);
      if (report.status === 'passed') {
        assert.ok(report.requestMetadata.loginRecorded && report.requestMetadata.readsRecorded, '登录与普通读取必须有记录');
      }
      if (fatalError) throw fatalError;
    } catch {
      report.status = 'failed'; report.metadataError = '请求元数据不完整或记录失败'; process.exitCode = 1;
    }
    report.finished = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.map(({ name, status }) => ({ name, status })) }));
  }
})();
