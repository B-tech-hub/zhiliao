---
title: 'Story 1.2 鍏ㄦ柊鐜瀹夎鍐掔儫涓庤瘉鎹暀瀛?
type: 'chore'
created: '2026-09-09'
status: 'done'
baseline_commit: 'ab5b4b2c27e57d8f2a8cdf08a9310725f6f603b9'
review_loop_iteration: 0
context:
  - 'D:/ClaudeProjects/ai_acknowladge/README.md'
  - 'D:/ClaudeProjects/ai_acknowladge/docs/閮ㄧ讲鎵嬪唽-tailscale.md'
  - 'D:/ClaudeProjects/ai_acknowladge/_bmad-output/planning-artifacts/epics-github-install-distribution-demo.md'

<frozen-after-approval reason="浜虹被纭鍚庣殑鎰忓浘涓嶅彲鐢变唬鐞嗕慨鏀?>

## Intent

**Problem:** Story 1.1 宸插浐瀹?GitHub/v0.6.0 瀹夎鍏ュ彛锛屼絾缂哄皯鍦ㄩ殧绂诲叏鏂扮幆澧冧腑鍙噸澶嶆墽琛屻€佸彲瀹¤鐨勫畨瑁呭惎鍔ㄤ笌棣栨潯绗旇璇佹嵁锛屾棤娉曡瘉鏄庢柊鐢ㄦ埛鑳藉畬鎴愰娆′娇鐢ㄩ棴鐜€?
**Approach:** 鎻愪緵涓€涓笉鎺ヨЕ姝ｅ紡鏁版嵁鐨勯殧绂诲啋鐑熸祦绋嬶紝瑕嗙洊瀹夎銆佸惎鍔ㄣ€佺櫥褰曘€侀鏉＄瑪璁般€侀噸鍚拰鎸佷箙鍖栫洰褰曟鏌ワ紱灏嗙幆澧冧俊鎭€佸懡浠ゃ€佺粨鏋溿€佸け璐ユ仮澶嶄笌璇佹嵁璺緞璁板綍鍒扮増鏈簱鏂囨。锛屽苟鍚屾 README/閮ㄧ讲鎵嬪唽涓殑蹇呰璇存槑銆?
## Boundaries & Constraints

**Always:** 鍥哄畾浣跨敤 v0.6.0 闀滃儚鎴栦粨搴撳凡纭鐨勬彁浜わ紱浣跨敤涓存椂鐩綍銆佷复鏃?Docker project/volume 鍜岄潪姝ｅ紡瀵嗙爜锛涢獙璇?`/api/healthz`銆丼QLite銆佷笂浼犵洰褰曘€乣NOTES_EXPORT_DIR` 涓庨噸鍚悗鐨勬暟鎹繚鐣欙紱璁板綍 OS銆丏ocker/Node 鐗堟湰銆佺鍙ｃ€佽€楁椂鍜岀粨鏋滐紱鎵€鏈夎瘉鎹笉寰楀寘鍚湡瀹炴暟鎹€丄PI Key 鎴栨寮忕幆澧冩枃浠躲€?
**Ask First:** 鑻?Docker 涓嶅彲鐢ㄣ€侀暅鍍忔棤娉曟媺鍙栥€佺鍙ｈ鍗犵敤涓旀棤娉曡嚜鍔ㄩ€夋嫨鏇夸唬绔彛锛屾垨闇€瑕佷慨鏀硅繍琛屾椂浠ｇ爜/compose 鏋舵瀯锛屽厛鍋滄骞舵姤鍛婏紝涓嶆搮鑷墿澶ц寖鍥淬€?
**Never:** 涓嶄娇鐢ㄦ寮?`./data`銆佹寮?Docker 鍗锋垨姝ｅ紡 `.env`锛涗笉杩炴帴鐪熷疄 LLM锛涗笉鎶婁竴娆℃湰鍦板紑鍙戝惎鍔ㄥ啋鍏呯敓浜?Docker 楠屾敹锛涗笉鏂板瀹夎鍣ㄣ€佹闈㈠３鎴?serverless 閮ㄧ讲璺緞銆?
## I/O & Edge-Case Matrix

| 鍦烘櫙 | 杈撳叆 / 鐘舵€?| 棰勬湡杈撳嚭 / 琛屼负 | 閿欒澶勭悊 |
|---|---|---|---|
| 鍏ㄦ柊瀹夎 | 闅旂鐩綍銆佸浐瀹氱増鏈€佷粎蹇呭～鐜鍙橀噺 | 瀹瑰櫒鍚姩锛屽仴搴锋鏌?200锛岀櫥褰曢〉鍙闂?| 璁板綍澶辫触鍛戒护涓庡鍣ㄦ棩蹇楋紝鍋滄骞舵竻鐞嗛殧绂昏祫婧?|
| 棣栨潯绗旇 | 浣跨敤娴嬭瘯瀵嗙爜鐧诲綍骞舵柊寤烘櫘閫氭枃鏈瑪璁?| 绗旇淇濆瓨锛孉I 鏈厤缃椂淇濇寔鍙敤锛屽鍑虹洰褰曞嚭鐜?Markdown | 鑻ュ紓姝ヤ换鍔＄瓑寰呰秴鏃讹紝璁板綍鐘舵€佷笌鏃ュ織锛屼笉淇敼姝ｅ紡鏁版嵁 |
| 閲嶅惎鎸佷箙鍖?| 鍋滄骞堕噸鏂板惎鍔ㄥ悓涓€闅旂 project/volume | 鍋ュ悍妫€鏌ヤ粛涓?200锛屾祴璇曠瑪璁颁粛鍙鍙栵紝SQLite/瀵煎嚭鏂囦欢浠嶅湪棰勬湡浣嶇疆 | 璁板綍鍗枫€佽矾寰勫拰鎭㈠姝ラ |
| 鐜寮傚父 | Docker/闀滃儚/绔彛涓嶅彲鐢?| 涓嶅绉伴獙鏀堕€氳繃 | 浠ラ樆濉為」缁撴潫锛屼繚鐣欒瘖鏂瘉鎹?|

</frozen-after-approval>

## Code Map

- `docker-compose.yml` -- 姝ｅ紡鍥哄畾 v0.6.0 闀滃儚銆?000 绔彛銆佹暟鎹簱/涓婁紶/Markdown 鎸傝浇涓庡繀濉幆澧冨彉閲忋€?- `docker-compose.win.yml` -- Windows Docker Desktop 鐨?named-volume 瑕嗙洊锛岃閬?SQLite WAL bind mount 闄愬埗銆?- `Dockerfile` -- 闀滃儚鍐呯粷瀵规暟鎹矾寰勩€丯ode 22銆佸仴搴锋鏌ヤ笌鍚姩鍛戒护锛涚敤浜庢牳瀵瑰鍣ㄥ唴钀界洏浣嶇疆銆?- `README.md` -- GitHub銆丏ocker銆佹簮鐮佸畨瑁呬富鍏ュ彛鍙婂繀濉幆澧冨彉閲忚鏄庯紱闇€涓庡疄闄呭啋鐑熻矾寰勪繚鎸佷竴鑷淬€?- `docs/閮ㄧ讲鎵嬪唽-tailscale.md` -- Windows/Linux 閮ㄧ讲銆佸惎鍔ㄣ€佸仠姝€佹晠闅滄帓鏌ュ拰鏁版嵁鐩綍璇存槑锛涜ˉ鍏呭彲澶嶇幇璇佹嵁鍏ュ彛銆?- `src/app/api/healthz/route.ts` -- 鍋ュ悍妫€鏌ヨ涓洪敋鐐癸紝鍙楠岃瘉锛屼笉鏀瑰疄鐜般€?- `src/lib/markdown-export.ts` -- `NOTES_EXPORT_DIR` 榛樿鍊间笌瀵煎嚭杈圭晫閿氱偣锛屽彧璇婚獙璇侊紝涓嶆敼瀹炵幇銆?- `scripts/` -- 鐜版湁 demo/宸ュ叿鑴氭湰鐩綍锛涙柊澧為殧绂诲啋鐑熻剼鏈簲淇濇寔鑴氭湰鍖栥€佸彲娓呯悊銆佹棤姝ｅ紡璺緞榛樿鍊笺€?- `_bmad-output/implementation-artifacts/` -- Story 瑙勬牸銆侀獙鏀惰瘉鎹笌 sprint 鐘舵€佽褰曠洰褰曘€?
## Tasks & Acceptance

**Execution:**
- [x] `scripts/smoke-fresh-install.ps1` -- 鍒涘缓闅旂鐩綍涓?compose project锛屾墽琛屽浐瀹氱増鏈畨瑁?鍚姩/鍋ュ悍妫€鏌?鐧诲綍闂幆/閲嶅惎妫€鏌ワ紝骞跺湪澶辫触鏃惰緭鍑哄彲璇婃柇鏃ュ織銆?- [x] `docs/楠屾敹璁板綍-鍏ㄦ柊鐜瀹夎鍐掔儫-2026-09-09.md` -- 璁板綍鐜銆佸懡浠ゃ€佽€楁椂銆佺粨鏋溿€佹暟鎹矾寰勩€侀噸鍚獙璇佸拰澶辫触鎭㈠璇佹嵁锛岀姝㈠啓鍏ョ湡瀹炲瘑閽ユ垨姝ｅ紡鏁版嵁銆?- [x] `README.md` -- 閾炬帴鍙鐜扮殑鍏ㄦ柊鐜鍐掔儫璇存槑锛屾槑纭?Docker 涓?Windows override 鐨勯€夋嫨鍜屾竻鐞嗗懡浠ゃ€?- [x] `docs/閮ㄧ讲鎵嬪唽-tailscale.md` -- 琛ュ厖鍐掔儫楠屾敹鍏ュ彛銆侀殧绂绘暟鎹竟鐣屽拰璇佹嵁璁板綍瑕佹眰锛岄伩鍏嶆妸寮€鍙戝惎鍔ㄥ綋浣滅敓浜ч獙鏀躲€?
**Acceptance Criteria:**
- Given 鍏ㄦ柊闅旂鐩綍鍜?Docker 鍙敤锛寃hen 鎵ц鍐掔儫鑴氭湰锛宼hen 鍥哄畾 v0.6.0 璺緞鍚姩鎴愬姛涓?`/api/healthz` 杩斿洖 200銆?- Given 鍐掔儫瀹炰緥宸插惎鍔紝when 浣跨敤娴嬭瘯瀵嗙爜鐧诲綍骞朵繚瀛橀鏉℃櫘閫氭枃鏈瑪璁帮紝then 绗旇鍙鍙栦笖 Markdown 澧為噺瀵煎嚭鍑虹幇鍦ㄩ殧绂诲鍑虹洰褰曘€?- Given 棣栨潯绗旇宸蹭繚瀛橈紝when 鍋滄骞堕噸鏂板惎鍔ㄥ悓涓€闅旂 project/volume锛宼hen 鍋ュ悍妫€鏌ヤ粛閫氳繃涓旂瑪璁颁笌 SQLite 鏁版嵁浠嶅瓨鍦ㄣ€?- Given 闀滃儚銆丏ocker 鎴栫鍙ｄ笉鍙敤锛寃hen 鎵ц鑴氭湰锛宼hen 杩斿洖闈為浂缁撴灉骞朵繚鐣欐槑纭棩蹇?鎭㈠姝ラ锛屼笖涓嶈Е纰版寮忔暟鎹矾寰勩€?- Given 楠屾敹鏂囨。宸茬敓鎴愶紝when 缁存姢鑰呮寜鏂囨。澶嶆牳锛宼hen 鑳借拷婧増鏈€佸懡浠ゃ€佺幆澧冦€佽瘉鎹枃浠跺拰娓呯悊鏂瑰紡锛屼笖涓嶅寘鍚湡瀹?API Key銆?
## Verification

**Commands:**
- `powershell -ExecutionPolicy Bypass -File scripts/smoke-fresh-install.ps1` -- expected: 闅旂瀹炰緥瀹屾垚鍚姩銆佸仴搴锋鏌ャ€侀鏉＄瑪璁颁笌閲嶅惎鎸佷箙鍖栭獙璇侊紝骞剁敓鎴愯瘉鎹褰曘€?- `npm run lint -- --no-warn-ignored scripts` -- expected: 鏂板鑴氭湰鐩稿叧闈欐€佹鏌ユ棤閿欒锛堣嫢椤圭洰 lint 涓嶈鐩?PowerShell锛屽垯浠ヨ剼鏈嚜妫€鍜屾枃妗ｅ鏍镐负鍑嗭級銆?
**Manual checks (if no CLI):**
- 妫€鏌ヨ瘉鎹枃妗ｄ腑鐨勯暅鍍?tag銆佺鍙ｃ€侀殧绂昏矾寰勩€佹竻鐞嗗懡浠ゅ拰鍋ュ悍妫€鏌ュ搷搴旓紱纭 README 涓庨儴缃叉墜鍐岄摼鎺ユ湁鏁堛€?

## Suggested Review Order

- 入口与隔离资源
  [`smoke-fresh-install.ps1:9`](../../scripts/smoke-fresh-install.ps1#L9)
- 固定镜像与 Compose 配置
  [`smoke-fresh-install.ps1:120`](../../scripts/smoke-fresh-install.ps1#L120)
- 登录与会话验证
  [`smoke-fresh-install.ps1:170`](../../scripts/smoke-fresh-install.ps1#L170)
- 重启持久化断言
  [`smoke-fresh-install.ps1:212`](../../scripts/smoke-fresh-install.ps1#L212)
- 验收证据记录
  [`验收记录-全新环境安装冒烟-2026-09-09.md:1`](../../docs/验收记录-全新环境安装冒烟-2026-09-09.md#L1)

### Review Findings

- [x] [Review][Patch] Docker-only 冒烟在证据阶段无条件调用宿主机 `node --version`，无 Node.js 的合法 Docker 环境会被误判失败 [scripts/smoke-fresh-install.ps1:64-68]
- [x] [Review][Patch] 冒烟仅检查 `/data/uploads` 目录存在，未写入文件并跨重启校验，无法证明上传数据持久化 [scripts/smoke-fresh-install.ps1:193-224]
- [x] [Review][Patch] 失败证据把所有步骤渲染为 `[x]`，失败项会显示为已完成，验收记录可能误导读者 [scripts/smoke-fresh-install.ps1:86]
- [x] [Review][Patch] 失败时诊断日志写入临时目录后默认删除，记录中的日志路径立即失效，且每次运行覆盖同一验收文件，历史证据不可追溯 [scripts/smoke-fresh-install.ps1:16,64-104,231-248]
- [x] [Review][Patch] 成功记录在清理前写入；若 finally 清理失败，脚本退出码为非零但证据仍为“通过”，状态与结果矛盾 [scripts/smoke-fresh-install.ps1:226-247]
- [x] [Review][Patch] Demo 启动器对 8787 端口任意返回 2xx 的本地服务直接复用，可能把笔记发送给非 mock 服务，违反“不会发出外部请求”承诺 [scripts/demo.mjs:37-48]
