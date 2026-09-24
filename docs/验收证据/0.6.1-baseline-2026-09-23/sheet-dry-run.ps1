# 用桩 docker/py 逐条干跑 R2 操作单：只核对参数透传与步骤衔接，不调用 Docker、Python 或网络
param([string]$Sheet = (Join-Path $PSScriptRoot '../../R2出口与恢复操作单-2026-09-23.md'))
$ErrorActionPreference = 'Stop'
$text = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Sheet).Path, [Text.Encoding]::UTF8)
$blocks = @([regex]::Matches($text, '(?ms)^```powershell\r?\n(.*?)^```') | ForEach-Object { $_.Groups[1].Value })
$prepare = @($blocks | Where-Object { $_ -match 'prepare-workspace\.ps1' })
$steps = @($blocks | Where-Object { $_ -notmatch 'prepare-workspace\.ps1' })
if ($prepare.Count -ne 1 -or $steps.Count -lt 5) { throw '操作单代码块结构与预期不符' }
$runId = [regex]::Match($text, '\$r2Run = ''([^'']+)''').Groups[1].Value
if (-not $runId -or $prepare[0] -notmatch ('-RunId ' + [regex]::Escape($runId))) { throw '准备脚本的 RunId 与 $r2Run 不一致' }

$realTemp = $env:TEMP
$fakeTemp = Join-Path $realTemp ('zhiliao-r2-sheet-dry-run-' + [guid]::NewGuid().ToString('N'))
$work = Join-Path $fakeTemp "zhiliao-r2-$runId"
$script:dockerCalls = [Collections.Generic.List[object]]::new()
$script:pyCalls = [Collections.Generic.List[object]]::new()
$script:execFails = $false
$script:startedAt = '2026-09-23T00:00:00Z'
function docker {
    $script:dockerCalls.Add(@($args))
    $global:LASTEXITCODE = 0
    if ($script:execFails -and $args -contains 'exec') { $global:LASTEXITCODE = 1; return }
    if ($args[0] -eq 'ps') { if ($args -contains '-aq') { 'stub-production-id' } else { 'zhiliao' } }
    elseif ($args[0] -eq 'volume') { 'zhiliao_data' }
    elseif ($args[0] -eq 'inspect') { "/zhiliao stub-production-id running $script:startedAt 0 []" }
    elseif ($args -contains '/r2/inspect.cjs') { '{"stub":true}' }
}
function py { $script:pyCalls.Add(@($args)); $global:LASTEXITCODE = 0 }
function Get-NetTCPConnection { }
foreach ($name in 'docker', 'py', 'Get-NetTCPConnection') {
    if ((Get-Command $name).CommandType -ne 'Function') { throw "桩未生效：$name" }
}
$negative = [ordered]@{}
try {
    foreach ($dir in 'source', 'import', 'restore', 'snapshot', 'source-backups/uploads-2026-09-23') {
        [IO.Directory]::CreateDirectory((Join-Path $work $dir)) | Out-Null
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'candidate-identity.json') -Destination $work
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'r2') -Destination (Join-Path $work 'package') -Recurse
    # 桩文件只让复制与存在性检查走通，内容不参与比对
    foreach ($file in 'source/export.zip', 'source-backups/app-2026-09-23.db', 'source-backups/uploads-2026-09-23/stub.png') {
        [IO.File]::WriteAllText((Join-Path $work $file), 'stub')
    }
    $env:TEMP = $fakeTemp
    $index = 0
    foreach ($step in $steps) {
        $index++
        try { . ([scriptblock]::Create($step)) } catch { throw "第 $index 个命令块失败：$($_.Exception.Message)" }
    }
    $positiveCalls = $script:dockerCalls.Count

    # 反例：就绪超时、未知角色、重复写证据、正式实例变化都必须停止
    function Start-Sleep { }
    $script:execFails = $true
    try { Wait-R2Health source; $negative['就绪超时'] = '未抛错' } catch {
        $tries = $script:dockerCalls.Count - $positiveCalls
        $negative['就绪超时'] = if ($_.Exception.Message -like 'healthz 未就绪*' -and $tries -eq 60) { 'ok' } else { "$tries 次：$($_.Exception.Message)" }
    }
    $script:execFails = $false
    try { R2 bogus up -d app; $negative['未知角色'] = '未抛错' } catch {
        $negative['未知角色'] = if ($_.Exception.Message -like '未知角色*') { 'ok' } else { $_.Exception.Message }
    }
    try { Save-R2Text 'image.json' { 'stub' }; $negative['证据不覆盖'] = '未抛错' } catch {
        $negative['证据不覆盖'] = if ($_.Exception.Message -like '证据已存在*') { 'ok' } else { $_.Exception.Message }
    }
    $script:startedAt = '2026-09-24T00:00:00Z'
    $final = $steps[-1] -replace 'resources-after\.txt', 'resources-after-negative.txt'
    try { . ([scriptblock]::Create($final)); $negative['正式实例变化'] = '未抛错' } catch {
        $negative['正式实例变化'] = if ($_.Exception.Message -like '正式实例或非本轮卷有变化*') { 'ok' } else { $_.Exception.Message }
    }
} finally {
    $env:TEMP = $realTemp
    try { Stop-Transcript | Out-Null } catch { }
    if (Test-Path -LiteralPath $fakeTemp) { Remove-Item -LiteralPath $fakeTemp -Recurse -Force }
}

$problems = [Collections.Generic.List[string]]::new()
$positive = @($script:dockerCalls | Select-Object -First $positiveCalls)
$compose = @($positive | Where-Object { $_[0] -eq 'compose' })
$verbs = @{}
$awaitingHealth = @{}
foreach ($call in $compose) {
    $line = $call -join ' '
    $p = [array]::IndexOf($call, '-p'); $e = [array]::IndexOf($call, '--env-file')
    if ($p -lt 0 -or $e -lt 0) { $problems.Add("缺少 project 或 env：$line"); continue }
    $role = $call[$p + 1] -replace ('^zhiliao-r2-' + [regex]::Escape($runId) + '-'), ''
    if ($role -notin 'source', 'import', 'restore' -or [IO.Path]::GetFileName($call[$e + 1]) -ne "$role.env") { $problems.Add("角色与 env 不一致：$line") }
    $verb = @($call | Where-Object { $_ -in 'up', 'exec', 'run', 'stop', 'restart', 'logs', 'cp', 'config' })[0]
    $verbs[$verb] = 1 + [int]$verbs[$verb]
    $at = [array]::IndexOf($call, $verb)
    $js = [array]::IndexOf($call, '-e')
    # 启动或重启后，同一角色的下一条命令必须是就绪检查
    if ($awaitingHealth[$role] -and -not ($verb -eq 'exec' -and $js -ge 0)) { $problems.Add("启动后未先等待就绪：$line") }
    $awaitingHealth[$role] = $verb -in 'up', 'restart'
    if ($verb -eq 'up' -and $call[$at + 1] -ne '-d') { $problems.Add("up 未带 -d：$line") }
    if ($verb -eq 'exec' -and $call[$at + 1] -ne '-T') { $problems.Add("exec 未带 -T：$line") }
    if ($verb -eq 'run' -and $call -contains '/r2/inspect.cjs' -and $call -notcontains '-T') { $problems.Add("被捕获的 run 未带 -T：$line") }
    if ($js -ge 0 -and ($call[$js + 1] -notlike 'fetch(*' -or $call[$js + 1] -notlike '*process.exit(1))')) { $problems.Add("node -e 脚本被拆开：$line") }
}
$build = @($positive | Where-Object { $_[0] -eq 'build' })
if ($build.Count -ne 1 -or ($build[0] -join ' ') -notmatch '--platform linux/amd64' -or @($build[0] | Where-Object { $_ -eq '--label' }).Count -ne 2) { $problems.Add('构建命令缺平台或来源标签') }
$modes = @($script:pyCalls | ForEach-Object { $_[2] }) -join ','
if ($modes -ne 'manifest,snapshot,zip,restore,restore,snapshot,unchanged') { $problems.Add("compare.py 调用顺序不符：$modes") }
if ($verbs['up'] -ne 7) { $problems.Add("up 次数应为 7，实际 $($verbs['up'])") }
foreach ($key in $negative.Keys) { if ($negative[$key] -ne 'ok') { $problems.Add("反例「$key」未按预期停止：$($negative[$key])") } }
if ($negative.Count -ne 4) { $problems.Add("反例只执行了 $($negative.Count) 项") }
if ($problems.Count -gt 0) { $problems | ForEach-Object { "问题：$_" }; exit 1 }
$summary = ($verbs.Keys | Sort-Object | ForEach-Object { "$_ $($verbs[$_])" }) -join '、'
"干跑通过：$($steps.Count) 个命令块，docker 调用 $positiveCalls 次（compose：$summary），compare.py 调用 $($script:pyCalls.Count) 次；启动/重启后均先等待就绪；反例 $($negative.Count) 项（$($negative.Keys -join '、')）均按预期停止；PowerShell $($PSVersionTable.PSVersion)"
