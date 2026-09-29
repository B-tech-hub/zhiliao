import hashlib
import json
import pathlib
import shlex
import subprocess

root = pathlib.Path(__file__).parent
initializers = json.loads((root / 'initializers.json').read_text())
results = []

def linux_path(value):
    return '/mnt/' + value.drive[0].lower() + value.as_posix()[2:]

def snapshot(folder):
    return {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in folder.rglob('*') if p.is_file()}

for job, script in initializers.items():
    syntax = subprocess.run(['wsl.exe', '--exec', '/bin/bash', '--noprofile', '--norc', '-n', '-s'],
                            input=script.encode(), capture_output=True, timeout=20)
    assert syntax.returncode == 0, syntax.stderr
    results.append({'job': job, 'case': 'bash_syntax', 'exit_code': syntax.returncode})
    for case in ['empty', 'occupied', 'missing_runner_temp']:
        directory = root / 'shell fixtures' / job / case
        runner = directory / 'runner temp'
        runner.mkdir(parents=True)
        if case == 'occupied':
            for name in ['gate4-docker', 'gate4-anonymous', 'gate4-build', 'gate4-install']:
                (runner / name).mkdir()
                (runner / name / 'sentinel.txt').write_text('existing fixture')
        environment_file = directory / 'github env'
        environment_file.write_text('UNRELATED=preserved\n')
        before_files = snapshot(runner)
        before_entries = sorted(p.relative_to(runner).as_posix() for p in runner.rglob('*'))
        linux_runner = linux_path(runner)
        setup = ('unset RUNNER_TEMP\n' if case == 'missing_runner_temp' else
                 'export RUNNER_TEMP=' + shlex.quote(linux_runner) + '\n')
        setup += 'export GITHUB_ENV=' + shlex.quote(linux_path(environment_file)) + '\n'
        setup += 'export EVIDENCE=old-evidence DOCKER_HOST=old-host DOCKER_CONFIG=old-config\n'
        result = subprocess.run(['wsl.exe', '--exec', '/bin/bash', '--noprofile', '--norc', '-s'],
                                input=(setup + script).encode(), capture_output=True, timeout=20)
        values = dict(line.split('=', 1) for line in environment_file.read_text().splitlines())
        expected = {'UNRELATED': 'preserved'}
        if case != 'missing_runner_temp':
            expected['EVIDENCE'] = linux_runner + '/gate4-' + job
            if job == 'install':
                expected.update(DOCKER_HOST='unix://' + linux_runner + '/gate4-docker/docker.sock',
                                DOCKER_CONFIG=linux_runner + '/gate4-anonymous')
            assert result.returncode == 0, result.stderr
        else:
            assert result.returncode != 0
            assert b'unbound variable' in result.stderr
        assert values == expected, (values, expected)
        assert snapshot(runner) == before_files
        assert sorted(p.relative_to(runner).as_posix() for p in runner.rglob('*')) == before_entries
        results.append({'job': job, 'case': case, 'exit_code': result.returncode,
                        'values_matched': True, 'runner_files_unchanged': True,
                        'existing_environment_preserved': True})

report = {'status': 'passed', 'scope': 'Only initialization snippets; no Docker, build, or GitHub execution',
          'cases': results}
(root / 'bash-init.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
