# GameSave Vault V4 — Security notes

## Status

- V3.1 was reported to trigger 4/71 VirusTotal detections. Those detections cannot be dismissed as false positives without additional analysis. **Do not run the previously flagged V3.1 executable.**
- V4 is a new Tauri/Rust source implementation. It does not reuse V3's Go listener/Edge app-mode launcher.
- **This V4 source was NOT compiled or tested on Windows in the current environment.** A clean VirusTotal score is not promised.

## Threat model and mitigations

| Threat | Mitigation |
| --- | --- |
| Browser content driving local API | No HTTP server; only Tauri IPC for bundled webview |
| Untrusted executable downloaded/executed | V4 requires an explicit user-selected `ludusavi.exe`; no downloads of executables |
| Shell injection via game names | Rust passes an argument vector to `std::process::Command`, never to a shell; `--` separates options from game names |
| Restore overwrites current save | Preview, exact-name confirmation, safety snapshot by default; stops on snapshot failure |
| Online game art network access | Only Steam CDN allowed for images in CSP; controlled by a Settings toggle |
| Accidental backup deletion | No custom pruning or deletion commands |
| Concurrent backup/restore | Backend operations serialized with a mutex |
| Antivirus detections | Review sources, unsigned installer provenance, SHA-256 output, external scanning and code-signing; no AV bypass |

## Known limitations / things to audit

1. V4 validates the **filename** and existence of Ludusavi, not the digital signature or publisher. Get it from the official release source. A malicious executable *named* `ludusavi.exe` is still dangerous.
2. V4 trusts the explicitly chosen Ludusavi CLI to enumerate/read/write files. Ludusavi is a separate program with its own security/bug surface.
3. Safety snapshots can consume additional disk space and are NOT automatically deleted. Periodically check storage.
4. A restore can still fail mid-write (disk failure, corrupted backups, locked files). Keep external backup copies.
5. The Rust CLI child process currently has no hard timeout. Large scans or blocked cloud sync can take a long time; use Task Manager to terminate if needed.
6. Tauri/React/Rust dependency audit and Windows integration/security testing have NOT been performed here.
7. V4 does not verify downloaded cover image content, but the images are rendered as remote pixels in a restricted WebView; you can disable cover requests.
8. npm dependency versions are listed in package.json but this archive does not contain a package-lock.json because package retrieval is unavailable here. Generate/commit your lock file before releasing.
9. The included CI uses version tags for trusted GitHub Actions; production CI should review/pin those actions to immutable commits and produce a signed release if possible.

## Checks before executing a build

1. Run `npm install` from the source folder, inspect dependency alerts, and save the generated lock file.
2. Run `npm run build` and `cargo test --manifest-path src-tauri/Cargo.toml`.
3. Run `npm run desktop:build` on a clean Windows VM; inspect execution using Process Monitor or Windows Security.
4. Verify SHA-256 of the final installer. Upload only **your own built installer** to VirusTotal and consider behavior + signature + independent reviews, not only the detection count.
5. Test backup and restore using disposable save files before trusting the tool with real saves.
6. Do **not** disable Microsoft Defender, whitelist the installer, or turn off SmartScreen to force installation.

## Security disclosure

If you discover a security flaw, do not share personal save files, Windows account information or private paths publicly. Reproduce it with dummy data and report via the project's own private repository/security issue mechanism.
