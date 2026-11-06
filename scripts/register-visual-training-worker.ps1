$ErrorActionPreference = 'Stop'
$clipWorkspace = Split-Path -Parent $PSScriptRoot
$clipScript = Join-Path $PSScriptRoot 'run-visual-training-worker.ps1'
$clipIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$clipAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $clipScript + '"') -WorkingDirectory $clipWorkspace
$clipTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$clipPrincipal = New-ScheduledTaskPrincipal -UserId $clipIdentity -LogonType Interactive -RunLevel Limited
$clipSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 4)
Register-ScheduledTask -TaskName 'SHOES CLIP Owner Review Training' -Description '관리자 검수 완료 후 요청된 CLIP 추가 학습 및 품질 기준 통과 범주의 자동 반영. 로그인한 PC에서만 실행.' -Action $clipAction -Trigger $clipTrigger -Principal $clipPrincipal -Settings $clipSettings -Force | Select-Object TaskName,State
