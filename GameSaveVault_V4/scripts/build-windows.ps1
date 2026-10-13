$ErrorActionPreference = 'Stop'
Write-Host 'GameSave Vault V4 - local Windows build (no obfuscation or packer)' -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 LTS first.' }
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw 'Install Rust stable via rustup first.' }
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
cargo test --manifest-path src-tauri/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed' }
npm run desktop:build
if ($LASTEXITCODE -ne 0) { throw 'Tauri build failed' }
Get-ChildItem 'src-tauri/target/release/bundle/nsis/*.exe' | ForEach-Object {
    Write-Host "Installer: $($_.FullName)"
    Get-FileHash -Algorithm SHA256 -Path $_.FullName
}
Write-Host 'Unsigned build: Scan the installer, inspect source, and consider code signing before distribution.' -ForegroundColor Yellow
