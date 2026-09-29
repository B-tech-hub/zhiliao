// 仅在 TipTap 浏览器验收的专用容器内执行；不接受远程地址，也不读取宿主配置。
const fs = require('node:fs');
const assert = require('node:assert/strict');
const req = require('node:module').createRequire('/app/package.json');
const mode = process.argv[2];
const arg = process.argv[3];
assert.equal(process.env.DATABASE_PATH, '/data/db/app.db');
assert.match(process.env.T_RUN || '', /^t061-\d{8}-[a-z0-9]+$/);
const sqlite = writable => new (req('better-sqlite3'))('/data/db/app.db', { readonly: !writable, fileMustExist: true });
const setSetting = (db, key, value) => db.prepare('INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES (?,?,?)').run(key, value, Date.now());
let cookie = '';
async function request(url, method = 'GET', data) {
  const headers = { Cookie: cookie };
  let body = data;
  if (data && !(data instanceof FormData)) { body = JSON.stringify(data); headers['Content-Type'] = 'application/json'; }
  const response = await fetch('http://127.0.0.1:3000' + url, { method, body, headers, signal: AbortSignal.timeout(60000) });
  assert.ok(response.ok, method + ' ' + url + ' HTTP ' + response.status);
  return response;
}
const json = async (...args) => (await request(...args)).json();
async function login() {
  const response = await request('/api/auth/login', 'POST', { password: process.env.APP_PASSWORD });
  cookie = response.headers.get('set-cookie')?.split(';')[0] || '';
  assert.ok(cookie, '没有登录 Cookie');
}
async function main() {
  if (mode === 'set-mermaid') {
    // 仅在实例停止时执行；同时确认没有任何模型配置、关闭每周回顾
    assert.ok(['0', '1'].includes(arg));
    const db = sqlite(true);
    setSetting(db, 'weekly_review_enabled', '0');
    setSetting(db, 'feature_mermaid_enabled', arg);
    const configured = db.prepare('SELECT key FROM settings WHERE value <> \'\' AND key GLOB \'*_api_key\'').all();
    assert.deepEqual(configured, [], '验收库带有模型密钥');
    db.close(); console.log('已设置 mermaid=' + arg); return;
  }
  await login();
  if (mode === 'seed') {
    // 每轮新建一组笔记；图片走真实上传接口，正文先写普通 Markdown 图片，由浏览器用工具条设属性
    const round = 'm' + arg;
    const target = '/evidence/seed-' + round + '.json';
    assert.ok(!fs.existsSync(target));
    const upload = async name => {
      const form = new FormData(); form.append('file', new Blob([fs.readFileSync('/t/fixtures/pattern.png')]), name);
      return (await json('/api/uploads', 'POST', form)).url;
    };
    const urls = {};
    for (const key of ['center', 'width', 'right', 'plain', 'table', 'danger']) urls[key] = await upload(round + '-' + key + '.png');
    const content = {
      center: '宽度居中口令：' + round + '。\n\n![甲](' + urls.center + ')\n\n尾段。',
      width: '仅宽度口令：' + round + '。\n\n![乙](' + urls.width + ')\n\n尾段。',
      right: '仅右对齐口令：' + round + '。\n\n![丙](' + urls.right + ')\n\n尾段。',
      plain: '普通图片口令：' + round + '。\n\n![丁](' + urls.plain + ')\n\n尾段。',
      table: '相邻表格口令：' + round + '。\n\n<img src="' + urls.table + '" width="50%" alt="戊"><table><tr><th>表头</th><th>数值</th></tr><tr><td>内容</td><td>42</td></tr></table>\n\n尾段。',
      danger: '危险属性口令：' + round + '。\n\n<img src="' + urls.danger + '" width="50%" onerror="window.__xss=1" onload="window.__xss=2" data-pm-slice=\'{"__proto__":{"onerror":"window.__xss=3"}}\' style="display: block; margin-left: auto; margin-right: auto; background:url(javascript:window.__xss=4)" alt="己">\n\n<img src="/api/images/missing-xss.png" onerror="window.__xss=5">\n\n[链接](javascript:window.__xss=6)\n\n尾段。',
    };
    const ids = {};
    for (const [key, body] of Object.entries(content)) ids[key] = (await json('/api/notes', 'POST', { content: body })).id;
    fs.writeFileSync(target, JSON.stringify({ round, ids, urls, content }, null, 2), { flag: 'wx' });
    console.log('已建立 ' + round + ' 轮 6 条笔记');
  } else if (mode === 'dump') {
    // 导出每轮笔记的数据库正文，作为 DB 断言的归档证据
    const seed = JSON.parse(fs.readFileSync('/evidence/seed-m' + arg + '.json', 'utf8'));
    const out = {};
    for (const [key, id] of Object.entries(seed.ids)) out[key] = (await json('/api/notes/' + id)).note.content;
    fs.writeFileSync('/evidence/db-content-m' + arg + '.json', JSON.stringify(out, null, 2), { flag: 'wx' });
    console.log('已导出 m' + arg + ' 轮数据库正文');
  } else { throw new Error('未知步骤：' + mode); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
