# Registers the daily Nihongo Hunter data backup in Windows Task Scheduler.
# Runs daily at 21:00 (and catches up if the PC was off). Requires no admin rights.
# Re-run this script to update the task.

$ErrorActionPreference = "Stop"

$script = "C:\Users\Nico\OneDrive\Desktop\nihongo-tracker\tools\backup_data.ps1"
$taskName = "NihongoHunterBackup"

if (-not (Test-Path $script)) { throw "Script not found at $script" }

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""

$trigger = New-ScheduledTaskTrigger -Daily -At 9:00PM

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null

Write-Output "Registered scheduled task '$taskName' (daily 21:00)."
Write-Output "Test it now with:  Start-ScheduledTask -TaskName $taskName"
Write-Output "Remove it with:    Unregister-ScheduledTask -TaskName $taskName -Confirm:`$false"
