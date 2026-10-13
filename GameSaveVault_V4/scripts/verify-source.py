"""Dependency-free, source-only sanity checks. NOT a security audit or a build test."""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
app = (root / 'src' / 'App.tsx').read_text(encoding='utf-8')
backend = (root / 'src-tauri' / 'src' / 'lib.rs').read_text(encoding='utf-8')
for relative in ['package.json', 'tsconfig.json', 'src-tauri/tauri.conf.json', 'src-tauri/capabilities/default.json']:
    json.loads((root / relative).read_text(encoding='utf-8'))
    print('PASS JSON:', relative)

front_commands = set(re.findall(r"invoke(?:<[^>]*>)?\('([a-z_]+)'", app))
registered = re.search(r'tauri::generate_handler!\[(.*?)\]', backend, re.S)
assert registered, 'Tauri command registry missing'
back_commands = set(re.findall(r'\b[a-z_]+\b', registered.group(1)))
assert front_commands <= back_commands, f'Missing Rust commands: {front_commands - back_commands}'
print('PASS IPC command coverage:', ', '.join(sorted(front_commands)))
assert 'GameSaveVault_V3' not in backend
assert 'TcpListener' not in backend and 'HttpServer' not in backend
assert 'Command::new(path)' in backend
assert 'safety-snapshots' in backend
assert 'confirmedName' in app
assert 'Scan Games' in app and 'Restore Save' in app
assert 'ensureArray' in app
assert 'https://shared.fastly.steamstatic.com' in (root / 'src-tauri' / 'tauri.conf.json').read_text()
assert (root / 'src-tauri/icons/icon.png').is_file()
print('PASS source contract checks (not runtime testing)')
