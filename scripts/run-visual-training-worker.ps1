$ErrorActionPreference = 'Stop'
$clipWorkspace = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $clipWorkspace
$clipLog = Join-Path $clipWorkspace 'logs/visual-training-worker.log'
New-Item -ItemType Directory -Path (Split-Path -Parent $clipLog) -Force | Out-Null
$env:PYTHONUTF8 = '1'
$env:OMP_NUM_THREADS = '2'
$env:MKL_NUM_THREADS = '2'
$env:OPENBLAS_NUM_THREADS = '2'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch { }
& node (Join-Path $PSScriptRoot 'visual-training-worker.mjs') 2>&1 | Out-File -FilePath $clipLog -Append -Encoding utf8
exit $LASTEXITCODE
