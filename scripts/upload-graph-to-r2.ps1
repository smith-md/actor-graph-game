# Upload graph data to Cloudflare R2 (PowerShell version for Windows)
#
# Prerequisites:
# 1. Install wrangler: npm install -g wrangler
# 2. Login to Cloudflare: wrangler login
# 3. Create R2 bucket: wrangler r2 bucket create movelinks-graph
#
# Usage: .\scripts\upload-graph-to-r2.ps1 [-GraphVersion "v20250205"]

param(
    [string]$GraphVersion = "v$(Get-Date -Format 'yyyyMMdd')"
)

$ErrorActionPreference = "Stop"

# Configuration
$BucketName = "movielinks-graph"
$ExportDir = "build\edge_export"

Write-Host "=== CineLinks Graph Upload to R2 ===" -ForegroundColor Cyan
Write-Host "Bucket: $BucketName"
Write-Host "Graph Version: $GraphVersion"
Write-Host "Source: $ExportDir"
Write-Host ""

# Check if export directory exists
if (-not (Test-Path $ExportDir)) {
    Write-Host "Error: Export directory not found at $ExportDir" -ForegroundColor Red
    Write-Host "Run 'python build/export_graph_for_edge.py' first to generate the edge data."
    exit 1
}

# Check if wrangler is installed
$wranglerPath = Get-Command wrangler -ErrorAction SilentlyContinue
if (-not $wranglerPath) {
    Write-Host "Error: wrangler CLI not found" -ForegroundColor Red
    Write-Host "Install with: npm install -g wrangler"
    exit 1
}

# Upload metadata files
Write-Host "Uploading metadata files..." -ForegroundColor Yellow
$metadataFiles = Get-ChildItem "$ExportDir\metadata\*.json"
foreach ($file in $metadataFiles) {
    $key = "graph/$GraphVersion/metadata/$($file.Name)"
    Write-Host "  $key"
    wrangler r2 object put "$BucketName/$key" --file $file.FullName --content-type "application/json" --remote
}

# Upload neighbor files
Write-Host ""
Write-Host "Uploading neighbor files..." -ForegroundColor Yellow
$neighborFiles = Get-ChildItem "$ExportDir\neighbors\*.json"
$total = $neighborFiles.Count
$current = 0

foreach ($file in $neighborFiles) {
    $key = "graph/$GraphVersion/neighbors/$($file.Name)"
    wrangler r2 object put "$BucketName/$key" --file $file.FullName --content-type "application/json" --remote

    $current++
    if ($current % 100 -eq 0) {
        Write-Host "  Progress: $current / $total files uploaded"
    }
}

Write-Host ""
Write-Host "=== Upload Complete ===" -ForegroundColor Green
Write-Host "Total files uploaded: $current neighbor files + metadata"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Update workers/wrangler.toml to set GRAPH_VERSION = `"$GraphVersion`""
Write-Host "2. Deploy workers: cd workers && npm run deploy"
Write-Host "3. Update frontend VITE_API_URL to point to the Workers URL"
