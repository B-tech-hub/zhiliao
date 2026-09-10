param(
  [ValidateRange(1, 65535)]
  [int]$Port = 3300,
  [switch]$KeepResources
)

$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$project = "zhiliao-smoke-$stamp-$([guid]::NewGuid().ToString('N').Substring(0, 8))".ToLowerInvariant()
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$work = Join-Path ([IO.Path]::GetTempPath()) $project
$notesDir = Join-Path $work "notes"
$envFile = Join-Path $work ".env"
$composeFile = Join-Path $work "compose.yml"
$failureLog = Join-Path $work "failure.log"
$evidence = Join-Path $repoRoot "docs/验收记录-全新环境安装冒烟-$stamp.md"
$image = "ghcr.io/b-tech-hub/zhiliao:0.6.0"
$smokePassword = "smoke-only-password"
$smokeSessionSecret = "smoke-session-secret-0123456789abcdef"
$startedAt = Get-Date
$steps = [System.Collections.Generic.List[string]]::new()
$exitCode = 0

function Write-Utf8NoBom([string]$Path, [string[]]$Lines) {
  [IO.File]::WriteAllLines($Path, $Lines, [Text.UTF8Encoding]::new($false))
}

function Invoke-Compose([string[]]$Arguments) {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & docker @composeArgs @Arguments 2>&1
    $composeExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($composeExitCode -ne 0) {
    $details = $output -join [Environment]::NewLine
    throw ("docker compose {0} 失败：{1}" -f ($Arguments -join " "), $details)
  }
  return $output
}

function Wait-Healthy {
  $url = "http://127.0.0.1:$Port/api/healthz"
  $lastError = "无响应"
  foreach ($attempt in 1..60) {
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200) { return }
      $lastError = "HTTP $($response.StatusCode)"
    } catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Seconds 2
  }
  throw "健康检查超时：$url；最近错误：$lastError"
}

function Test-ContainerPath([string]$Path) {
  Invoke-Compose @("exec", "-T", "app", "node", "-e", "require('fs').accessSync('$Path')") | Out-Null
}

function Write-Evidence([string]$Status, [string]$Failure = "") {
  $duration = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
  $dockerVersion = (& docker version --format "{{.Server.Version}}" 2>$null) -join ""
  $nodeVersion = (& node --version 2>$null) -join ""
  if ([string]::IsNullOrWhiteSpace($nodeVersion)) { $nodeVersion = "不可用" }
  $lines = @(
    "# 全新环境安装冒烟验收",
    "",
    "- 日期：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
    "- 平台：$([Environment]::OSVersion.VersionString)",
    "- Docker：$dockerVersion",
    "- Node：$nodeVersion",
    "- 目标镜像：$image",
    "- Compose project：$project",
    "- 端口：$Port",
    "- 耗时：${duration}s",
    "- 状态：$Status",
    "- 数据边界：仅临时 named volume 与临时目录，未使用正式 data/、.env 或正式 Docker 卷",
    "",
    "## 执行结果",
    ""
  )
  $lines += @($steps | ForEach-Object {
    if ($_ -like "失败：*" -or $_ -like "清理失败：*") { "- [ ] $_" } else { "- [x] $_" }
  })
  if ($Failure) {
    $evidenceLog = Join-Path $repoRoot "docs/验收日志-全新环境安装冒烟-$stamp.txt"
    if (Test-Path -LiteralPath $failureLog) { Copy-Item -LiteralPath $failureLog -Destination $evidenceLog -Force }
    $lines += @(
      "",
      "## 失败与恢复",
      "",
      "- 失败原因：$Failure",
      "- 诊断日志：$evidenceLog（临时目录日志：$failureLog）",
      "- 恢复：确认 Docker daemon、固定镜像和端口可用后重新执行脚本；必要时使用 -KeepResources 保留容器查看日志。"
    )
  }
  $lines += @(
    "",
    "## 清理",
    "",
    "默认清理命令：docker compose --project-name $project --project-directory <临时目录> -f <临时 compose.yml> down -v --remove-orphans",
    "使用 -KeepResources 时，临时目录：$work"
  )
  Write-Utf8NoBom $evidence $lines
}

try {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "未找到 docker 命令；请先安装并启动 Docker Desktop。"
  }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker daemon 不可用；请先启动 Docker Desktop。" }

  New-Item -ItemType Directory -Force -Path $notesDir | Out-Null
  Write-Utf8NoBom $envFile @(
    "SMOKE_PASSWORD=$smokePassword",
    "SMOKE_SESSION_SECRET=$smokeSessionSecret"
  )
  $notesPath = $notesDir.Replace("\", "/")
  $composeContent = @"
services:
  app:
    image: $image
    ports:
      - "127.0.0.1:$Port`:3000"
    environment:
      APP_PASSWORD: `${SMOKE_PASSWORD}
      SESSION_SECRET: `${SMOKE_SESSION_SECRET}
      NODE_ENV: development
      NOTES_EXPORT_DIR: /data/notes
      TZ: UTC
    volumes:
      - smoke_db:/data/db
      - smoke_uploads:/data/uploads
      - "$notesPath`:/data/notes"
volumes:
  smoke_db:
  smoke_uploads:
"@
  Write-Utf8NoBom $composeFile ($composeContent -split "`r?`n")

  $composeArgs = @(
    "compose", "--project-name", $project, "--project-directory", $work,
    "--env-file", $envFile, "-f", $composeFile
  )

  & docker image inspect $image *> $null
  if ($LASTEXITCODE -ne 0) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $pullOutput = & docker pull $image 2>&1
      $pullExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($pullExitCode -ne 0) {
      $pullDetails = $pullOutput -join [Environment]::NewLine
      throw ("固定镜像不可用且拉取失败：{0}{1}{2}" -f $image, [Environment]::NewLine, $pullDetails)
    }
    $steps.Add("固定镜像拉取成功：$image")
  } else {
    $steps.Add("固定镜像已存在：$image")
  }

  Invoke-Compose @("up", "-d") | Out-Null
  $steps.Add("隔离 Compose project 启动：$project")
  Wait-Healthy
  $steps.Add("健康检查通过：GET /api/healthz = HTTP 200")

  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $login = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/auth/login" -Method Post `
    -WebSession $session -UseBasicParsing -ContentType "application/json" -Body (@{ password = $smokePassword } | ConvertTo-Json)
  if ($login.StatusCode -ne 200) { throw "登录失败：HTTP $($login.StatusCode)" }
  $setCookie = @($login.Headers["Set-Cookie"])[0]
  $cookieMatch = [regex]::Match([string]$setCookie, "(?:^|,\s*)(kb_session=[^;]+)")
  if (-not $cookieMatch.Success) { throw "登录响应缺少 kb_session Cookie" }
  $cookieValue = $cookieMatch.Groups[1].Value.Substring("kb_session=".Length)
  $sessionCookie = New-Object System.Net.Cookie("kb_session", $cookieValue, "/", "127.0.0.1")
  $sessionCookie.Secure = $false
  $session.Cookies.Add($sessionCookie)
  $steps.Add("测试密码登录通过")

  $content = "Fresh install smoke $stamp"
  $uploadMarker = "smoke-$stamp.txt"
  $uploadContent = "upload persistence $stamp"
  $created = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/notes" -Method Post `
    -WebSession $session -UseBasicParsing -ContentType "application/json" -Body (@{ content = $content } | ConvertTo-Json)
  if ($created.StatusCode -ne 201) { throw "首条笔记创建失败：HTTP $($created.StatusCode)" }
  $createdJson = $created.Content | ConvertFrom-Json
  $noteId = [string]$createdJson.id
  if ([string]::IsNullOrWhiteSpace($noteId)) { throw "首条笔记响应缺少 id" }
  $steps.Add("首条普通文本笔记保存通过：noteId=$noteId")

  Test-ContainerPath "/data/db/app.db"
  Test-ContainerPath "/data/uploads"
  Invoke-Compose @("exec", "-T", "app", "node", "-e", "require('fs').writeFileSync('/data/uploads/$uploadMarker', '$uploadContent')") | Out-Null
  $exportDir = (Invoke-Compose @("exec", "-T", "app", "node", "-e", "process.stdout.write(process.env.NOTES_EXPORT_DIR || '')")) -join ""
  if ($exportDir.Trim() -ne "/data/notes") { throw "NOTES_EXPORT_DIR 异常：$exportDir" }
  $steps.Add("SQLite 与上传目录存在，NOTES_EXPORT_DIR=/data/notes")

  $export = $null
  foreach ($attempt in 1..30) {
    $export = Get-ChildItem -LiteralPath $notesDir -Filter "*.md" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($export) {
      $exportContent = [IO.File]::ReadAllText($export.FullName, [Text.UTF8Encoding]::new($false))
      if ($exportContent -match [regex]::Escape($content)) { break }
      $export = $null
    }
    Start-Sleep -Seconds 2
  }
  if (-not $export) { throw "Markdown 增量导出缺失或未包含首条笔记：$notesDir" }
  $steps.Add("Markdown 增量导出通过：$($export.FullName)")

  Invoke-Compose @("down", "--remove-orphans") | Out-Null
  Invoke-Compose @("up", "-d") | Out-Null
  Wait-Healthy
  $list = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/notes" -WebSession $session -UseBasicParsing
  if ($list.StatusCode -ne 200) { throw "重启后笔记列表失败：HTTP $($list.StatusCode)" }
  $listJson = $list.Content | ConvertFrom-Json
  $persisted = @($listJson.notes | Where-Object { [string]$_.id -eq $noteId })
  if ($persisted.Count -ne 1) { throw "重启后未找到首条笔记：$noteId" }
  if ([string]$persisted[0].content -ne $content) { throw "重启后笔记正文不一致：$noteId" }
  if ([string]$persisted[0].aiStatus -eq "done") { throw "未配置 AI 的笔记不应在冒烟期间完成整理：$noteId" }
  $search = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/search?q=Fresh%20install%20smoke" -WebSession $session -UseBasicParsing
  $searchJson = $search.Content | ConvertFrom-Json
  if (-not @($searchJson.results | Where-Object { [string]$_.id -eq $noteId })) { throw "重启后搜索未找到首条笔记：$noteId" }
  Test-ContainerPath "/data/uploads/$uploadMarker"
  $persistedUpload = (Invoke-Compose @("exec", "-T", "app", "node", "-e", "process.stdout.write(require('fs').readFileSync('/data/uploads/$uploadMarker', 'utf8'))")) -join ""
  if ($persistedUpload -ne $uploadContent) { throw "重启后上传文件内容不一致：$uploadMarker" }
  if (-not (Test-Path -LiteralPath $export.FullName)) { throw "重启后 Markdown 导出文件丢失：$($export.FullName)" }
  $persistedExportContent = [IO.File]::ReadAllText($export.FullName, [Text.UTF8Encoding]::new($false))
  if ($persistedExportContent -notmatch [regex]::Escape($content)) { throw "重启后 Markdown 导出正文不一致：$($export.FullName)" }
  $steps.Add("重启后健康检查、笔记读取、搜索、SQLite、上传文件与 Markdown 持久化通过")

  Write-Host "冒烟验收通过；证据：$evidence"
} catch {
  $exitCode = 1
  $failure = $_.Exception.Message
  try {
    $log = Invoke-Compose @("ps", "-a")
    $log += Invoke-Compose @("logs", "--no-color", "--tail", "200", "app")
    Write-Utf8NoBom $failureLog ([string[]]$log)
    Write-Host "容器诊断日志：$failureLog"
  } catch {
    Write-Host "无法获取容器诊断日志：$($_.Exception.Message)"
  }
  $steps.Add("失败：$failure")
  Write-Evidence "失败（未宣称通过）" $failure
  Write-Error $failure
} finally {
  if ($KeepResources) {
    Write-Host "已保留隔离资源：$work"
    Write-Host "清理命令：docker compose --project-name $project --project-directory $work --env-file $envFile -f $composeFile down -v --remove-orphans"
  } else {
    try { Invoke-Compose @("down", "-v", "--remove-orphans") | Out-Null }
    catch {
      $exitCode = 1
      $cleanupFailure = $_.Exception.Message
      $steps.Add("清理失败：$cleanupFailure")
      Write-Host "清理隔离资源失败：$cleanupFailure"
    }
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($exitCode -eq 0) { Write-Evidence "通过" }
  elseif ($cleanupFailure) { Write-Evidence "失败（清理失败）" $cleanupFailure }
}

exit $exitCode
