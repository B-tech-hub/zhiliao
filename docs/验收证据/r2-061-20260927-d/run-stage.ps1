param([ValidateSet('build','data','ui-start','ui-stop')][string]$Stage)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$sheet = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'operation-sheet.md'), [Text.Encoding]::UTF8)
$blocks = @([regex]::Matches($sheet, '(?ms)^```powershell\r?\n(.*?)^```') | ForEach-Object { $_.Groups[1].Value })
if ($blocks.Count -ne 15) { throw '操作单块数量改变，停止' }
. ([scriptblock]::Create($blocks[1]))
$indices = switch ($Stage) { 'build' { @(2,3,4) } 'data' { @(5,6,7,8,9,10,11) } 'ui-start' { @(12) } 'ui-stop' { @(13,14) } }
$stageFailed = $false
try {
    foreach ($index in $indices) {
        $entry = @{ stage=$Stage; block=$index; event='start'; time=[DateTimeOffset]::Now.ToString('o') }
        [IO.File]::AppendAllText((Join-Path $PSScriptRoot 'stages.jsonl'), ($entry | ConvertTo-Json -Compress) + "`n", [Text.UTF8Encoding]::new($false))
        Write-Output "R2 $Stage block $index start"
        . ([scriptblock]::Create($blocks[$index]))
        $entry.event='passed'; $entry.time=[DateTimeOffset]::Now.ToString('o')
        [IO.File]::AppendAllText((Join-Path $PSScriptRoot 'stages.jsonl'), ($entry | ConvertTo-Json -Compress) + "`n", [Text.UTF8Encoding]::new($false))
    }
} catch {
    $stageFailed = $true
    $failure = @{ stage=$Stage; block=$index; event='failed'; time=[DateTimeOffset]::Now.ToString('o'); error=$_.Exception.Message }
    [IO.File]::AppendAllText((Join-Path $PSScriptRoot 'stages.jsonl'), ($failure | ConvertTo-Json -Compress) + "`n", [Text.UTF8Encoding]::new($false))
    Write-Output "R2 $Stage failed at block $index : $($_.Exception.Message)"
    foreach ($role in 'source','import','restore') {
        try {
            $ids = @(Dkr ps -aq --filter "label=com.docker.compose.project=zhiliao-r2-$r2Run-$role")
            if ($ids.Count -gt 0) {
                R2 $role stop app
                Save-R2Text "failure-$role-app.log" { R2 $role logs --no-color --timestamps app }
            }
        } catch { Write-Output "失败现场停止/留证异常：$role $($_.Exception.Message)" }
    }
    if (Test-Path -LiteralPath (Join-Path $r2Work 'resources-before.txt')) {
        try { . ([scriptblock]::Create($blocks[14])) } catch { Write-Output "资源复核异常：$($_.Exception.Message)" }
    }
} finally {
    try { Stop-Transcript | Out-Null } catch { }
}
if ($stageFailed) { exit 1 }