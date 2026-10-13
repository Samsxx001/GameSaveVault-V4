# V4 testing checklist

## Verified during source creation

- [x] Tauri 2 desktop project structure generated
- [x] React source parsed/transpiled with TypeScript API (syntax-level check)
- [x] JSON configuration files parsed successfully
- [x] All Rust IPC command names compared with React invocations
- [x] No HTTP listener or `cmd.exe` / PowerShell code in Rust backend
- [x] UI uses an empty-state rather than assuming `games.length` is non-null

## Not verified yet (must run on Windows)

- [ ] `npm install`, `npm run build`, `npm run desktop:build`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] Native window launch with WebView2
- [ ] Ludusavi `--api` JSON output from your installed version
- [ ] Game detection from Steam / Epic / GOG / Game Pass where supported by Ludusavi
- [ ] Steam cover mapping with local manifest and Windows CSP
- [ ] Full backup of disposable Save Game and verify files
- [ ] Restore latest and selected historical version; compare resulting files
- [ ] Restore failure path if safety snapshot cannot be created
- [ ] Empty history, no manifest, offline cover fallback, nonexistent engine path
- [ ] VirusTotal and Windows Defender/SmartScreen behavior of resulting installer

## Suggested real Windows test (disposable game save only)

1. In official Ludusavi, configure a custom test game path (e.g. `%USERPROFILE%\Documents\GVTestGame\save.dat`). Create its dummy save.
2. Launch V4, select Ludusavi exe, update database, scan; confirm the game appears.
3. Click Backup. Modify the dummy save. Click Backup again. History should show versions.
4. Choose a previous version and open Restore. Verify that UI prompts exact game title and previews the action.
5. Confirm Restore. Check the recovered file, and the `safety-snapshots` location.
6. Test with network disabled and no save games to ensure UI remains responsive.

The absence of Windows testing is not evidence of safety or successful operation. Version 4.0.0 here is **developer source / test build**, not a certified production release.
