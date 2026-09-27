# 单次浏览器补验：仅启停固定恢复实例，原始现场与正式实例只读核对。
# 与 run a 的差异：新证据目录与新基线，并核对 run a 的证据目录未被改动。
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
from datetime import datetime, timezone

ROOT = Path.cwd()
OUT = Path(__file__).resolve().parent
OLD = Path(os.environ['TEMP']) / 'zhiliao-r2-061-20260927-d'
RESTORE = 'b000881c42c1c8b91a9ddaf4bd587bf88edba2cda76885e9a5a263502f119481'
IMAGE = 'sha256:f262652592dd2bd32d00aae44f60d4c98caa2c89ca0942254f77918f57aacb4a'
TAG = 'zhiliao-r2:0.6.1-0a2819f37699'
MANIFEST = '0a2819f376993fafa61b27f57a9a978ff7ef1c7635d88e8485bee7c0655c7baf'
BASELINE = '33b5203e238275093290834b5b4231a528bdde22'
MODULE = Path(os.environ['LOCALAPPDATA']) / 'npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright'
CHROMIUM = Path(os.environ['LOCALAPPDATA']) / 'ms-playwright/chromium-1194/chrome-win/chrome.exe'


def now():
    return datetime.now(timezone.utc).isoformat()


def save(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')


def run(args, timeout=30):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise RuntimeError('命令失败：' + args[0] + ' ' + args[1])
    return result.stdout


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def selected(c):
    return {
        'id': c['Id'], 'name': c['Name'], 'image': c['Image'], 'user': c['Config']['User'],
        'running': c['State']['Running'], 'started': c['State']['StartedAt'],
        'finished': c['State']['FinishedAt'], 'exit_code': c['State']['ExitCode'],
        'restarts': c['RestartCount'], 'network': c['HostConfig']['NetworkMode'],
        'ports': c['HostConfig']['PortBindings'], 'mounts': sorted(c['Mounts'], key=lambda m: m['Destination']),
    }


def resources():
    ids = sorted(set(['zhiliao'] + run(['docker', 'ps', '-aq', '--filter', 'name=zhiliao-r2-']).decode().split()))
    items = json.loads(run(['docker', 'inspect', *ids]))
    return {
        'containers': {c['Id']: selected(c) for c in items},
        'volumes': sorted(run(['docker', 'volume', 'ls', '-q']).decode().split()),
    }


def old_files():
    entries = {}
    dirs = ['0.6.1-baseline-2026-09-23', '0.6.1-registry-2026-09-27', '0.6.1-heic-read-2026-09-27', 'r2-061-20260927-c', 'r2-061-20260927-d', 'r2-browser-061-20260927-a']
    for directory in dirs:
        for file in sorted((ROOT / 'docs/验收证据' / directory).rglob('*')):
            if file.is_file():
                entries[file.relative_to(ROOT).as_posix()] = digest(file)
    for file in sorted(OLD.rglob('*')):
        if file.is_file() and file.suffix != '.env':
            entries['previous-work/' + file.relative_to(OLD).as_posix()] = digest(file)
    return entries


assert OUT == Path(os.environ['TEMP']) / 'zhiliao-r2-browser-061-20260927-b'
assert not (OUT / 'execution.json').exists(), '已有执行记录，拒绝重跑'
assert not (OUT / 'browser.json').exists(), '已有浏览器结果，拒绝覆盖'
execution = {'started': now(), 'status': 'running', 'attempts': 1, 'baseline_commit': BASELINE, 'restore_id': RESTORE, 'image_id': IMAGE, 'image_tag': TAG, 'candidate_manifest_sha256': MANIFEST, 'build_attempts': 0, 'restore_attempts': 0, 'stages': []}
save('execution.json', execution)
before = None
old_before = None
start_attempted = False
try:
    assert run(['git', 'rev-parse', 'HEAD']).decode().strip() == BASELINE
    assert MODULE.is_dir() and CHROMIUM.is_file()
    manifest_path = ROOT / 'docs/验收证据/0.6.1-heic-read-2026-09-27/candidate-inputs.json'
    assert digest(manifest_path) == MANIFEST
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    assert len(manifest['files']) == 276
    for entry in manifest['files']:
        assert digest(ROOT / entry['path']) == entry['sha256'], entry['path']
    assert run(['docker', 'image', 'inspect', TAG, '--format', '{{.Id}}']).decode().strip() == IMAGE
    before = resources()
    save('resources-before.json', before)
    current = before['containers'][RESTORE]
    expected = next(c for c in json.loads((ROOT / 'docs/验收证据/r2-061-20260927-d/runtime-containers.json').read_text(encoding='utf-8')) if c['role'] == 'restore')
    assert current['name'] == expected['name'] and current['image'] == IMAGE
    assert current['user'] == 'node' and current['network'] == 'bridge'
    assert current['ports'] == {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3313'}]}
    assert current['mounts'] == sorted(expected['mounts'], key=lambda m: m['Destination'])
    assert all(not c['running'] for c in before['containers'].values() if c['name'] != '/zhiliao')
    assert len([c for c in before['containers'].values() if '061-20260927-d-' in c['name']]) == 3
    config = json.loads(run(['docker', 'inspect', RESTORE]))[0]['Config']
    values = dict(line.split('=', 1) for line in config['Env'] if '=' in line)
    assert not any(value for key, value in values.items() if 'API_KEY' in key)
    state = json.loads((OLD / 'source-state.json').read_text(encoding='utf-8'))
    assert state['modelConfigured'] is False and state['weeklyReviewEnabled'] is False
    execution['restore_model_configured'] = state['modelConfigured']
    execution['candidate_input_files_verified'] = len(manifest['files'])
    old_before = old_files()
    save('old-files-before.json', old_before)
    execution['stages'].append({'name': 'preflight', 'status': 'passed', 'at': now()})
    save('execution.json', execution)
    start_attempted = True
    run(['docker', 'start', RESTORE])
    execution['stages'].append({'name': 'start', 'status': 'passed', 'at': now()})
    deadline = time.monotonic() + 60
    while True:
        runtime = json.loads(run(['docker', 'inspect', RESTORE]))[0]
        health = runtime['State'].get('Health', {}).get('Status')
        if health == 'healthy':
            break
        assert runtime['State']['Running'] and health != 'unhealthy', '恢复实例健康检查失败'
        assert time.monotonic() < deadline, '恢复实例健康检查超时'
        time.sleep(1)
    save('restore-running.json', selected(runtime))
    execution['stages'].append({'name': 'health', 'status': 'passed', 'at': now()})
    save('execution.json', execution)
    child_env = os.environ.copy()
    child_env['PLAYWRIGHT_MODULE_PATH'] = str(MODULE)
    child_env['R2_CHROMIUM_PATH'] = str(CHROMIUM)
    with (OUT / 'browser.log.txt').open('wb') as log:
        result = subprocess.run(['node', str(OUT / 'browser-check.cjs')], env=child_env, stdout=log, stderr=subprocess.STDOUT, timeout=180)
    execution['browser_exit_code'] = result.returncode
    browser = json.loads((OUT / 'browser.json').read_text(encoding='utf-8'))
    execution['stages'].append({'name': 'browser', 'status': browser['status'], 'at': now()})
    assert result.returncode == 0 and browser['status'] == 'passed', '浏览器矩阵失败，停止且不重试'
    assert len(browser['cases']) == 6 and all(case['status'] == 'passed' for case in browser['cases'])
    assert len(browser['readOnlyRequests']) >= 1, '只读相关笔记请求未被放行'
    execution['status'] = 'passed'
except Exception as error:
    execution['status'] = 'failed'
    execution['error'] = str(error)
finally:
    cleanup_errors = []
    if start_attempted:
        try:
            run(['docker', 'stop', '--time', '15', RESTORE])
            execution['stages'].append({'name': 'stop', 'status': 'passed', 'at': now()})
        except Exception as error:
            cleanup_errors.append(str(error))
        try:
            log = subprocess.run(['docker', 'logs', '--since', execution['started'], RESTORE], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
            (OUT / 'restore-app.log.txt').write_bytes(log.stdout)
            assert log.returncode == 0
        except Exception as error:
            cleanup_errors.append('日志收集失败：' + str(error))
    try:
        after = resources()
        save('resources-after.json', after)
        assert before is not None and old_before is not None
        assert before['volumes'] == after['volumes'], '卷列表变化'
        assert before['containers'].keys() == after['containers'].keys(), '容器集合变化'
        assert not after['containers'][RESTORE]['running'], '恢复实例没有停止'
        for key, old in before['containers'].items():
            new = after['containers'][key]
            if key == RESTORE:
                for field in ['id', 'name', 'image', 'user', 'network', 'ports', 'mounts', 'restarts']:
                    assert old[field] == new[field], field
            else:
                assert old == new, old['name']
        old_after = old_files()
        save('old-files-after.json', old_after)
        assert old_before == old_after, '原证据或旧现场文件变化'
        save('protection-check.json', {'status': 'passed', 'production_and_other_containers_unchanged': True, 'restore_stopped_same_id_image_mounts': True, 'volumes_unchanged': True, 'old_files_verified': len(old_before), 'old_evidence_and_work_unchanged': True})
    except Exception as error:
        cleanup_errors.append('收尾核对失败：' + str(error))
        save('protection-check.json', {'status': 'failed', 'error': str(error)})
    if cleanup_errors:
        execution['status'] = 'failed'
        execution['cleanup_errors'] = cleanup_errors
    execution['finished'] = now()
    save('execution.json', execution)
    print(json.dumps(execution, ensure_ascii=False))
raise SystemExit(0 if execution['status'] == 'passed' else 1)
