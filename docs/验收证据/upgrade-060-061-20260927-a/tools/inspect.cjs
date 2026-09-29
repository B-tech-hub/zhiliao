// 只读检查升级彩排合成库；通过当前镜像自身的原生 SQLite 模块读取。复制自 R2 inspect，另记迁移表与镜像版本。
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const req = require('node:module').createRequire('/app/package.json');
assert.equal(process.env.DATABASE_PATH, '/data/db/app.db');
assert.match(process.env.R2_RUN || '', /^u061-\d{8}-[a-z0-9]+$/);
assert.ok(['old', 'rollback'].includes(process.env.R2_ROLE));
const db = new (req('better-sqlite3'))('/data/db/app.db', { readonly: true, fileMustExist: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const integrity = db.pragma('integrity_check');
assert.deepEqual(integrity, [{ integrity_check: 'ok' }]);
const settings = db.prepare('SELECT key, value FROM settings ORDER BY key').all();
assert.ok(!settings.some(row => /^(llm|embedding|vision|image|reasoning)_(base_url|api_key|model)$/.test(row.key) && row.value));
// 模型配置也可能来自环境变量，五组都不应出现在验收容器里
const modelEnv = Object.keys(process.env).filter(key => /^(LLM|EMBEDDING|VISION|IMAGE|REASONING)_(BASE_URL|API_KEY|MODEL)$/.test(key) && process.env[key].trim());
assert.deepEqual(modelEnv, [], '容器环境带有模型配置');
assert.equal(settings.find(row => row.key === 'weekly_review_enabled')?.value, '0');
const files = Object.fromEntries(fs.readdirSync('/data/uploads').sort().map(name => {
  const bytes = fs.readFileSync('/data/uploads/' + name);
  return [name, { bytes: bytes.length, sha256: hash(bytes) }];
}));
const imageRows = db.prepare('SELECT * FROM images ORDER BY filename').all();
for (const row of imageRows) {
  assert.ok(files[row.filename], '展示图缺失');
  assert.equal(files[row.filename].bytes, row.size);
  if (row.original_filename) {
    assert.ok(files[row.original_filename], '原件缺失');
    assert.equal(files[row.original_filename].bytes, row.original_size);
  }
}
function canonicalContent(content) {
  return content.replace(/\/api\/images\/([A-Za-z0-9_.-]+)/g, (_match, name) => {
    assert.ok(files[name], '正文引用缺图');
    return 'image-sha256:' + files[name].sha256;
  });
}
const rows = db.prepare('SELECT n.*, t.name AS topic_name FROM notes n JOIN topics t ON t.id=n.topic_id ORDER BY n.id').all();
const exportedNotes = rows.filter(n => n.deleted_at === null).map(n => ({
  id: n.id, title: n.title, content: canonicalContent(n.content), topic: n.topic_name,
  tags: db.prepare('SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id=t.id WHERE nt.note_id=? ORDER BY t.name').all(n.id).map(t => t.name),
  summary: n.summary, created: n.created_at, updated: n.updated_at,
}));
const tables = {};
// 队列和调度状态允许启动后变化，原始快照另保留这些表；此处只比较持久业务内容。
for (const table of ['notes', 'topics', 'tags', 'note_tags', 'images', 'conversations', 'conversation_sources', 'messages', 'api_tokens', 'correction_examples']) {
  const contents = db.prepare('SELECT * FROM "' + table + '"').all();
  tables[table] = hash(JSON.stringify(contents.map(row => JSON.stringify(row)).sort()));
}
const pairedImages = imageRows.map(row => ({
  display: files[row.filename].sha256,
  original: row.original_filename ? files[row.original_filename].sha256 : null,
})).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const migrations = db.prepare('SELECT id FROM _migrations ORDER BY id').all().map(row => row.id);
const appVersion = JSON.parse(fs.readFileSync('/app/package.json', 'utf8')).version;
console.log(JSON.stringify({ appVersion, migrations, integrity, exportedNotes, pairedImages, tables, files,
  counts: { active: exportedNotes.length, trash: rows.length - exportedNotes.length, images: imageRows.length },
  modelConfigured: false, weeklyReviewEnabled: false }, null, 2));
db.close();
