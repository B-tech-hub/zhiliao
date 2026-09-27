// 仅在升级彩排的两套专用容器内执行，不接受远程地址，也不读取宿主配置。
// 由 R2 fixture 复制扩展：old 角色先在 0.6.0 生成数据，再在同卷上换 0.6.1；rollback 角色用 0.6.0 恢复升级前快照。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const req = require('node:module').createRequire('/app/package.json');
const role = process.env.R2_ROLE;
const mode = process.argv[2];
assert.equal(process.env.DATABASE_PATH, '/data/db/app.db');
assert.match(process.env.R2_RUN || '', /^u061-\d{8}-[a-z0-9]+$/);
assert.ok(['old', 'rollback'].includes(role));
const sqlite = writable => new (req('better-sqlite3'))('/data/db/app.db', { readonly: !writable, fileMustExist: true });
const appVersion = () => JSON.parse(fs.readFileSync('/app/package.json', 'utf8')).version;
let cookie = '';
async function request(url, method = 'GET', data, allowFail = false) {
  const headers = { Cookie: cookie };
  let body = data;
  if (data && !(data instanceof FormData) && !Buffer.isBuffer(data)) {
    body = JSON.stringify(data); headers['Content-Type'] = 'application/json';
  }
  const response = await fetch('http://127.0.0.1:3000' + url, { method, body, headers, signal: AbortSignal.timeout(60000) });
  if (!allowFail) assert.ok(response.ok, method + ' ' + url + ' HTTP ' + response.status);
  return response;
}
async function login() {
  const response = await request('/api/auth/login', 'POST', { password: process.env.APP_PASSWORD });
  cookie = response.headers.get('set-cookie')?.split(';')[0] || '';
  assert.ok(cookie, '没有登录 Cookie');
}
const json = async (...args) => (await request(...args)).json();
const readSeed = () => JSON.parse(fs.readFileSync('/evidence/seed.json', 'utf8'));
const expectVersion = expected => assert.equal(appVersion(), expected, '当前镜像版本不是 ' + expected);
async function waitMarkdown(id, present) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const files = fs.readdirSync('/data/notes', { recursive: true }).filter(name => name.endsWith('-' + id + '.md'));
    if (files.length === (present ? 1 : 0)) return files;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Markdown 文件数量未达到预期：' + id);
}
async function waitMarkdownText(id, expected, stale) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const [file] = await waitMarkdown(id, true);
    let text = '';
    try { text = fs.readFileSync(path.join('/data/notes', file), 'utf8'); } catch { /* 导出中途改名，下一轮再读 */ }
    if (text.includes(expected) && !(stale && text.includes(stale))) return file;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Markdown 未出现预期文本：' + id + ' / ' + expected.slice(0, 20));
}
// 会话、来源、搜索与正文读取；图片 HTTP 读取按 strictImages 决定断言还是只记录
async function readback(strictImages) {
  const conv = await json('/api/chat/conversations/r2-conv');
  assert.equal(conv.messages.length, 1); assert.equal(conv.sourceNoteIds.length, 1);
  const search = await json('/api/search?q=' + encodeURIComponent('雨后青竹'));
  assert.ok(search.results.some(row => row.id === conv.sourceNoteIds[0]), '搜索未命中已知来源');
  for (const id of Object.values(readSeed().ids).filter(id => id !== readSeed().ids.trash)) await json('/api/notes/' + id);
  const db = sqlite(false);
  const images = [];
  for (const row of db.prepare('SELECT filename, original_filename FROM images ORDER BY filename').all()) {
    const response = await request('/api/images/' + row.filename, 'GET', undefined, !strictImages);
    const same = response.ok && Buffer.from(await response.arrayBuffer()).equals(fs.readFileSync('/data/uploads/' + row.filename));
    images.push({ filename: row.filename, heicPair: Boolean(row.original_filename), status: response.status, bytesMatch: same });
    if (strictImages) assert.ok(same, '图片字节不一致：' + row.filename);
  }
  db.close();
  return { version: appVersion(), conv, search, images };
}
async function main() {
  if (mode === 'init') {
    assert.equal(role, 'old'); expectVersion('0.6.0');
    const db = sqlite(true); assert.equal(db.prepare('SELECT count(*) n FROM notes').get().n, 0);
    db.prepare("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES ('weekly_review_enabled','0',?)").run(Date.now());
    db.close(); console.log('0.6.0 空验收库已关闭每周回顾'); return;
  }
  if (mode === 'seal') {
    assert.equal(role, 'old'); expectVersion('0.6.0');
    const seed = readSeed(); const db = sqlite(true);
    assert.deepEqual(db.prepare('SELECT id FROM notes ORDER BY id').all().map(n => n.id), Object.values(seed.ids).sort());
    db.transaction(() => {
      db.prepare("UPDATE notes SET ai_status='skipped'").run();
      db.prepare('UPDATE notes SET summary=? WHERE id=?').run('升级彩排合成摘要：保留长文、表格与公式。', seed.ids.long);
      // 锁字段也纳入升级前后比对
      db.prepare('UPDATE notes SET title_locked=1, topic_locked=1 WHERE id=?').run(seed.ids.short);
      db.prepare('DELETE FROM ai_jobs').run();
      db.prepare("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES ('weekly_review_enabled','0',?)").run(Date.now());
      const now = Date.now();
      db.prepare("INSERT INTO conversations(id,scope_type,scope_id,title,created_at,updated_at) VALUES ('r2-conv','sources','','升级彩排合成历史',?,?)").run(now, now);
      db.prepare("INSERT INTO conversation_sources(conversation_id,source_type,source_id,created_at) VALUES ('r2-conv','note',?,?)").run(seed.ids.short, now);
      db.prepare("INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES ('r2-message','r2-conv','assistant',?,?)").run('这是固定合成历史，不是真实模型输出。[^' + seed.ids.short + ']', now);
    })(); db.close(); console.log('0.6.0 合成数据封存完成'); return;
  }
  await login();
  if (mode === 'seed') {
    assert.equal(role, 'old'); expectVersion('0.6.0'); assert.ok(!fs.existsSync('/evidence/seed.json'));
    const db = sqlite(false); assert.equal(db.prepare('SELECT count(*) n FROM notes').get().n, 0); db.close();
    const topic = await json('/api/topics', 'POST', { name: '升级彩排:图片' });
    const urls = {};
    for (const name of ['pattern.png', 'pattern.heic']) {
      const form = new FormData(); form.append('file', new Blob([fs.readFileSync('/r2/fixtures/' + name)]), name);
      urls[name] = (await json('/api/uploads', 'POST', form)).url;
    }
    const content = {
      short: 'R2 短文检索口令：雨后青竹。',
      long: '# 长文\n\n' + '保留原始正文、公式 $a^2+b^2=c^2$ 与中文标点。\n\n'.repeat(80) + '|项目|数值|\n|---|---|\n|验收|42|\n\n![PNG](' + urls['pattern.png'] + ')',
      image: 'HEIC 配对口令：琥珀圆环。\n\n<img src="' + urls['pattern.heic'] + '" width="240" style="display: block; margin-left: auto; margin-right: auto;" alt="几何图">',
      trash: '升级彩排回收站专用笔记。',
    };
    const ids = {};
    for (const [key, body] of Object.entries(content)) {
      ids[key] = (await json('/api/notes', 'POST', { content: body })).id;
      await json('/api/notes/' + ids[key], 'PATCH', { title: '升级 ' + key, tags: ['验收', key] });
    }
    await json('/api/notes/' + ids.short, 'PATCH', { topicId: topic.id });
    await waitMarkdownText(ids.short, content.short);
    await json('/api/notes/' + ids.trash, 'DELETE'); await waitMarkdown(ids.trash, false);
    fs.writeFileSync('/evidence/seed.json', JSON.stringify({ version: appVersion(), ids, content, urls }, null, 2), { flag: 'wx' });
    console.log('0.6.0 已建立 4 条合成笔记（含回收站）与 PNG、HEIC 两组图片');
  } else if (mode === 'backup') {
    assert.equal(role, 'old'); expectVersion('0.6.0');
    const backup = await json('/api/backup', 'POST');
    fs.writeFileSync('/evidence/backup.json', JSON.stringify(backup, null, 2), { flag: 'wx' });
    console.log('0.6.0 升级前产品备份完成，请立即停止实例并固化配对快照');
  } else if (mode === 'upgrade-readback') {
    assert.equal(role, 'old'); expectVersion('0.6.1');
    const result = await readback(true);
    fs.writeFileSync('/evidence/upgrade-readback.json', JSON.stringify(result, null, 2), { flag: 'wx' });
    console.log('0.6.1 读取 0.6.0 数据：会话、来源、搜索、正文与图片（含 HEIC 展示图）HTTP 字节一致');
  } else if (mode === 'persist') {
    assert.equal(role, 'old'); expectVersion('0.6.1');
    const form = new FormData(); form.append('file', new Blob([fs.readFileSync('/r2/fixtures/pattern.png')]), 'after-upgrade.png');
    const upload = await json('/api/uploads', 'POST', form);
    const note = await json('/api/notes', 'POST', { content: '升级后写入：霜叶红于二月花。\n\n![PNG](' + upload.url + ')' });
    await waitMarkdown(note.id, true);
    fs.writeFileSync('/evidence/persist.json', JSON.stringify({ id: note.id, image: upload.url }), { flag: 'wx' });
    console.log('0.6.1 已写入升级后笔记与图片');
  } else if (mode === 'check-persist') {
    assert.equal(role, 'old'); expectVersion('0.6.1');
    const marker = JSON.parse(fs.readFileSync('/evidence/persist.json', 'utf8'));
    const { note } = await json('/api/notes/' + marker.id);
    assert.ok(note.content.startsWith('升级后写入：霜叶红于二月花。'));
    const image = await request(marker.image);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), fs.readFileSync('/r2/fixtures/pattern.png'));
    await waitMarkdown(marker.id, true); console.log('重启后升级后笔记、图片和 Markdown 保留');
  } else if (mode === 'rollback-readback') {
    assert.equal(role, 'rollback'); expectVersion('0.6.0');
    const result = await readback(false);
    const marker = JSON.parse(fs.readFileSync('/evidence/persist.json', 'utf8'));
    const gone = await request('/api/notes/' + marker.id, 'GET', undefined, true);
    assert.equal(gone.status, 404, '回退后不应存在升级后写入的笔记');
    result.afterUpgradeNoteStatus = gone.status;
    fs.writeFileSync('/evidence/rollback-readback.json', JSON.stringify(result, null, 2), { flag: 'wx' });
    console.log('0.6.0 回退：会话、来源、搜索、正文可读，升级后写入不存在；图片 HTTP 状态仅记录');
  } else { throw new Error('未知步骤：' + mode); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
