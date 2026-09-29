param([Parameter(Mandatory = $true)][string]$RunId)
# 0.6.0 → 0.6.1 隔离升级与回退彩排。按 R2 run-stage 的写法：每块记录开始/通过/失败，失败即停、保留卷与日志，不重试。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if ($RunId -notmatch '^u061-\d{8}-[a-z0-9]+$') { throw '运行标记格式不正确' }
$oldImage = 'ghcr.io/b-tech-hub/zhiliao:0.6.0'
$oldImageId = 'sha256:9d74721d9de527b4f37f5fae9f49de37ba5d55b649dbed2293134c19f250c014'
$newImage = 'zhiliao-r2:0.6.1-0a2819f37699'
$newImageId = 'sha256:f262652592dd2bd32d00aae44f60d4c98caa2c89ca0942254f77918f57aacb4a'
$work = Join-Path $env:TEMP "zhiliao-$RunId"
if (Test-Path -LiteralPath $work) { throw '工作目录已存在，换新 run，不重复执行' }
Get-ChildItem Env: | Where-Object { $_.Name -match '^(R2_|COMPOSE_)' } | ForEach-Object { Remove-Item -LiteralPath $_.PSPath }
[IO.Directory]::CreateDirectory($work) | Out-Null
$package = Join-Path $work 'package'
Copy-Item -LiteralPath $PSScriptRoot -Destination $package -Recurse
foreach ($dir in 'old', 'rollback', 'snapshot') { [IO.Directory]::CreateDirectory((Join-Path $work $dir)) | Out-Null }
$utf8 = [Text.UTF8Encoding]::new($false)
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
function New-Secret { $b = New-Object byte[] 32; $rng.GetBytes($b); ([BitConverter]::ToString($b)).Replace('-', '').ToLowerInvariant() }
# old-060 与 old-061 共用同一 project、卷和凭据，仅镜像不同，模拟用户改 image: 后 up
$oldPassword = New-Secret; $oldSecret = New-Secret
$envs = @{
    'old-060'  = @{ image = $oldImage; role = 'old'; password = $oldPassword; secret = $oldSecret }
    'old-061'  = @{ image = $newImage; role = 'old'; password = $oldPassword; secret = $oldSecret }
    'rollback' = @{ image = $oldImage; role = 'rollback'; password = (New-Secret); secret = (New-Secret) }
}
foreach ($name in $envs.Keys) {
    $e = $envs[$name]
    $lines = @("R2_IMAGE=$($e.image)", "R2_RUN=$RunId", "R2_ROLE=$($e.role)", "R2_PASSWORD=$($e.password)", "R2_SECRET=$($e.secret)",
        "R2_PACKAGE=$($package.Replace('\','/'))", "R2_ARTIFACTS=$((Join-Path $work $e.role).Replace('\','/'))",
        "R2_SNAPSHOT=$((Join-Path $work 'snapshot').Replace('\','/'))")
    [IO.File]::WriteAllText((Join-Path $work "$name.env"), ($lines -join "`n") + "`n", $utf8)
}
$rng.Dispose()
Start-Transcript -LiteralPath (Join-Path $work 'transcript.txt') -IncludeInvocationHeader -Append | Out-Null

function Dkr { & docker @args; if ($LASTEXITCODE -ne 0) { throw 'Docker 命令失败，保留现场' } }
function U {
    $name = $args[0]
    if ($name -notin @('old-060', 'old-061', 'rollback')) { throw "未知阶段：$name" }
    $rest = @($args | Select-Object -Skip 1)
    Dkr compose --env-file (Join-Path $work "$name.env") -p "zhiliao-$RunId-$($envs[$name].role)" -f (Join-Path $package 'compose.yml') @rest
}
function Wait-Health {
    $name = $args[0]
    for ($attempt = 1; $attempt -le 60; $attempt++) {
        try { U $name exec -T app node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; return }
        catch { Start-Sleep -Seconds 2 }
    }
    throw "healthz 未就绪：$name，保留现场"
}
function Save-Text {
    param([string]$File, [scriptblock]$Action)
    $target = Join-Path $work $File
    if (Test-Path -LiteralPath $target) { throw "证据已存在，不覆盖：$File" }
    $out = & $Action
    [IO.File]::WriteAllText($target, ($out -join "`n") + "`n", $utf8)
}
function Save-Resources {
    Save-Text $args[0] {
        # 正式实例只读取身份、状态与挂载；卷清单排除本轮资源
        $production = @(Dkr ps -aq --no-trunc --filter 'name=^zhiliao$')
        if ($production.Count -ne 1) { throw '未找到唯一的正式容器 zhiliao，先人工确认' }
        Dkr inspect --format '{{.Name}} {{.Id}} {{.State.Status}} {{.State.StartedAt}} {{.RestartCount}} {{json .Mounts}}' $production[0]
        Dkr volume ls --format '{{.Name}}' | Where-Object { $_ -notlike "zhiliao-$RunId-*" } | Sort-Object
    }
}
function Compare-Py { py -3 (Join-Path $package 'compare.py') @args; if ($LASTEXITCODE -ne 0) { throw "比对失败：$($args -join ' ')" } }

$blocks = [ordered]@{
    'preflight' = {
        Save-Resources 'resources-before.txt'
        $taken = @(Dkr ps -a --format '{{.Names}}') + @(Dkr volume ls --format '{{.Name}}') | Where-Object { $_ -like "zhiliao-$RunId-*" }
        if (@($taken).Count -gt 0) { throw '本轮资源名已被占用' }
        if ((Dkr image inspect $oldImage --format '{{.Id}}') -ne $oldImageId) { throw '0.6.0 镜像身份不符' }
        if ((Dkr image inspect $newImage --format '{{.Id}}') -ne $newImageId) { throw '0.6.1 候选镜像身份不符' }
        Save-Text 'images.json' { Dkr image inspect $oldImage $newImage }
        foreach ($name in 'old-060', 'old-061', 'rollback') { U $name config --quiet }
    }
    'seed-060' = {
        U old-060 up -d app; Wait-Health old-060; U old-060 stop app
        U old-060 run --rm --no-deps --entrypoint node app /r2/fixture.cjs init
        U old-060 up -d app; Wait-Health old-060
        U old-060 exec -T app node /r2/fixture.cjs seed
        U old-060 stop app
        U old-060 run --rm --no-deps --entrypoint node app /r2/fixture.cjs seal
        U old-060 up -d app; Wait-Health old-060
        U old-060 exec -T app node /r2/fixture.cjs backup
        U old-060 stop app
        Save-Text 'old-060-state.json' { U old-060 run --rm --no-deps -T --entrypoint node app /r2/inspect.cjs }
        Save-Text 'old-060-app.log' { U old-060 logs --no-color --timestamps app }
    }
    'snapshot' = {
        U old-060 cp app:/data/db/backups (Join-Path $work 'old-backups')
        $db = @(Get-ChildItem -LiteralPath (Join-Path $work 'old-backups') -Filter 'app-*.db')
        if ($db.Count -ne 1) { throw '必须明确唯一的升级前配对快照' }
        $uploads = Join-Path $db[0].DirectoryName "uploads-$($db[0].BaseName.Substring(4))"
        if (-not (Test-Path -LiteralPath $uploads -PathType Container)) { throw '缺少图片快照' }
        Copy-Item -LiteralPath $db[0].FullName -Destination (Join-Path $work 'snapshot/app.db')
        Copy-Item -LiteralPath $uploads -Destination (Join-Path $work 'snapshot/uploads') -Recurse
        Compare-Py snapshot (Join-Path $work 'snapshot') (Join-Path $work 'snapshot-before.json')
    }
    'upgrade-061' = {
        # 同一 project 与卷，只换镜像；compose 会用新镜像重建容器
        U old-061 up -d app; Wait-Health old-061
        U old-061 exec -T app node /r2/fixture.cjs upgrade-readback
        Save-Text 'old-061-state.json' { U old-061 exec -T app node /r2/inspect.cjs }
        Compare-Py upgrade (Join-Path $work 'old-060-state.json') (Join-Path $work 'old-061-state.json')
        U old-061 exec -T app node /r2/fixture.cjs persist
        U old-061 restart app; Wait-Health old-061
        U old-061 exec -T app node /r2/fixture.cjs check-persist
        U old-061 stop app
        Save-Text 'old-061-final-state.json' { U old-061 run --rm --no-deps -T --entrypoint node app /r2/inspect.cjs }
        Save-Text 'old-061-app.log' { U old-061 logs --no-color --timestamps app }
    }
    'rollback-060' = {
        foreach ($f in 'seed.json', 'persist.json') { Copy-Item -LiteralPath (Join-Path $work "old/$f") -Destination (Join-Path $work "rollback/$f") }
        U rollback run --rm --no-deps prepare
        Save-Text 'rollback-before-start.json' { U rollback run --rm --no-deps -T --entrypoint node app /r2/inspect.cjs }
        U rollback up -d app; Wait-Health rollback
        U rollback exec -T app node /r2/fixture.cjs rollback-readback
        Save-Text 'rollback-after-start.json' { U rollback exec -T app node /r2/inspect.cjs }
        U rollback stop app
        Save-Text 'rollback-app.log' { U rollback logs --no-color --timestamps app }
        foreach ($report in 'rollback-before-start.json', 'rollback-after-start.json') {
            Compare-Py rollback (Join-Path $work 'old-060-state.json') (Join-Path $work $report)
        }
    }
    'protect' = {
        Compare-Py snapshot (Join-Path $work 'snapshot') (Join-Path $work 'snapshot-after.json')
        Compare-Py unchanged (Join-Path $work 'snapshot-before.json') (Join-Path $work 'snapshot-after.json')
        Save-Resources 'resources-after.txt'
        if ((Get-Content -Raw -LiteralPath (Join-Path $work 'resources-before.txt')) -cne (Get-Content -Raw -LiteralPath (Join-Path $work 'resources-after.txt'))) { throw '正式实例或非本轮卷有变化，停止并人工核对' }
    }
}
$failed = $false
$stagesFile = Join-Path $work 'stages.jsonl'
function Write-Stage($entry) { [IO.File]::AppendAllText($stagesFile, ($entry | ConvertTo-Json -Compress) + "`n", $utf8) }
try {
    foreach ($name in $blocks.Keys) {
        Write-Stage @{ block = $name; event = 'start'; time = [DateTimeOffset]::Now.ToString('o') }
        Write-Output "升级彩排 $name 开始"
        & $blocks[$name]
        Write-Stage @{ block = $name; event = 'passed'; time = [DateTimeOffset]::Now.ToString('o') }
    }
} catch {
    $failed = $true
    Write-Stage @{ block = $name; event = 'failed'; time = [DateTimeOffset]::Now.ToString('o'); error = $_.Exception.Message }
    Write-Output "升级彩排在 $name 失败：$($_.Exception.Message)"
    foreach ($pair in @(@('old-061', 'old'), @('rollback', 'rollback'))) {
        try {
            if (@(Dkr ps -aq --filter "label=com.docker.compose.project=zhiliao-$RunId-$($pair[1])").Count -gt 0) {
                U $pair[0] stop app
                Save-Text "failure-$($pair[1])-app.log" { U $pair[0] logs --no-color --timestamps app }
            }
        } catch { Write-Output "失败现场留证异常：$($pair[1]) $($_.Exception.Message)" }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $work 'resources-after.txt'))) {
        try { Save-Resources 'resources-after.txt' } catch { Write-Output "资源复核异常：$($_.Exception.Message)" }
    }
} finally {
    try { Stop-Transcript | Out-Null } catch { }
}
if ($failed) { exit 1 }
Write-Output "升级彩排全部阶段通过：$work"
