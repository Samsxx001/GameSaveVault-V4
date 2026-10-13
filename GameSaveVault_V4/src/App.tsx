import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Activity, AlertCircle, ArrowDownToLine, ArrowLeft, ArrowRight, BarChart3,
  CalendarClock, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp,
  Clock3, CloudOff, Database, Download, ExternalLink, FileArchive, FileClock,
  Folder, FolderOpen, Gamepad2, HardDrive, History, Home, Info, Library,
  LoaderCircle, LockKeyhole, Monitor, MoreHorizontal, RefreshCw, RotateCcw,
  Search, Settings2, Shield, ShieldAlert, ShieldCheck, Sparkles, X,
} from 'lucide-react';

type Page = 'overview' | 'library' | 'history' | 'settings';
type Settings = { enginePath: string; backupDir: string; showCovers: boolean };
type Status = { connected: boolean; enginePath: string; version: string; backupDir: string; manifestAvailable: boolean; message: string };
type Game = { name: string; fileCount: number; registryCount: number; bytes: number; paths: string[]; steamId: number | null; decision: string };
type BackupVersion = { name: string; when: string; comment: string };
type HistoryGame = { name: string; backups: BackupVersion[] };
type OperationResult = { processedGames: number; totalGames: number; processedBytes: number; message: string; safetyPath: string | null; problems: string[] };
type RestoreChoice = { game: string; backupId: string };
type Notice = { kind: 'success' | 'error' | 'info'; message: string };

const nav: { page: Page; label: string; icon: typeof Home }[] = [
  { page: 'overview', label: 'ภาพรวม', icon: Home },
  { page: 'library', label: 'เกมของฉัน', icon: Library },
  { page: 'history', label: 'Backup & Restore', icon: History },
  { page: 'settings', label: 'ตั้งค่า', icon: Settings2 },
];
const headings: Record<Page, { title: string; caption: string }> = {
  overview: { title: 'ภาพรวม', caption: 'จัดการ Save Game ทั้งหมดในที่เดียว' },
  library: { title: 'My Game Library', caption: 'เกมที่ตรวจพบจาก Save Game จริงในเครื่องของคุณ' },
  history: { title: 'Backup & Restore', caption: 'ดูเวอร์ชันย้อนหลังและกู้คืนอย่างปลอดภัย' },
  settings: { title: 'Settings', caption: 'จัดการพื้นที่สำรองข้อมูลและระบบตรวจหาเกม' },
};
const ensureArray = <T,>(v: T[] | null | undefined): T[] => Array.isArray(v) ? v : [];
const bytes = (b = 0) => b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`;
const whenText = (raw: string) => { if (!raw) return 'ไม่ระบุวันเวลา'; const d = new Date(raw); return Number.isNaN(d.valueOf()) ? raw : d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }); };
const safeError = (e: unknown) => typeof e === 'string' ? e : e instanceof Error ? e.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
const gradientFor = (name: string) => {
  const palettes = [
    'linear-gradient(155deg,#143f65 4%,#1a6283 47%,#0a162a 100%)',
    'linear-gradient(155deg,#4c2653 4%,#9d4f68 48%,#20152a 100%)',
    'linear-gradient(155deg,#40335e 4%,#576f9a 52%,#14243b 100%)',
    'linear-gradient(155deg,#395140 4%,#79965e 46%,#192d33 100%)',
    'linear-gradient(155deg,#6f3b27 4%,#bd7548 48%,#271c27 100%)',
  ];
  const n = Array.from(name).reduce((a, c) => a + c.charCodeAt(0), 0);
  return palettes[n % palettes.length];
};

function GameCover({ name, steamId, coverEnabled, className = '' }: { name: string; steamId?: number | null; coverEnabled: boolean; className?: string }) {
  const [missingImage, setMissingImage] = useState(false);
  const canLoad = coverEnabled && !!steamId && !missingImage;
  return <div className={`game-cover ${className}`} style={{ background: gradientFor(name) }}>
    {canLoad ? <img src={`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${steamId}/library_600x900.jpg`} alt={`ภาพปก ${name}`} onError={() => setMissingImage(true)} loading="lazy" referrerPolicy="no-referrer" /> : <>
      <span className="cover-glow" /><Gamepad2 size={40} strokeWidth={1.35} className="fallback-gamepad" />
      <span className="cover-name">{name}</span>
    </>}
  </div>;
}
function SmallSpinner() { return <LoaderCircle size={17} className="spin" />; }
function SectionTitle({ eyebrow, children, right }: { eyebrow?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return <div className="section-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{children}</h2></div>{right}</div>;
}
function EmptyState({ icon: Icon, title, detail, action }: { icon: typeof Home; title: string; detail: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={27} /></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}
function StatCard({ icon: Icon, value, label, sub, variant = 'blue' }: { icon: typeof Home; value: string; label: string; sub: string; variant?: string }) {
  return <div className="stat-card"><div className={`stat-icon ${variant}`}><Icon size={19} /></div><div className="stat-value">{value}</div><div className="stat-label">{label}</div><div className="stat-sub">{sub}</div></div>;
}

export default function App() {
  const [page, setPage] = useState<Page>('overview');
  const [search, setSearch] = useState('');
  const [games, setGames] = useState<Game[]>([]);
  const [history, setHistory] = useState<HistoryGame[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [restore, setRestore] = useState<RestoreChoice | null>(null);
  const [preview, setPreview] = useState<OperationResult | null>(null);
  const [confirmedName, setConfirmedName] = useState('');
  const [skipSafety, setSkipSafety] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const notify = (kind: Notice['kind'], message: string) => setNotice({ kind, message });
  const refreshStatus = async () => setStatus(await invoke<Status>('get_status'));
  const refreshHistory = async () => setHistory(ensureArray(await invoke<HistoryGame[]>('list_history')));
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, info] = await Promise.all([invoke<Settings>('get_settings'), invoke<Status>('get_status')]);
        if (!alive) return;
        setSettings(s); setStatus(info);
        if (info.connected) {
          try { const versions = await invoke<HistoryGame[]>('list_history'); if (alive) setHistory(ensureArray(versions)); }
          catch (e) { if (alive) notify('error', `อ่านประวัติไม่สำเร็จ: ${safeError(e)}`); }
        }
      } catch (e) { if (alive) notify('error', safeError(e)); }
      finally { if (alive) setBooting(false); }
    })();
    return () => { alive = false; };
  }, []);

  const run = async (key: string, callback: () => Promise<void>) => {
    if (busy) return;
    setBusy(key); setNotice(null);
    try { await callback(); }
    catch (e) { notify('error', safeError(e)); }
    finally { setBusy(''); }
  };
  const scan = () => run('scan', async () => {
    const found = ensureArray(await invoke<Game[]>('scan_games'));
    setGames(found); setLastScan(new Date().toISOString());
    notify('success', `สแกนเสร็จแล้ว พบ Save Game ${found.length} เกม`);
  });
  const doBackup = (game?: string) => run('backup', async () => {
    const data = await invoke<OperationResult>('backup_games', { game: game ?? null });
    await refreshHistory();
    notify('success', `Backup เสร็จแล้ว • ประมวลผล ${data.processedGames} เกม (${bytes(data.processedBytes)})`);
  });
  const openRestore = (game: string, backupId = '') => {
    setConfirmedName(''); setSkipSafety(false); setPreview(null);
    setRestore({ game, backupId });
    void run('preview', async () => {
      const data = await invoke<OperationResult>('preview_restore', { game, backupId });
      setPreview(data);
    });
  };
  const doRestore = () => {
    if (!restore || !preview || confirmedName !== restore.game) return;
    const selected = restore;
    void run('restore', async () => {
      const result = await invoke<OperationResult>('restore_game', {
        game: selected.game, backupId: selected.backupId,
        confirmation: confirmedName, skipSafety,
      });
      setRestore(null); setPreview(null); setConfirmedName('');
      notify('success', `Restore สำเร็จ: ${selected.game}${result.safetyPath ? ` • มี Safety Snapshot ที่ ${result.safetyPath}` : ''}`);
      await refreshHistory();
    });
  };
  const save = (newSettings: Settings) => run('save', async () => {
    await invoke('save_settings', { settings: newSettings });
    const locationChanged = settings?.enginePath !== newSettings.enginePath || settings?.backupDir !== newSettings.backupDir;
    setSettings(newSettings);
    await refreshStatus();
    if (locationChanged) { setGames([]); setHistory([]); setLastScan(null); }
    const updated = await invoke<Status>('get_status');
    if (updated.connected && locationChanged) await refreshHistory();
    notify('success', 'บันทึกการตั้งค่าแล้ว');
  });
  const chooseEngine = async () => {
    if (!settings || busy) return;
    try {
      const selected = await open({ title: 'เลือก Ludusavi executable', multiple: false, filters: [{ name: 'Ludusavi', extensions: ['exe'] }] });
      if (typeof selected === 'string') void save({ ...settings, enginePath: selected });
    } catch (e) { notify('error', safeError(e)); }
  };
  const chooseBackupDir = async () => {
    if (!settings || busy) return;
    try {
      const selected = await open({ title: 'เลือกโฟลเดอร์เก็บ Backup', multiple: false, directory: true });
      if (typeof selected === 'string') void save({ ...settings, backupDir: selected });
    } catch (e) { notify('error', safeError(e)); }
  };
  const databaseUpdate = () => run('update', async () => {
    const message = await invoke<string>('update_manifest');
    await refreshStatus(); notify('success', message || 'ฐานข้อมูล Ludusavi อัปเดตแล้ว');
  });

  const connected = status?.connected === true;
  const countVersions = history.reduce((n, entry) => n + ensureArray(entry.backups).length, 0);
  const totalSize = games.reduce((n, game) => n + (game.bytes || 0), 0);
  const visibleGames = useMemo(() => games.filter(g => g.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [games, search]);
  const visibleHistory = useMemo(() => history.filter(g => g.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [history, search]);
  const latestHistory = history.filter(g => g.backups?.length).slice(0, 4);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Gamepad2 size={25} strokeWidth={2.25}/></div><div><strong>GAMESAVE</strong><span>VAULT <i>V4</i></span></div></div>
      <div className="side-section-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="เมนูนำทาง">
        {nav.map(({ page: id, label, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => { setPage(id); setSearch(''); }}><Icon size={19}/><span>{label}</span>{page === id && <div className="nav-dot"/>}</button>)}
      </nav>
      <div className="side-divider" />
      <div className="side-section-label">QUICK ACTIONS</div>
      <button className="side-quick" onClick={scan} disabled={!connected || !!busy}><RefreshCw size={17} className={busy === 'scan' ? 'spin' : ''}/> Scan Games</button>
      <button className="side-quick" onClick={() => { setPage('history'); setSearch(''); }}><RotateCcw size={17}/> Restore Save</button>
      <div className="sidebar-bottom"><div className="mini-info"><ShieldCheck size={17}/><span>Native Desktop App</span></div><div className="connection-mini"><span className={`status-light ${connected ? 'on' : ''}`}/><div><strong>{connected ? 'Engine connected' : 'Engine not connected'}</strong><small>{connected ? 'Ludusavi CLI ready' : 'ตั้งค่าก่อนเริ่มใช้งาน'}</small></div></div><div className="sidebar-version">GAME SAVE VAULT • VERSION 4.0.0</div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb"><span>GameSave Vault</span><ChevronRight size={14}/><strong>{headings[page].title}</strong></div><div className="top-actions"><div className="shortcut-hint"><LockKeyhole size={14}/> Local backups</div><span className="top-separator"/><div className={`engine-pill ${connected ? 'good' : 'warn'}`}><span className="status-light"/>{connected ? 'System Ready' : 'Setup Required'}</div><button className="icon-button top-settings" onClick={() => setPage('settings')} title="ตั้งค่า"><Settings2 size={19}/></button></div></header>
      <div className="content"><div className="page-title"><div><div className="title-caption"><span className="caption-bar"/> YOUR GAME SAVE CONTROL CENTER</div><h1>{headings[page].title}</h1><p>{headings[page].caption}</p></div><div className="title-actions">
        {page !== 'settings' && <button className="btn btn-secondary" onClick={() => { setPage('history'); setSearch(''); }}><RotateCcw size={17}/> Restore Save</button>}
        {page !== 'settings' && <button className="btn btn-primary" onClick={scan} disabled={!connected || !!busy}>{busy === 'scan' ? <SmallSpinner/> : <RefreshCw size={17}/>} Scan Games</button>}
      </div></div>

        {booting && <div className="banner neutral"><SmallSpinner/>กำลังโหลดการตั้งค่า...</div>}
        {!booting && !connected && page !== 'settings' && <div className="banner warning"><AlertCircle size={20}/><div><strong>ยังไม่ได้เชื่อมต่อ Ludusavi</strong><span>เลือกไฟล์ ludusavi.exe ใน Settings เพื่อเปิดใช้ Scan, Backup และ Restore จากฐานข้อมูล Ludusavi อย่างเต็มรูปแบบ</span></div><button className="btn btn-sm btn-outline" onClick={() => setPage('settings')}>ตั้งค่าตอนนี้ <ArrowRight size={15}/></button></div>}

        {page === 'overview' && <>
          <section className="hero">
            <div className="hero-pattern"/><div className="hero-orb one"/><div className="hero-orb two"/>
            <div className="hero-content"><div className="hero-tag"><Sparkles size={14}/> THE NEXT LEVEL OF SAVE MANAGEMENT</div><h2>Your games.<br/><span>Always safe.</span></h2><p>Scan. Backup. Restore. จัดการไฟล์เซฟเกมอย่างมั่นใจ<br/>ด้วยพลังจากฐานข้อมูล Ludusavi ในโปรแกรม Desktop จริง</p><div className="hero-actions"><button className="btn btn-primary btn-large" onClick={scan} disabled={!connected || !!busy}>{busy === 'scan' ? <SmallSpinner/> : <RefreshCw size={18}/>} Scan My Games <ArrowRight size={18}/></button><button className="btn btn-hero-outline" onClick={() => setPage('history')}><RotateCcw size={17}/> Restore</button></div></div>
            <div className="hero-graphic" aria-hidden="true"><div className="hero-ring ring-1"/><div className="hero-ring ring-2"/><div className="hero-graphic-core"><div className="core-lines"/><Gamepad2 size={96} strokeWidth={1.25}/><div className="core-check"><Check size={24}/></div></div><div className="floating-chip chip-a"><ShieldCheck size={16}/> Protected</div><div className="floating-chip chip-b"><Database size={15}/> Safe backups</div></div>
            <span className="hero-decor-text">SAVE / RESTORE / REPEAT</span>
          </section>
          <div className="stats-grid"><StatCard icon={Gamepad2} value={lastScan ? games.length.toLocaleString() : '—'} label="เกมที่ตรวจพบ" sub={lastScan ? `สแกนล่าสุด ${whenText(lastScan)}` : 'รอการ Scan ครั้งแรก'} variant="blue"/><StatCard icon={FileArchive} value={countVersions.toLocaleString()} label="Backup Versions" sub={`${history.length} เกมมีประวัติ Backup`} variant="purple"/><StatCard icon={HardDrive} value={lastScan ? bytes(totalSize) : '—'} label="ขนาด Save ที่ตรวจพบ" sub="ข้อมูลจากการสแกนล่าสุด" variant="cyan"/><StatCard icon={ShieldCheck} value={connected ? 'พร้อมใช้งาน' : 'ตั้งค่าก่อน'} label="สถานะระบบ" sub={connected ? 'Ludusavi เชื่อมต่อสำเร็จ' : 'ยังไม่พบ Ludusavi CLI'} variant="green"/></div>
          <div className="overview-columns"><section className="panel"><SectionTitle eyebrow="YOUR LIBRARY" right={<button className="link-button" onClick={() => setPage('library')}>ดูทั้งหมด <ArrowRight size={15}/></button>}>เกมที่ตรวจพบล่าสุด</SectionTitle>
            {games.length ? <div className="compact-games">{games.slice(0,4).map(g => <div className="compact-game" key={g.name}><GameCover name={g.name} steamId={g.steamId} coverEnabled={settings?.showCovers ?? true} className="cover-compact"/><div><strong>{g.name}</strong><small>{g.fileCount} files • {bytes(g.bytes)}</small></div><button className="btn btn-tiny" onClick={() => doBackup(g.name)} disabled={!!busy}><Download size={15}/> Backup</button></div>)}</div> : <EmptyState icon={Gamepad2} title="ยังไม่มีเกมในรายการ" detail={connected ? 'กด Scan Games เพื่อค้นหา Save Game ที่อยู่ในเครื่อง' : 'เชื่อมต่อ Ludusavi แล้วกด Scan Games เพื่อเริ่มค้นหา'} action={<button className="btn btn-outline btn-sm" onClick={connected ? scan : () => setPage('settings')}>{connected ? 'สแกนหาเกม' : 'เชื่อมต่อ Ludusavi'} <ArrowRight size={15}/></button>}/>}
          </section><section className="panel"><SectionTitle eyebrow="RECOVERY CENTER" right={<button className="link-button" onClick={() => setPage('history')}>ดูประวัติ <ArrowRight size={15}/></button>}>Backup ล่าสุด</SectionTitle>
            {latestHistory.length ? <div className="recent-list">{latestHistory.map(h => <div key={h.name} className="recent-row"><span className="recent-icon"><FileClock size={18}/></span><div><strong>{h.name}</strong><small>{whenText(h.backups[0]?.when)}</small></div><button className="icon-button" aria-label={`Restore ${h.name}`} onClick={() => openRestore(h.name, h.backups[0]?.name)}><RotateCcw size={17}/></button></div>)}</div> : <EmptyState icon={History} title="ยังไม่มีประวัติ Backup" detail="เมื่อ Backup เกมแล้ว เวอร์ชันที่สำรองจะปรากฏตรงนี้ พร้อมปุ่ม Restore"/>}
          </section></div>
        </>}

        {page === 'library' && <><div className="toolbar"><div className="search-box"><Search size={18}/><input type="search" placeholder="ค้นหาเกมจากชื่อ..." value={search} onChange={e => setSearch(e.target.value)} aria-label="ค้นหาเกม"/></div><div className="toolbar-right"><span className="count-label">{visibleGames.length} GAMES</span><button className="btn btn-secondary" onClick={() => doBackup()} disabled={!connected || !games.length || !!busy}>{busy === 'backup' ? <SmallSpinner/> : <Download size={17}/>} Backup All</button></div></div>
          {visibleGames.length ? <div className="game-grid">{visibleGames.map(game => <article key={game.name} className="game-card"><GameCover name={game.name} steamId={game.steamId} coverEnabled={settings?.showCovers ?? true}/><div className="card-content"><div className="game-status"><span className="mini-dot"/> SAVE DETECTED</div><h3 title={game.name}>{game.name}</h3><div className="game-metadata"><span><FileArchive size={13}/> {game.fileCount + game.registryCount} items</span><span><HardDrive size={13}/> {bytes(game.bytes)}</span></div><div className="game-card-actions"><button className="btn btn-primary" disabled={!!busy} onClick={() => doBackup(game.name)}><Download size={15}/> Backup</button><button className="btn btn-card-outline" onClick={() => { const h = history.find(h => h.name === game.name); h ? openRestore(game.name, h.backups[0]?.name ?? '') : notify('info', 'ยังไม่มี Backup ของเกมนี้ กรุณาสำรองข้อมูลก่อน'); }}><RotateCcw size={15}/> Restore</button></div></div></article>)}</div> : <div className="panel library-empty"><EmptyState icon={search ? Search : Gamepad2} title={search ? 'ไม่พบเกมที่ค้นหา' : 'ยังไม่มีเกมที่ตรวจพบ'} detail={search ? 'ลองค้นหาด้วยชื่ออื่น' : 'กด Scan Games เพื่อตรวจหาไฟล์ Save จากฐานข้อมูล Ludusavi'} action={!search && <button className="btn btn-primary btn-sm" onClick={connected ? scan : () => setPage('settings')}>{connected ? 'Scan Games' : 'ตั้งค่า Ludusavi'}</button>}/></div>}
        </>}

        {page === 'history' && <><div className="toolbar"><div className="search-box"><Search size={18}/><input type="search" placeholder="ค้นหาชื่อเกมในประวัติ..." value={search} onChange={e => setSearch(e.target.value)}/></div><div className="toolbar-right"><span className="count-label">{countVersions} BACKUP VERSIONS</span><button className="btn btn-secondary" onClick={() => run('history', async () => { await refreshHistory(); notify('success', 'อัปเดตประวัติแล้ว'); })} disabled={!connected || !!busy}><RefreshCw size={17} className={busy === 'history' ? 'spin' : ''}/> Refresh</button></div></div>
          <div className="restore-note"><ShieldCheck size={18}/><div><strong>Safe Restore Protection</strong><span>ก่อนกู้คืน โปรแกรมจะพยายามสร้าง Safety Snapshot ของ Save ปัจจุบันไว้ต่างหากทุกครั้ง</span></div></div>
          {visibleHistory.length ? <div className="history-list">{visibleHistory.map(group => <div className="history-group" key={group.name}><button className="history-group-head" onClick={() => setExpanded(expanded === group.name ? null : group.name)}><div className="history-icon"><Gamepad2 size={21}/></div><div className="history-game-info"><strong>{group.name}</strong><small>{group.backups.length} backup versions</small></div><span className="history-latest">{whenText(group.backups[0]?.when)}</span><ChevronDown size={18} className={expanded === group.name ? 'expanded' : ''}/></button><div className="history-actions"><button className="btn btn-outline btn-sm" onClick={() => openRestore(group.name, group.backups[0]?.name ?? '')}><RotateCcw size={16}/> Restore Latest</button></div>{expanded === group.name && <div className="versions-list">{ensureArray(group.backups).map((entry, i) => <div className="version" key={entry.name}><div className="version-dot"/><div><strong>{whenText(entry.when)}</strong><small>{entry.comment || entry.name}{i === 0 ? ' • Latest' : ''}</small></div><button className="btn btn-tiny" onClick={() => openRestore(group.name, entry.name)}><RotateCcw size={14}/> Restore</button></div>)}</div>}</div>)}</div> : <div className="panel library-empty"><EmptyState icon={History} title={search ? 'ไม่พบประวัติสำหรับชื่อนี้' : 'ยังไม่มี Backup History'} detail={search ? 'ลองใช้คำค้นหาอื่น' : 'เมื่อ Backup แล้ว รายการเวอร์ชันย้อนหลังจะปรากฏที่นี่'} action={!search && <button className="btn btn-outline btn-sm" onClick={() => setPage('library')}>ไปหน้าเกมของฉัน <ArrowRight size={15}/></button>}/></div>}
        </>}

        {page === 'settings' && <div className="settings-layout"><section className="settings-panel"><SectionTitle eyebrow="GAME DETECTION ENGINE">Ludusavi Integration</SectionTitle><div className="settings-lead"><div className="settings-lead-icon"><Database size={24}/></div><div><strong>Powered by Ludusavi</strong><p>ระบบ Scan / Backup / Restore ใช้โปรแกรม Ludusavi CLI ทางการ แทนการรันคำสั่งที่ไม่ทราบที่มา</p></div><span className={`status-tag ${connected ? 'green' : 'amber'}`}>{connected ? 'Connected' : 'Not connected'}</span></div><label className="setting-label">ตำแหน่ง Ludusavi.exe</label><div className="file-picker"><div className="path-text" title={settings?.enginePath || status?.enginePath || ''}><Folder size={17}/>{settings?.enginePath || status?.enginePath || 'ยังไม่ได้เลือกไฟล์'}</div><button className="btn btn-outline btn-sm" onClick={() => void chooseEngine()} disabled={!!busy}><FolderOpen size={16}/> Browse</button></div><p className="setting-help">ดาวน์โหลดเฉพาะจาก <a href="https://github.com/mtkennerly/ludusavi/releases" target="_blank" rel="noopener noreferrer">Ludusavi GitHub Releases <ExternalLink size={12}/></a> และตรวจสอบแหล่งที่มาก่อนใช้งาน</p><div className="settings-rule"/><div className="setting-row"><div><strong>Game Database</strong><p>อัปเดตฐานข้อมูลเกมผ่าน Ludusavi เมื่อคุณกดปุ่มเท่านั้น</p><small>{status?.manifestAvailable ? 'พบไฟล์ manifest.yaml ในระบบ' : 'ไม่พบ manifest.yaml ในตำแหน่งมาตรฐาน (Ludusavi อาจใช้โหมด portable)'}</small></div><button className="btn btn-secondary btn-sm" onClick={databaseUpdate} disabled={!connected || !!busy}>{busy === 'update' ? <SmallSpinner/> : <RefreshCw size={16}/>} Update</button></div><div className="settings-rule"/><div className="setting-row"><div><strong>Steam Cover Art</strong><p>แสดงปกจาก Steam CDN เฉพาะเกมที่มี Steam ID ในฐานข้อมูล Ludusavi</p><small>เมื่อเปิด จะส่งคำขอภาพไปยัง Steam CDN</small></div><button role="switch" aria-checked={settings?.showCovers ?? false} className={`toggle ${settings?.showCovers ? 'on' : ''}`} onClick={() => settings && void save({ ...settings, showCovers: !settings.showCovers })} disabled={!settings || !!busy}><span/></button></div></section>
          <section className="settings-panel"><SectionTitle eyebrow="STORAGE LOCATION">Backup Storage</SectionTitle><label className="setting-label">โฟลเดอร์เก็บ Backup</label><div className="file-picker"><div className="path-text" title={settings?.backupDir || ''}><Folder size={17}/>{settings?.backupDir || '—'}</div><button className="btn btn-outline btn-sm" onClick={() => void chooseBackupDir()} disabled={!!busy}><FolderOpen size={16}/> Browse</button></div><p className="setting-help">เก็บไฟล์ตามรูปแบบของ Ludusavi — รองรับประวัติและหลายเวอร์ชัน (ไม่ใช่ ZIP จาก V3)</p><div className="settings-rule"/><div className="setting-row"><div><strong>Backups kept locally</strong><p>ข้อมูลเกมเก็บไว้ในโฟลเดอร์ที่เลือก ไม่มีการส่ง Save ไปยังเซิร์ฟเวอร์ของ GameSave Vault</p></div><ShieldCheck className="setting-icon-green" size={23}/></div><div className="settings-rule"/><div className="setting-row"><div><strong>Restore safety snapshots</strong><p>สร้างสำเนา Save ปัจจุบันไว้ใน App Data ก่อน Restore เพื่อย้อนกลับได้เมื่อเกิดปัญหา</p></div><Shield size={23} className="setting-icon-blue"/></div></section>
          <section className="settings-panel disclaimer-panel"><SectionTitle eyebrow="SECURITY & TRANSPARENCY">Security Information</SectionTitle><div className="security-feature"><LockKeyhole size={19}/><span>ไม่เปิดเว็บเซิร์ฟเวอร์ localhost และไม่ใช้ PowerShell หรือ cmd.exe</span></div><div className="security-feature"><ShieldCheck size={19}/><span>ไม่ดาวน์โหลดหรือรัน EXE อื่นอัตโนมัติ ผู้ใช้เป็นคนเลือก Ludusavi เอง</span></div><div className="security-feature"><Info size={19}/><span>ไฟล์ติดตั้ง V4 ที่ Build ใหม่ยังต้องทดสอบและสแกน VirusTotal ก่อนใช้งานจริง</span></div><div className="settings-footer">GameSave Vault V4.0.0 • Tauri 2 + React + Rust • Windows 10/11</div></section></div>}
      </div>
    </main>

    {!!busy && <div className="busy-status" role="status"><SmallSpinner/>{busy === 'scan' ? 'กำลังสแกน Save Game...' : busy === 'restore' ? 'กำลังกู้คืน Save Game...' : busy === 'preview' ? 'กำลังตรวจสอบ Restore...' : busy === 'backup' ? 'กำลัง Backup...' : busy === 'update' ? 'กำลังอัปเดตฐานข้อมูล...' : 'กำลังทำรายการ...'}</div>}
    {notice && <div className={`toast ${notice.kind}`} role="status">{notice.kind === 'success' ? <CheckCircle2 size={21}/> : notice.kind === 'error' ? <AlertCircle size={21}/> : <Info size={21}/>}<div>{notice.message}</div><button aria-label="ปิดข้อความ" onClick={() => setNotice(null)}><X size={18}/></button></div>}
    {restore && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && busy !== 'restore') setRestore(null); }}><div className="restore-modal" role="dialog" aria-modal="true" aria-label="Confirm restore"><div className="modal-top"><div className="modal-icon"><RotateCcw size={24}/></div><button className="icon-button" aria-label="ปิด" disabled={busy === 'restore'} onClick={() => setRestore(null)}><X size={21}/></button></div><div className="eyebrow">SAFE RESTORE WORKFLOW</div><h2>Restore Save Game</h2><p className="modal-desc">กำลังจะกู้คืน <strong>{restore.game}</strong> {restore.backupId ? `จากเวอร์ชัน ${restore.backupId}` : 'จาก Backup ล่าสุด'} โดยข้อมูลปัจจุบันอาจถูกเขียนทับ</p><div className="restore-preview"><div><FileArchive size={18}/><strong>Restore Preview</strong></div>{busy === 'preview' ? <p><SmallSpinner/> กำลังตรวจสอบรายการไฟล์...</p> : preview ? <p>ตรวจพบ {preview.totalGames} เกม • ข้อมูลประมาณ {bytes(preview.processedBytes)} (การ Preview ยังไม่เปลี่ยนไฟล์)</p> : <p className="preview-error">ยังไม่ได้รับผล Preview ที่สำเร็จ กรุณาปิดและลองใหม่</p>}</div><label className="setting-label" htmlFor="confirm-name">พิมพ์ชื่อเกมให้ตรงเพื่อยืนยัน</label><input id="confirm-name" className="confirm-input" value={confirmedName} onChange={e => setConfirmedName(e.target.value)} placeholder={restore.game} spellCheck={false} autoComplete="off"/><label className="safety-choice"><input type="checkbox" checked={skipSafety} onChange={e => setSkipSafety(e.target.checked)}/><span><strong>ข้าม Safety Snapshot (ไม่แนะนำ)</strong><small>ใช้เฉพาะเมื่อไม่มี Save ปัจจุบันหรือยืนยันว่ารับความเสี่ยงการสูญเสียข้อมูลได้</small></span></label><div className="modal-actions"><button className="btn btn-secondary" disabled={busy === 'restore'} onClick={() => setRestore(null)}>ยกเลิก</button><button className="btn btn-danger" disabled={!preview || !!busy || confirmedName !== restore.game} onClick={doRestore}>{busy === 'restore' ? <SmallSpinner/> : <RotateCcw size={17}/>} ยืนยัน Restore</button></div></div></div>}
  </div>;
}
