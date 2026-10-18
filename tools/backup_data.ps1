# Pulls the private data repo into its OneDrive clone and keeps weekly ZIP snapshots.
# Run by the scheduled task from register_backup_task.ps1; safe to run by hand any time.

param(
    [string]$DataDir = "C:\Users\Nico\OneDrive\Desktop\nihongo-tracker-data",
    [string]$BackupDir = "C:\Users\Nico\OneDrive\Desktop\nihongo-tracker\backup",
    [int]$Keep = 12
)

$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force $BackupDir | Out-Null
$log = Join-Path $BackupDir "backup.log"
function Log($msg) { "$(Get-Date -Format s)  $msg" | Add-Content -Path $log -Encoding UTF8 }

$out = & git -C $DataDir pull --ff-only 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
    Log "FEHLER git pull ($LASTEXITCODE): $($out.Trim())"
    exit 1
}

# One snapshot per week, named after that week's Monday.
$today = Get-Date
$monday = $today.AddDays(-(([int]$today.DayOfWeek + 6) % 7)).ToString("yyyy-MM-dd")
$zip = Join-Path $BackupDir "nihongo-data-$monday.zip"
if (-not (Test-Path $zip)) {
    Compress-Archive -Path (Join-Path $DataDir "meta.json"), (Join-Path $DataDir "logs") -DestinationPath $zip
    Log "Snapshot $zip"
}

Get-ChildItem $BackupDir -Filter "nihongo-data-*.zip" | Sort-Object Name -Descending |
    Select-Object -Skip $Keep | Remove-Item -Confirm:$false

Log "OK $($out.Trim() -replace '\s+', ' ')"
