param([Parameter(Mandatory = $true)][string]$RunId)
# TipTap run c 总控：单实例、GFM 初始表格与全部请求元数据；本文件需另行获准后才能运行。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if ($RunId -cne 't061-20260928-c') { throw '本工具仅用于 t061-20260928-c，不允许复用旧 run' }
$image = 'zhiliao-r2:0.6.1-0a2819f37699'
$imageId = 'sha256:f262652592dd2bd32d00aae44f60d4c98caa2c89ca0942254f77918f57aacb4a'
$port = 3321
$project = "zhiliao-$RunId"
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
$manifestPath = Join-Path $repo 'docs/验收证据/0.6.1-heic-read-2026-09-27/candidate-inputs.json'
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant() -ne '0a2819f376993fafa61b27f57a9a978ff7ef1c7635d88e8485bee7c0655c7baf') { throw '候选清单身份不符' }
foreach ($entry in $manifest.files) {
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $repo $entry.path)).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "候选输入已变化：$($entry.path)" }
}
$work = Join-Path $env:TEMP $project
if (Test-Path -LiteralPath $work) { throw '工作目录已存在，换新 run，不重复执行' }
Get-ChildItem Env: | Where-Object { $_.Name -match '^(T_|COMPOSE_)' } | ForEach-Object { Remove-Item -LiteralPath $_.PSPath }
[IO.Directory]::CreateDirectory($work) | Out-Null
$package = Join-Path $work 'package'
Copy-Item -LiteralPath $PSScriptRoot -Destination $package -Recurse
$evidence = Join-Path $work 'evidence'
[IO.Directory]::CreateDirectory($evidence) | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
function New-Secret { $b = New-Object byte[] 32; $rng.GetBytes($b); ([BitConverter]::ToString($b)).Replace('-', '').ToLowerInvariant() }
$lines = @("T_IMAGE=$image", "T_RUN=$RunId", "T_PASSWORD=$(New-Secret)", "T_SECRET=$(New-Secret)", "T_PORT=$port",
    "T_PACKAGE=$($package.Replace('\','/'))", "T_ARTIFACTS=$($evidence.Replace('\','/'))")
[IO.File]::WriteAllText((Join-Path $work 'app.env'), ($lines -join "`n") + "`n", $utf8)
$rng.Dispose()
Start-Transcript -LiteralPath (Join-Path $work 'transcript.txt') -IncludeInvocationHeader -Append | Out-Null

function Dkr { & docker @args; if ($LASTEXITCODE -ne 0) { throw 'Docker 命令失败，保留现场' } }
function T { Dkr compose --env-file (Join-Path $work 'app.env') -p $project -f (Join-Path $package 'compose.yml') @args }
function Wait-Health {
    for ($attempt = 1; $attempt -le 60; $attempt++) {
        try { T exec -T app node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; return }
        catch { Start-Sleep -Seconds 2 }
    }
    throw 'healthz 未就绪，保留现场'
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
        # 正式实例只用 ps/inspect 读取身份、状态与挂载，不 exec
        $production = @(Dkr ps -aq --no-trunc --filter 'name=^zhiliao$')
        if ($production.Count -ne 1) { throw '未找到唯一的正式容器 zhiliao，先人工确认' }
        Dkr inspect --format '{{.Name}} {{.Id}} {{.State.Status}} {{.State.StartedAt}} {{.RestartCount}} {{json .Mounts}}' $production[0]
        Dkr volume ls --format '{{.Name}}' | Where-Object { $_ -notlike "$project*" } | Sort-Object
    }
}
function Invoke-Browser {
    $round = $args[0]
    $env:PLAYWRIGHT_MODULE_PATH = Join-Path $env:LOCALAPPDATA 'npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright'
    $env:T_CHROMIUM_PATH = Join-Path $env:LOCALAPPDATA 'ms-playwright/chromium-1194/chrome-win/chrome.exe'
    $env:T_WORK = $work; $env:T_OUTPUT = $work
    try { node (Join-Path $package 'browser-check.cjs') $round; $code = $LASTEXITCODE }
    finally { foreach ($n in 'PLAYWRIGHT_MODULE_PATH', 'T_CHROMIUM_PATH', 'T_WORK', 'T_OUTPUT') { Remove-Item "Env:$n" -ErrorAction SilentlyContinue } }
    if ($code -ne 0) { throw "浏览器矩阵 m$round 失败" }
}
function Invoke-Round {
    $round = $args[0]
    T stop app
    T run --rm --no-deps --entrypoint node app /t/fixture.cjs set-mermaid $round
    T up -d app; Wait-Health
    T exec -T app node /t/fixture.cjs seed $round
    Invoke-Browser $round
    T exec -T app node /t/fixture.cjs dump $round
}

$blocks = [ordered]@{
    'preflight' = {
        Save-Resources 'resources-before.txt'
        $taken = @(Dkr ps -a --format '{{.Names}}') + @(Dkr volume ls --format '{{.Name}}') | Where-Object { $_ -like "$project*" }
        if (@($taken).Count -gt 0) { throw '本轮资源名已被占用' }
        if ((Dkr image inspect $image --format '{{.Id}}') -ne $imageId) { throw '候选镜像身份不符' }
        if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "$port 已被占用" }
        Save-Text 'image.json' { Dkr image inspect $image }
        T config --quiet
    }
    'start' = { T up -d app; Wait-Health }
    'round-m0' = { Invoke-Round 0 }
    'round-m1' = { Invoke-Round 1 }
    'stop' = {
        T stop app
        Save-Text 'app.log' { T logs --no-color --timestamps app }
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
        Write-Output "TipTap 验收 $name 开始"
        & $blocks[$name]
        Write-Stage @{ block = $name; event = 'passed'; time = [DateTimeOffset]::Now.ToString('o') }
    }
} catch {
    $failed = $true
    Write-Stage @{ block = $name; event = 'failed'; time = [DateTimeOffset]::Now.ToString('o'); error = $_.Exception.Message }
    Write-Output "TipTap 验收在 $name 失败：$($_.Exception.Message)"
    try {
        if (@(Dkr ps -aq --filter "label=com.docker.compose.project=$project").Count -gt 0) {
            T stop app
            if (-not (Test-Path -LiteralPath (Join-Path $work 'app.log'))) { Save-Text 'app.log' { T logs --no-color --timestamps app } }
        }
    } catch { Write-Output "失败现场留证异常：$($_.Exception.Message)" }
    if (-not (Test-Path -LiteralPath (Join-Path $work 'resources-after.txt'))) {
        try { Save-Resources 'resources-after.txt' } catch { Write-Output "资源复核异常：$($_.Exception.Message)" }
    }
} finally {
    try { Stop-Transcript | Out-Null } catch { }
}
if ($failed) { exit 1 }
Write-Output "TipTap 验收全部阶段通过：$work"
