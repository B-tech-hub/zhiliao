// 仅在三套专用验收容器内执行，不接受远程地址，也不读取宿主配置。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const req = require('node:module').createRequire('/app/package.json');
const role = process.env.R2_ROLE;
const mode = process.argv[2];
assert.equal(process.env.DATABASE_PATH, '/data/db/app.db');
assert.match(process.env.R2_RUN || '', /^061-\d{8}-[a-z0-9]+$/);
assert.ok(['source', 'import', 'restore'].includes(role));
const sqlite = writable => new (req('better-sqlite3'))('/data/db/app.db', { readonly: !writable, fileMustExist: true });
let cookie = '';
async function request(url, method = 'GET', data) {
  const headers = { Cookie: cookie };
  let body = data;
  if (data && !(data instanceof FormData) && !Buffer.isBuffer(data)) {
    body = JSON.stringify(data); headers['Content-Type'] = 'application/json';
  }
  const response = await fetch('http://127.0.0.1:3000' + url, { method, body, headers, signal: AbortSignal.timeout(60000) });
  assert.ok(response.ok, method + ' ' + url + ' HTTP ' + response.status);
  return response;
}
async function login() {
  const response = await request('/api/auth/login', 'POST', { password: process.env.APP_PASSWORD });
  cookie = response.headers.get('set-cookie')?.split(';')[0] || '';
  assert.ok(cookie, '没有登录 Cookie');
}
const json = async (...args) => (await request(...args)).json();
const readSeed = () => JSON.parse(fs.readFileSync('/evidence/seed.json', 'utf8'));
async function waitMarkdown(id, present) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const files = fs.readdirSync('/data/notes', { recursive: true }).filter(name => name.endsWith('-' + id + '.md'));
    if (files.length === (present ? 1 : 0)) return files;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Markdown 文件数量未达到预期：' + id);
}
// 等到 Markdown 含有 expected；给出 stale 时还要求旧文本已消失
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
async function main() {
  if (mode === 'init') {
    assert.ok(['source', 'import'].includes(role));
    const db = sqlite(true); assert.equal(db.prepare('SELECT count(*) n FROM notes').get().n, 0);
    db.prepare("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES ('weekly_review_enabled','0',?)").run(Date.now());
    db.close(); console.log('空验收库已关闭每周回顾'); return;
  }
  if (mode === 'seal') {
    assert.equal(role, 'source');
    const seed = readSeed(); const db = sqlite(true);
    assert.deepEqual(db.prepare('SELECT id FROM notes ORDER BY id').all().map(n => n.id), Object.values(seed.ids).sort());
    db.transaction(() => {
      db.prepare("UPDATE notes SET ai_status='skipped'").run();
      db.prepare('UPDATE notes SET summary=? WHERE id=?').run('R2 合成摘要：保留长文、表格与公式。', seed.ids.long);
      db.prepare('DELETE FROM ai_jobs').run();
      db.prepare("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES ('weekly_review_enabled','0',?)").run(Date.now());
      const now = Date.now();
      db.prepare("INSERT INTO conversations(id,scope_type,scope_id,title,created_at,updated_at) VALUES ('r2-conv','sources','','R2 合成历史',?,?)").run(now, now);
      db.prepare("INSERT INTO conversation_sources(conversation_id,source_type,source_id,created_at) VALUES ('r2-conv','note',?,?)").run(seed.ids.short, now);
      db.prepare("INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES ('r2-message','r2-conv','assistant',?,?)").run('这是固定合成历史，不是真实模型输出。[^' + seed.ids.short + ']', now);
    })(); db.close(); console.log('合成数据封存完成'); return;
  }
  await login();
  if (mode === 'seed') {
    assert.equal(role, 'source'); assert.ok(!fs.existsSync('/evidence/seed.json'));
    const db = sqlite(false); assert.equal(db.prepare('SELECT count(*) n FROM notes').get().n, 0); db.close();
    const topic = await json('/api/topics', 'POST', { name: 'R2 导出:图片' });
    const urls = {};
    for (const name of ['pattern.png', 'pattern.heic']) {
      const form = new FormData(); form.append('file', new Blob([fs.readFileSync('/r2/fixtures/' + name)]), name);
      urls[name] = (await json('/api/uploads', 'POST', form)).url;
    }
    const content = {
      short: 'R2 短文检索口令：雨后青竹。',
      long: '# 长文\n\n' + '保留原始正文、公式 $a^2+b^2=c^2$ 与中文标点。\n\n'.repeat(80) + '|项目|数值|\n|---|---|\n|验收|42|\n\n![PNG](' + urls['pattern.png'] + ')',
      image: 'HEIC 配对口令：琥珀圆环。\n\n<img src="' + urls['pattern.heic'] + '" width="240" style="display: block; margin-left: auto; margin-right: auto;" alt="几何图">',
      trash: 'R2 回收站专用笔记，不应进入 ZIP。',
    };
    const draft = 'R2 短文初稿，稍后改正文。';
    const ids = {};
    for (const [key, body] of Object.entries(content)) {
      // 短文先存初稿，再经真实修改入口改正文，覆盖增量 Markdown 的改正文路径
      ids[key] = (await json('/api/notes', 'POST', { content: key === 'short' ? draft : body })).id;
      await json('/api/notes/' + ids[key], 'PATCH', { title: 'R2 ' + key, tags: ['验收', key] });
    }
    await waitMarkdownText(ids.short, draft);
    await json('/api/notes/' + ids.short, 'PATCH', { content: content.short });
    await waitMarkdownText(ids.short, content.short, draft);
    const oldPaths = await waitMarkdown(ids.short, true);
    await json('/api/notes/' + ids.short, 'PATCH', { title: 'R2 标题:改名', topicId: topic.id });
    await waitMarkdown(ids.short, true);
    // 数量相同不代表旧路径已清理，明确等待旧文件消失。
    for (let n = 0; n < 50 && oldPaths.some(p => fs.existsSync(path.join('/data/notes', p))); n++) await new Promise(r => setTimeout(r, 100));
    assert.ok(oldPaths.every(p => !fs.existsSync(path.join('/data/notes', p))));
    await json('/api/notes/' + ids.trash, 'DELETE'); await waitMarkdown(ids.trash, false);
    await json('/api/trash/restore', 'POST', { noteIds: [ids.trash] }); await waitMarkdown(ids.trash, true);
    await json('/api/notes/' + ids.trash, 'DELETE'); await waitMarkdown(ids.trash, false);
    fs.writeFileSync('/evidence/seed.json', JSON.stringify({ ids, content, draft, urls, oldPaths }, null, 2), { flag: 'wx' });
    console.log('已建立 4 条合成笔记、2 组图片和改正文/改名/回收站证据');
  } else if (mode === 'export-backup') {
    assert.equal(role, 'source'); const seed = readSeed();
    for (const id of Object.values(seed.ids).filter(id => id !== seed.ids.trash)) {
      const { note } = await json('/api/notes/' + id);
      await json('/api/notes/' + id, 'PATCH', { title: note.title });
      // 为封存时补入的摘要触发真实增量导出。
      if (note.summary) await waitMarkdownText(id, note.summary);
      else await waitMarkdown(id, true);
    }
    const exported = await request('/api/export');
    fs.writeFileSync('/evidence/export.zip', Buffer.from(await exported.arrayBuffer()), { flag: 'wx' });
    const backup = await json('/api/backup', 'POST');
    fs.writeFileSync('/evidence/backup.json', JSON.stringify(backup, null, 2), { flag: 'wx' });
    console.log('ZIP 与产品备份已完成，请立即停止源实例并固化配对快照');
  } else if (mode === 'import-twice') {
    assert.equal(role, 'import'); const db = sqlite(false);
    assert.equal(db.prepare('SELECT count(*) n FROM notes').get().n, 0); db.close();
    const zip = fs.readFileSync('/evidence/export.zip');
    const first = await json('/api/import', 'POST', zip);
    const second = await json('/api/import', 'POST', zip);
    fs.writeFileSync('/evidence/import-reports.json', JSON.stringify({ first, second }, null, 2), { flag: 'wx' });
    assert.equal(first.imported, 3); assert.equal(first.images, 2); assert.equal(first.failed.length, 0);
    assert.equal(second.imported, 0); assert.equal(second.overwritten, 0); assert.equal(second.images, 0);
    assert.equal(second.skipped.length, 3); assert.equal(second.failed.length, 0);
    const check = sqlite(false);
    assert.equal(check.prepare("SELECT count(*) n FROM ai_jobs WHERE type='note_process'").get().n, 0);
    assert.equal(check.prepare("SELECT count(*) n FROM notes WHERE ai_status <> 'skipped'").get().n, 0); check.close();
    console.log('ZIP 两次导入报告通过');
  } else if (mode === 'readback') {
    assert.equal(role, 'restore');
    const conv = await json('/api/chat/conversations/r2-conv');
    assert.equal(conv.messages.length, 1); assert.equal(conv.sourceNoteIds.length, 1);
    const search = await json('/api/search?q=' + encodeURIComponent('雨后青竹'));
    assert.ok(search.results.some(row => row.id === conv.sourceNoteIds[0]), '搜索未命中已知来源');
    for (const id of conv.sourceNoteIds) await json('/api/notes/' + id);
    const db = sqlite(false);
    for (const row of db.prepare('SELECT filename FROM images').all()) {
      const response = await request('/api/images/' + row.filename);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync('/data/uploads/' + row.filename));
    }
    db.close();
    fs.writeFileSync('/evidence/readback.json', JSON.stringify({ conv, search }, null, 2));
    console.log('会话、来源、关键词搜索、正文和图片 HTTP 读取通过；浏览器另验');
  } else if (mode === 'persist') {
    assert.equal(role, 'restore');
    const note = await json('/api/notes', 'POST', { content: 'R2 重启持久化：霜叶红于二月花。' });
    await waitMarkdown(note.id, true);
    fs.writeFileSync('/evidence/persist.json', JSON.stringify(note), { flag: 'wx' });
    console.log('已写入重启标记');
  } else if (mode === 'check-persist') {
    assert.equal(role, 'restore');
    const id = JSON.parse(fs.readFileSync('/evidence/persist.json', 'utf8')).id;
    const { note } = await json('/api/notes/' + id);
    assert.equal(note.content, 'R2 重启持久化：霜叶红于二月花。');
    await waitMarkdown(id, true); console.log('重启后正文和 Markdown 保留');
  } else { throw new Error('未知步骤：' + mode); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
