# 🎮 GameSave Vault V4 — Desktop Edition

A Windows 10/11 **Tauri 2 + React 18 + TypeScript + Rust** application providing a Steam-inspired interface for detecting, backing up, and restoring PC game saves.

**ภาษาไทย:** โค้ดต้นฉบับนี้เป็น V4 ที่เขียนใหม่ ไม่ใช่ไฟล์ EXE ตัวเดิมที่ VirusTotal แจ้งเตือนใน V3.1 โปรแกรมต้องใช้ `ludusavi.exe` ของโครงการ Ludusavi ที่ผู้ใช้เลือกด้วยตนเองเพื่อ Scan / Backup / Restore

## Highlights

- ✅ Native desktop window via Tauri 2 / WebView2 (not a browser tab or localhost HTTP server in production)
- ✅ Dark Steam-like dashboard, visible **Scan Games** and **Restore Save** buttons
- ✅ Game search, cover-art tiles with gradients as an offline fallback
- ✅ True game-save discovery powered by **official Ludusavi CLI** and its manifest database
- ✅ Local backup, backup-all, game-specific backup, restore history and version selection
- ✅ Restore preview + exact-title confirmation + automatic *safety snapshot* by default
- ✅ Handles `null` / missing data without crashing the UI
- ✅ No PowerShell, cmd.exe, obfuscation, network EXE download, or self-updater
- ✅ Manual manifest update, manual choice of backup folder and Ludusavi executable

## Important: this download is source code, not a verified Windows binary

This archive was authored in a Linux environment that **does not have Rust or access to the npm registry**. Therefore the actual **Tauri executable was NOT compiled or run on Windows here**. A GitHub Actions Windows build and local build script are provided. Build success, VirusTotal score, and safe operation on real saves are NOT guaranteed; test with nonessential save games first.

### Windows requirements

1. Windows 10 or 11 (64-bit) with Microsoft **Edge WebView2 Runtime**.
2. **Node.js 22 LTS** and npm.
3. **Rust stable** via https://rustup.rs/ (MSVC toolchain for Windows).
4. **Visual Studio Build Tools** with Desktop development with C++ / MSVC and Windows SDK for Tauri.
5. **Ludusavi CLI** from its official project: https://github.com/mtkennerly/ludusavi/releases . Verify where the download comes from before running. V4 does not bundle or automatically download it.

### Build locally on Windows

Open PowerShell **in the extracted `GameSaveVault_V4` folder**:

```powershell
npm install --no-audit --no-fund
npm run desktop:dev
```

For an installer:

```powershell
npm run desktop:build
```

Installer appears under `src-tauri/target/release/bundle/nsis/` (the exact filename depends on the build). Standalone binary typically appears at `src-tauri/target/release/gamesave-vault.exe`.

Or run `powershell -ExecutionPolicy RemoteSigned -File .\scripts\build-windows.ps1` if your execution policy allows it. The script runs frontend compilation, Rust tests, Tauri build, and displays the installer SHA-256.

### GitHub Actions Windows build (no local compiler)

Create a **private or public GitHub repository**, upload the contents of this source directory, and run **Actions → Windows Tauri Build (unsigned) → Run workflow**. Download the build artifact named `GameSaveVault-V4-Windows-unsigned`. You control the repository and build; this conversation does not have access to run the workflow for you.

> **Warning:** The workflow creates an **unsigned installer**. Microsoft SmartScreen or some antivirus engines may warn about new unsigned software. This is NOT proof the file is safe or malicious. Review the source, verify the build pipeline, scan the resulting EXE, and consider code-signing before publishing it.

## First launch and usage

1. Start V4, open **Settings → Ludusavi Integration**.
2. Click **Browse** and choose the official `ludusavi.exe` downloaded/installed by you.
3. Choose a **Backup Storage** folder on a drive with sufficient free space.
4. Click **Update** under Game Database (requires network for Ludusavi's own manifest download, user-triggered only).
5. In the top bar, click **Scan Games**. Detected saves appear on Dashboard / My Game Library.
6. Click **Backup** for a game, or **Backup All** in Library.
7. Go to **Backup & Restore**, expand a game to select a version, click **Restore**.
8. The app runs Ludusavi `restore --preview`, asks you to type the game's exact title, saves your current data into a separate *safety snapshot*, then performs Restore.

### Safe restore details

By default, a **pre-restore backup** is written to the app data directory under `safety-snapshots/`. If this fails, V4 stops instead of overwriting the original saves. If you are restoring on a new machine with no live save files, you may explicitly check **Skip Safety Snapshot (not recommended)** and still type the exact title. Do not skip safety backup casually. Keep external copies of important saves. A snapshot does not guarantee successful recovery from all possible issues.

**Note:** Ludusavi can also back up selected Windows registry keys for supported titles. Configure Steam install roots and custom games **in Ludusavi's own configuration**. GameSave Vault only displays games that the Ludusavi CLI detects in its preview. Games without detectable saves will not appear.

### Steam cover art and privacy

If enabled, V4 matches Steam IDs using Ludusavi's local `manifest.yaml` under `%APPDATA%\ludusavi\manifest.yaml` or in Ludusavi's portable directory. It loads cover images from Steam's CDN; these requests may reveal IP and requested Steam app IDs to Steam/CDN. Turn **Steam Cover Art** off in Settings to prevent this. Games without IDs show a locally generated gradient tile. Cover availability depends on Steam.

### Compatibility with V1–V3

**V4 uses Ludusavi's backup format**, not V3's ZIP backup format. Existing V3 backups **are not automatically migrated** and should not be deleted. Keep your original V3 backups safely; do not overwrite them with the V4 backup directory. A legacy ZIP importer is not implemented in V4.

### Security and operating boundaries

- Uses `std::process::Command` **with argument arrays**, not shell execution.
- Explicit selection of a correctly named Ludusavi executable; no automatic execution of unknown binaries discovered on the PATH. (A filename check is NOT a signature verification.)
- Most commands are serialized using a mutex and run in a background blocking task; no parallel writes.
- Does not host an HTTP listener in production. Tauri's IPC bridge is used.
- No automatic update checks from this app. Database update is via user-confirmed `ludusavi manifest update`.
- Strict Tauri Content Security Policy, minimal dialog capability. Cover art is the only routine optional external HTTP(S) resource.
- Maintains separate per-operation safety backups; does not prune/delete your Ludusavi backups itself.
- Build scripts have no custom binary packer or obfuscator; an unsigned build can still trigger heuristics.

Read `SECURITY.md` and `TESTING.md` for more details.

## Technology

- UI: React 18, TypeScript, Vite, Lucide icons, CSS
- Shell: Tauri 2 / Microsoft Edge WebView2
- Backend: Rust, serde JSON, serde YAML, chrono
- Actual save detection/backup engine: external **Ludusavi CLI**, with native `--api` JSON outputs
- Packaging: Tauri NSIS Windows installer

## License and attribution

GameSave Vault V4 starter source: MIT license (see `LICENSE`). Ludusavi is a **separate** open-source project by its maintainers: https://github.com/mtkennerly/ludusavi . Ludusavi's manifest database is a separate project: https://github.com/mtkennerly/ludusavi-manifest (MIT license). This project does not contain Ludusavi's binary or its manifest. It is not affiliated with Ludusavi or Valve/Steam.
