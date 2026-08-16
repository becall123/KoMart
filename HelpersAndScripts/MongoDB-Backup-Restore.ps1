# ============================================================
# MongoDB Atlas Backup -> Local MongoDB Restore
# ============================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " MongoDB Atlas Backup & Local Restore Tool" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# 1. CHECK REQUIRED MONGODB TOOLS
# ============================================================

Write-Host "Checking MongoDB tools..." -ForegroundColor Yellow
Write-Host ""

if (-not (Get-Command mongodump -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: mongodump was not found." -ForegroundColor Red
    Write-Host "Please install MongoDB Database Tools." -ForegroundColor Yellow
    exit 1
}

Write-Host "OK - mongodump found" -ForegroundColor Green

if (-not (Get-Command mongorestore -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: mongorestore was not found." -ForegroundColor Red
    Write-Host "Please install MongoDB Database Tools." -ForegroundColor Yellow
    exit 1
}

Write-Host "OK - mongorestore found" -ForegroundColor Green

# ============================================================
# 2. GET ATLAS INFORMATION
# ============================================================

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " MongoDB Atlas Details"
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$AtlasUri = Read-Host "Atlas Connection String"

if ([string]::IsNullOrWhiteSpace($AtlasUri)) {
    Write-Host "ERROR: Atlas connection string is required." -ForegroundColor Red
    exit 1
}

$SourceDatabase = Read-Host "Source database name"

if ([string]::IsNullOrWhiteSpace($SourceDatabase)) {
    Write-Host "ERROR: Source database name is required." -ForegroundColor Red
    exit 1
}

# ============================================================
# 3. GET LOCAL MONGODB INFORMATION
# ============================================================

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " Local MongoDB Details"
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$LocalUri = Read-Host "Local MongoDB URI [mongodb://localhost:27017]"

if ([string]::IsNullOrWhiteSpace($LocalUri)) {
    $LocalUri = "mongodb://localhost:27017"
}

$DestinationDatabase = Read-Host "Destination database name"

if ([string]::IsNullOrWhiteSpace($DestinationDatabase)) {
    Write-Host "ERROR: Destination database name is required." -ForegroundColor Red
    exit 1
}

# ============================================================
# 4. BACKUP LOCATION
# ============================================================

Write-Host ""

$BackupRoot = Read-Host "Backup folder [C:\MongoBackups]"

if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
    $BackupRoot = "C:\MongoBackups"
}

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

# Example:
# C:\MongoBackups\komart_20260815_081500

$BackupFolder = Join-Path `
    $BackupRoot `
    ($SourceDatabase + "_" + $Timestamp)

# Example:
# C:\MongoBackups\komart_20260815_081500\komart

$DatabaseBackupFolder = Join-Path `
    $BackupFolder `
    $SourceDatabase

# Create backup directory

New-Item `
    -ItemType Directory `
    -Path $BackupFolder `
    -Force | Out-Null

# ============================================================
# 5. SHOW CONFIGURATION
# ============================================================

Write-Host ""
Write-Host "================================================" -ForegroundColor Yellow
Write-Host " Configuration"
Write-Host "================================================" -ForegroundColor Yellow
Write-Host ""

Write-Host ("Source database      : " + $SourceDatabase)
Write-Host ("Destination database : " + $DestinationDatabase)
Write-Host ("Local MongoDB        : " + $LocalUri)
Write-Host ("Backup location      : " + $BackupFolder)

Write-Host ""

$Confirm = Read-Host "Continue? (Y/N)"

if ($Confirm -notmatch "^[Yy]$") {
    Write-Host ""
    Write-Host "Operation cancelled." -ForegroundColor Yellow
    exit
}

# ============================================================
# 6. CREATE ATLAS BACKUP
# ============================================================

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " STEP 1 - Atlas Backup"
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Creating Atlas backup..." -ForegroundColor Yellow
Write-Host ""

mongodump `
    --uri $AtlasUri `
    --db $SourceDatabase `
    --out $BackupFolder

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Atlas backup failed." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "OK - Atlas backup completed successfully." -ForegroundColor Green

# ============================================================
# 7. VERIFY BACKUP
# ============================================================

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " STEP 2 - Verify Backup"
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $DatabaseBackupFolder)) {

    Write-Host "ERROR: Database backup folder was not created." -ForegroundColor Red
    Write-Host ""
    Write-Host "Expected:"
    Write-Host $DatabaseBackupFolder
    exit 1
}

$BsonFiles = Get-ChildItem `
    -Path $DatabaseBackupFolder `
    -Filter "*.bson" `
    -File

Write-Host ("BSON collections found: " + $BsonFiles.Count) -ForegroundColor Green
Write-Host ""

if ($BsonFiles.Count -eq 0) {

    Write-Host "ERROR: No BSON files were found." -ForegroundColor Red
    exit 1
}

foreach ($File in $BsonFiles) {
    Write-Host ("  OK - " + $File.BaseName)
}

# ============================================================
# 8. PREPARE RESTORE
# ============================================================

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " STEP 3 - Prepare Restore"
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Source database:"
Write-Host ("  " + $SourceDatabase)

Write-Host ""
Write-Host "Destination database:"
Write-Host ("  " + $DestinationDatabase)

# Namespace mapping

$NsFrom = $SourceDatabase + ".*"
$NsTo = $DestinationDatabase + ".*"

Write-Host ""
Write-Host "Namespace mapping:"
Write-Host ("  " + $NsFrom)
Write-Host "       |"
Write-Host "       V"
Write-Host ("  " + $NsTo)

Write-Host ""
Write-Host "Restore source folder:"
Write-Host ("  " + $BackupFolder)

Write-Host ""

$RestoreConfirm = Read-Host "Restore database now? (Y/N)"

if ($RestoreConfirm -notmatch "^[Yy]$") {

    Write-Host ""
    Write-Host "Restore cancelled." -ForegroundColor Yellow
    exit
}

# ============================================================
# 9. RESTORE TO LOCAL MONGODB
# ============================================================

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " STEP 4 - Restore Database"
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Restoring database..." -ForegroundColor Yellow
Write-Host ""

Write-Host ("Local URI        : " + $LocalUri)
Write-Host ("Source namespace : " + $NsFrom)
Write-Host ("Target namespace : " + $NsTo)
Write-Host ("Restore folder   : " + $BackupFolder)

Write-Host ""

# IMPORTANT:
# mongorestore receives $BackupFolder
# NOT $DatabaseBackupFolder.
#
# Backup structure:
#
# C:\MongoBackups\
#     komart_20260815_081500\
#         komart\
#             products.bson
#             customers.bson
#             ...
#
# Therefore mongorestore must receive:
#
# C:\MongoBackups\komart_20260815_081500
#
# and use --nsFrom / --nsTo for database mapping.

mongorestore `
    --uri $LocalUri `
    --nsFrom $NsFrom `
    --nsTo $NsTo `
    $BackupFolder

if ($LASTEXITCODE -ne 0) {

    Write-Host ""
    Write-Host "ERROR: Database restore failed." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "OK - Database restore command completed." -ForegroundColor Green

# ============================================================
# 10. FINAL SUMMARY
# ============================================================

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host " COMPLETED"
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

Write-Host "Source database:"
Write-Host ("  " + $SourceDatabase)

Write-Host ""
Write-Host "Destination database:"
Write-Host ("  " + $DestinationDatabase)

Write-Host ""
Write-Host "Local MongoDB:"
Write-Host ("  " + $LocalUri)

Write-Host ""
Write-Host "Backup location:"
Write-Host ("  " + $BackupFolder)

Write-Host ""
Write-Host "Collections backed up:"

foreach ($File in $BsonFiles) {
    Write-Host ("  OK - " + $File.BaseName)
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host " MongoDB operation completed successfully!"
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

Write-Host "Open MongoDB Compass and connect to:" -ForegroundColor Cyan
Write-Host $LocalUri

Write-Host ""
Write-Host ("Restored database: " + $DestinationDatabase) -ForegroundColor Cyan
Write-Host ""