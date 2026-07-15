/* ═══════════════════════════════════════════════════
   Zone — Study OS  |  Console v4 (Clean Design)
   ═══════════════════════════════════════════════════ */

const ZoneApp = (() => {
  'use strict';

  const state = {
    config: null, tracks: null,
    tab: 'console', // console | wallpapers
    currentZoneIdx: 0,
    byZone: {},
    dayComplete: false,
    onboarded: false,
    sidebarOpen: true, fullscreen: false,
    events: [],
    stats: { totalSessions: 0, totalFocusMin: 0, dayStart: null, history: {} },
    tracking: { log: [], zoneStats: {}, sessionCount: 0, dailyZones: {}, archivedDaily: {} },
    settings: { notifEnabled: true, soundEnabled: true, quietMode: false, showDefaultEvents: true, theme: 'hacker', autoStartBreaks: true, flowMode: false, timerPreset: 'custom', soundPack: 'default' },
    examTrack: null,
    examDates: [],
    wpStyle: 'mission_control', wpSize: 'mobile',
    audioCtx: null, timerHandle: null, notifAsked: false,
    examCountdownMode: 'full', // full | days | hours | mins | secs
    selectedDate: null // time travel: null = real today, 'YYYY-MM-DD' = selected
  };

  let $root, $toastContainer;

  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  // Escape for JavaScript string context inside HTML onclick="" attributes
  // (HTML entities are decoded before JS execution, so esc() alone is NOT sufficient)
  const jsEsc = s => String(s ?? '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"').replace(/</g,'\\x3c').replace(/>/g,'\\x3e');
  const uid = () => Math.random().toString(36).slice(2,9);

  // Robust JSON parse for user-imported files: strips UTF-8 BOM (common from
  // Windows editors / Excel exports) and stray leading/trailing whitespace,
  // both of which make otherwise-valid JSON throw in JSON.parse.
  function parseImportedJSON(raw) {
    let text = String(raw ?? '');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
    text = text.trim();
    return JSON.parse(text);
  }

  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  }

  function to12h(t) {
    if (!t) return '→ open';
    const [h, m] = t.split(':').map(Number);
    const suf = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2,'0')} ${suf}`;
  }

  // BUG FIX: previously used new Date().toISOString().slice(0,10), which returns
  // the UTC date. For any user ahead of UTC (e.g. IST, UTC+5:30) the "day" then
  // rolled over at 5:30 AM local time instead of local midnight — while the
  // calendar tab's "today" highlight used local date parts. Late-night sessions
  // (12 AM - 5:30 AM local) got logged under the previous day's key in pomodoro
  // /stats but showed as "today" on the calendar, causing the two to disagree.
  // localDateKey() now builds the key from local date components everywhere.
  function localDateKey(d) {
    d = d || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function todayKey() { return state.selectedDate || localDateKey(); }
  function realTodayKey() { return localDateKey(); }

  let defaultEventsCache = null;
  let defaultEventsYear = null;

  function generateHolidays(year) {
    const y = year;
    const e = (m, d, t, c, note) => ({ date: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`, title: t, type: c, color: c === 'national' ? '#FF8A3D' : c === 'festival' ? '#FBBF24' : '#6B7686', note: note || '' });

    const fixed = [
      e(1, 26, '🇮🇳 Republic Day', 'national'),
      e(2, 14, 'Valentine\'s Day', 'observance'),
      e(3, 8, 'International Women\'s Day', 'observance'),
      e(4, 1, 'April Fool\'s Day', 'observance'),
      e(4, 14, 'Ambedkar Jayanti', 'national'),
      e(5, 1, 'Labour Day', 'national'),
      e(5, 10, 'Mother\'s Day', 'observance'),
      e(6, 21, 'International Yoga Day', 'observance'),
      e(6, 21, 'Father\'s Day', 'observance'),
      e(7, 1, 'National Doctors\' Day', 'observance'),
      e(8, 15, '🇮🇳 Independence Day', 'national'),
      e(9, 5, 'Teachers\' Day', 'observance'),
      e(10, 2, '🕊️ Gandhi Jayanti', 'national'),
      e(10, 31, 'Halloween', 'observance'),
      e(11, 14, 'Children\'s Day', 'observance'),
      e(12, 25, '🎄 Christmas', 'festival'),
      e(12, 31, 'New Year\'s Eve', 'observance'),
    ];

    const approx = [
      { m: 1, d: 14, t: 'Makar Sankranti / Pongal', c: 'festival' },
      { m: 1, d: 15, t: 'Pongal (Day 2)', c: 'festival' },
      { m: 2, d: 19, t: 'Maha Shivaratri', c: 'festival' },
      { m: 3, d: 8, t: 'Holi', c: 'festival' },
      { m: 3, d: 22, t: 'Ugadi / Gudi Padwa', c: 'festival' },
      { m: 3, d: 28, t: 'Good Friday', c: 'observance' },
      { m: 4, d: 1, t: 'Eid ul-Fitr', c: 'festival' },
      { m: 4, d: 5, t: 'Easter Sunday', c: 'observance' },
      { m: 4, d: 14, t: 'Baisakhi / Vishu', c: 'festival' },
      { m: 4, d: 15, t: 'Pohela Boishakh (Bengali New Year)', c: 'festival' },
      { m: 6, d: 8, t: 'Rath Yatra', c: 'festival' },
      { m: 8, d: 20, t: 'Janmashtami', c: 'festival' },
      { m: 8, d: 29, t: 'Ganesh Chaturthi', c: 'festival' },
      { m: 9, d: 8, t: 'Eid ul-Adha (Bakrid)', c: 'festival' },
      { m: 10, d: 2, t: 'Mahalaya', c: 'festival' },
      { m: 10, d: 12, t: 'Dussehra / Durga Puja', c: 'festival' },
      { m: 10, d: 20, t: '🪔 Diwali', c: 'festival' },
      { m: 10, d: 21, t: 'Govardhan Puja', c: 'festival' },
      { m: 10, d: 22, t: 'Bhai Dooj', c: 'festival' },
      { m: 10, d: 30, t: 'Chhath Puja', c: 'festival' },
      { m: 11, d: 4, t: 'Guru Nanak Jayanti', c: 'festival' },
    ];

    const apprEvents = approx.map(a => {
      const ev = e(a.m, a.d, a.t, a.c);
      ev.notes = 'Approximate date';
      return ev;
    });

    return [...fixed, ...apprEvents];
  }

  function getDefaultEvents() {
    if (!state.settings.showDefaultEvents) return [];
    const viewYear = calYear || new Date().getFullYear();
    const currentYear = new Date().getFullYear();
    // Cache key includes both years to avoid stale results
    const cacheKey = `${viewYear}:${currentYear}`;
    if (defaultEventsYear === cacheKey && defaultEventsCache) return defaultEventsCache;
    defaultEventsYear = cacheKey;
    const events = new Map();
    // Always include current year holidays so "Today's Events" never loses them
    generateHolidays(currentYear).forEach(h => {
      const id = 'default-' + h.date + '-' + h.title.replace(/[^a-z0-9]/gi,'').slice(0,8);
      events.set(id, { ...h, id, default: true });
    });
    // If viewing a different year in the calendar, also include those
    if (viewYear !== currentYear) {
      generateHolidays(viewYear).forEach(h => {
        const id = 'default-' + h.date + '-' + h.title.replace(/[^a-z0-9]/gi,'').slice(0,8);
        if (!events.has(id)) events.set(id, { ...h, id, default: true });
      });
    }
    defaultEventsCache = [...events.values()];
    return defaultEventsCache;
  }

  function getMergedEvents() {
    if (!Array.isArray(state.events)) state.events = [];
    return [...getDefaultEvents(), ...state.events];
  }

  function isGuest() { return !!localStorage.getItem('zone_guest'); }

  const EXAM_DATES_BY_TRACK = (year = null) => {
    const y = year || new Date().getFullYear() + 1;
    return {
    JEE: [
      { id: 'jee_main', name: `JEE Main ${y}`, defaultDate: `${y}-01-24`, icon: '📝' },
      { id: 'jee_adv', name: `JEE Advanced ${y}`, defaultDate: `${y}-05-23`, icon: '🎯' }
    ],
    NEET: [
      { id: 'neet', name: `NEET UG ${y}`, defaultDate: `${y}-05-02`, icon: '⚕️' }
    ],
    UPSC: [
      { id: 'upsc_pre', name: `UPSC Prelims ${y}`, defaultDate: `${y}-06-13`, icon: '📋' },
      { id: 'upsc_main', name: `UPSC Mains ${y}`, defaultDate: `${y}-09-19`, icon: '📚' }
    ],
    GATE: [
      { id: 'gate', name: `GATE ${y}`, defaultDate: `${y}-02-07`, icon: '⚙️' }
    ],
    CA: [
      { id: 'ca', name: `CA Exams ${y}`, defaultDate: `${y}-05-15`, icon: '📊' }
    ],
    BOARDS: [
      { id: 'boards', name: `Board Exams ${y}`, defaultDate: `${y}-03-01`, icon: '🏫' }
    ],
    CUSTOM: [
      { id: 'custom', name: 'Target Date', defaultDate: `${y}-06-01`, icon: '🎯' }
    ]
  };
  };

  function storage() {
    const pre = isGuest() ? 'zg:' : 'zu:';
    function tryGet(k) {
      try {
        let v = localStorage.getItem(pre + k);
        if (v === null) v = localStorage.getItem('zone:' + k);
        if (v === null) v = localStorage.getItem((pre === 'zg:' ? 'zu:' : 'zg:') + k);
        return v ? JSON.parse(v) : null;
      } catch { return null; }
    }
    function trySet(k, v) {
      try { localStorage.setItem(pre + k, JSON.stringify(v)); return true; } catch { return false; }
    }
    function tryRemove(k) {
      try { localStorage.removeItem(pre + k); localStorage.removeItem('zone:' + k); } catch {}
    }
    return { get: tryGet, set: trySet, remove: tryRemove };
  }

  async function saveUserDataToServer(key, val) {
    if (isGuest()) return;
    try {
      const data = val !== undefined ? val : state[key];
      await fetchJSON('/api/user-data', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ key, value: data })
      });
    } catch {}
  }

  let _lastHttpSave = 0;
  let _pendingHttpSave = null;

  function _flushHttpSave() {
    if (isGuest()) return;
    const session = {
      currentZoneIdx: state.currentZoneIdx,
      byZone: state.byZone,
      dayComplete: state.dayComplete,
      date: todayKey()
    };
    saveUserDataToServer('session', session);
    saveUserDataToServer('stats');
    saveUserDataToServer('tracking');
    saveUserDataToServer('events');
    saveUserDataToServer('settings');
    saveUserDataToServer('examTrack');
    saveUserDataToServer('examDates');
    saveUserDataToServer('onboarded');
    _lastHttpSave = Date.now();
    _pendingHttpSave = null;
  }

  /* Force-save for beforeunload: bypasses all throttles */
  function forceSave() {
    const session = {
      currentZoneIdx: state.currentZoneIdx,
      byZone: state.byZone,
      dayComplete: state.dayComplete,
      date: todayKey()
    };
    storage().set('onboarded', state.onboarded);
    storage().set('session', session);
    storage().set('events', state.events);
    storage().set('stats', state.stats);
    storage().set('tracking', state.tracking);
    storage().set('settings', state.settings);
    storage().set('examTrack', state.examTrack);
    storage().set('examDates', state.examDates);
    if (isGuest()) return;
    const beaconData = {
      session, stats: state.stats, tracking: state.tracking,
      events: state.events, settings: state.settings,
      examTrack: state.examTrack, examDates: state.examDates,
      onboarded: state.onboarded
    };
    Object.entries(beaconData).forEach(([k, v]) => {
      try {
        const payload = JSON.stringify({ key: k, value: v });
        // sendBeacon silently drops payloads > 64 KiB; fall back to keepalive fetch
        if (!navigator.sendBeacon('/api/user-data', new Blob([payload], { type: 'application/json' }))) {
          fetch('/api/user-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
        }
      } catch {}
    });
    // Also persist config via beacon (separate endpoint from user-data)
    // sendBeacon only supports POST, but config needs PUT — use keepalive fetch
    try {
      const cfgPayload = JSON.stringify(state.config);
      fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: cfgPayload, keepalive: true }).catch(() => {});
    } catch {}
  }

  function saveState() {
    const now = Date.now();
    if (now - (state._lastStateSave || 0) < 2000) return;
    state._lastStateSave = now;
    const session = {
      currentZoneIdx: state.currentZoneIdx,
      byZone: state.byZone,
      dayComplete: state.dayComplete,
      date: todayKey()
    };
    storage().set('onboarded', state.onboarded);
    storage().set('session', session);
    storage().set('events', state.events);
    storage().set('stats', state.stats);
    storage().set('tracking', state.tracking);
    storage().set('settings', state.settings);
    storage().set('examTrack', state.examTrack);
    storage().set('examDates', state.examDates);
    if (isGuest()) return;
    if (now - _lastHttpSave < 5000) {
      if (!_pendingHttpSave) _pendingHttpSave = setTimeout(_flushHttpSave, 5000 - (now - _lastHttpSave));
      return;
    }
    _flushHttpSave();
  }

  function loadSession() { return storage().get('session'); }

  function saveConfig() {
    storage().set('config', state.config);
    apiUpdateConfig(state.config).catch(() => toast('Config sync failed — saved locally only', 'warning'));
  }

  // ─── Sound ───────────────────────────────────
  function beep(freq = 880, dur = 140, delay = 0, vol = 0.05) {
    try {
      if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = state.audioCtx;
      // Resume suspended context (browser autoplay policy blocks audio outside user gesture)
      if (ctx.state === 'suspended') ctx.resume();
      setTimeout(() => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.frequency.value = freq; osc.type = 'sine';
        gain.gain.value = vol;
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + dur/1000);
      }, delay);
    } catch {}
  }

  const SOUND_PACKS = {
    default: { label: 'Default', transition: [660,120,0,880,140,140], breakstart: [500,180,0], complete: [660,120,0,880,120,150,1046,220,300], tick: [440,30,0,0.03] },
    soft: { label: 'Soft', transition: [440,200,0,550,200,200], breakstart: [330,250,0], complete: [440,200,0,550,200,150,660,300,300], tick: [330,50,0,0.02] },
    digital: { label: 'Digital', transition: [800,80,0,1000,80,80], breakstart: [600,100,0], complete: [800,80,0,1000,80,80,1200,150,160], tick: [600,20,0,0.02] },
    nature: { label: 'Nature (Silent)', transition: [], breakstart: [], complete: [], tick: [] }
  };

  function chime(kind) {
    if (!state.settings.soundEnabled) return;
    const pack = SOUND_PACKS[state.settings.soundPack] || SOUND_PACKS.default;
    const seq = pack[kind];
    if (!seq || seq.length === 0) return;
    const stride = seq.length % 4 === 0 ? 4 : 3;
    for (let i = 0; i < seq.length; i += stride) {
      beep(seq[i], seq[i+1], seq[i+2], stride === 4 ? seq[i+3] : undefined);
    }
  }

  const TIMER_PRESETS = {
    custom: { label: 'Custom', focus: 25, break: 5, long: 15, cycles: 4 },
    pomodoro: { label: 'Pomodoro 25/5', focus: 25, break: 5, long: 15, cycles: 4 },
    power: { label: 'Power 50/10', focus: 50, break: 10, long: 20, cycles: 4 },
    deep: { label: 'Deep 90/20', focus: 90, break: 20, long: 30, cycles: 3 }
  };

  function applyPreset(presetKey) {
    if (presetKey === 'custom') return;
    const p = TIMER_PRESETS[presetKey];
    if (!p) return;
    state.settings.timerPreset = presetKey;
    getZones().forEach(z => {
      z.focusDuration = p.focus;
      z.breakDuration = p.break;
      z.longBreakDuration = p.long;
      z.totalCycles = p.cycles;
    });
    // Reset current zone state so new durations take effect
    getZones().forEach((_, i) => {
      const zs = state.byZone[i];
      if (zs) {
        zs.remaining = p.focus * 60;
        zs.total = p.focus * 60;
        zs.elapsed = 0;
        zs.zoneElapsed = 0;
        zs.cycle = 0;
        zs.blockType = 'focus';
        zs.completed = false;
        zs.running = false;
    zs.blockComplete = false;
    zs.overtimeSeconds = 0;
      }
    });
    stopTimer();
    saveState();
    toast(`Applied "${p.label}" preset to all zones`, 'success');
    renderAll();
  }

  function setSetting(key, value) {
    state.settings[key] = value;
    storage().set('settings', state.settings);
    if (!isGuest()) saveUserDataToServer('settings');
    renderTabBody();
    if (key === 'timerPreset') applyPreset(value);
  }

  function notifSend(title, body) {
    if (!state.settings.notifEnabled || state.settings.quietMode) return;
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try { new Notification(title, { body }); } catch {}
    }
  }

  async function notifRequest() {
    if (state.notifAsked) return;
    state.notifAsked = true;
    if ('Notification' in window && Notification.permission === 'default')
      await Notification.requestPermission();
  }

  // ─── API ─────────────────────────────────────
  async function fetchJSON(url, opts = {}) {
    opts.credentials = 'same-origin';
    const r = await fetch(url, opts);
    if (r.status === 401) { window.location.href = '/login.html'; return null; }
    if (!r.ok) { const b = await r.json().catch(()=>{}); throw new Error(b?.detail || 'API error: ' + r.status); }
    return r.json();
  }
  const apiConfig = () => fetchJSON('/api/config');
  const apiTracks = () => fetchJSON('/api/exam-tracks');
  const apiUpdateConfig = (data) => fetchJSON('/api/config', {
    method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data), keepalive: true
  });

  // ─── Toast ───────────────────────────────────

  function toast(msg, type = 'info', dur = 3500) {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<span>${type === 'success' ? '✓' : type === 'warning' ? '⚠' : type === 'error' ? '✕' : 'ℹ'}</span><span>${esc(msg)}</span>`;
    $toastContainer.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; setTimeout(() => el.remove(), 300); }, dur);
  }

  function confetti() {
    const colors = ['#6c5ce7','#a29bfe','#fd79a8','#00b894','#fdcb6e','#ff7675','#74b9ff','#00cec9'];
    for (let i = 0; i < 50; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.left = Math.random() * 100 + '%'; el.style.top = '-10px';
      el.style.background = colors[i % colors.length];
      el.style.animationDuration = (2 + Math.random() * 3) + 's';
      el.style.animationDelay = Math.random() * 0.8 + 's';
      el.style.width = (4 + Math.random() * 8) + 'px';
      el.style.height = (4 + Math.random() * 8) + 'px';
      el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 5000);
    }
  }

  // ─── Tracking Engine ──────────────────────────
  function getTodayLog() { return state.tracking.log.filter(e => e.date === todayKey()); }

  // BUG FIX: log.splice() used to just delete the oldest raw events once the
  // log passed 5000 entries, with no record kept anywhere else. But
  // getTrackingStats() computes ALL-TIME totals (All Sessions, Total Focus,
  // History table, monthly groups, streak) by re-scanning this same `log`
  // array — so every trim silently shrank those "permanent" numbers, which
  // looked exactly like an unwanted reset. Now we fold the events being
  // dropped into `archivedDaily` (a permanent per-day summary) first, and
  // getTrackingStats() merges that back in, so old totals are never lost.
  function archiveOldEvents(events) {
    if (!state.tracking.archivedDaily) state.tracking.archivedDaily = {};
    const store = state.tracking.archivedDaily;
    const hadTimerByZoneDate = new Set(
      events.filter(e => e.type === 'session_complete').map(e => e.date + '|' + e.zoneIdx)
    );
    events.forEach(e => {
      if (!store[e.date]) store[e.date] = { focusMin: 0, sessions: 0, manualDone: 0, skips: 0 };
      const day = store[e.date];
      if (e.type === 'session_complete') {
        day.focusMin += (e.duration || 0);
        day.sessions++;
      } else if (e.type === 'zone_complete') {
        if (!hadTimerByZoneDate.has(e.date + '|' + e.zoneIdx)) {
          day.focusMin += (getZone(e.zoneIdx)?.focusDuration || 25);
          day.manualDone++;
        }
      } else if (e.type === 'skip_block' || e.type === 'skip_zone') {
        day.skips++;
      } else if (e.type === 'overtime') {
        day.focusMin += Math.round((e.seconds || 0) / 60);
      }
    });
  }

  function logEvent(type, data = {}) {
    const entry = { id: uid(), date: todayKey(), time: new Date().toISOString(), type, ...data };
    state.tracking.log.push(entry);
    if (state.tracking.log.length > 5000) {
      let removeCount = state.tracking.log.length - 3000;
      // Don't split one day's events across the archive boundary, or that
      // day's totals could double count (partly live, partly archived).
      const cutDate = state.tracking.log[removeCount - 1]?.date;
      while (removeCount < state.tracking.log.length && state.tracking.log[removeCount].date === cutDate) removeCount++;
      archiveOldEvents(state.tracking.log.splice(0, removeCount));
    }

    const z = getZone(state.currentZoneIdx);
    const zi = state.currentZoneIdx;
    if (!state.tracking.zoneStats[zi]) state.tracking.zoneStats[zi] = { sessions: 0, skips: 0, pauses: 0, totalMin: 0, completes: 0, doneNoTimer: 0 };
    if (type === 'session_complete') {
      state.tracking.zoneStats[zi].sessions++;
      state.tracking.zoneStats[zi].totalMin += (data.duration || z?.focusDuration || 25);
    }
    if (type === 'skip_block') state.tracking.zoneStats[zi].skips++;
    if (type === 'skip_zone') state.tracking.zoneStats[zi].skips++;
    if (type === 'pause') state.tracking.zoneStats[zi].pauses = (state.tracking.zoneStats[zi].pauses || 0) + 1;
    if (type === 'zone_complete') state.tracking.zoneStats[zi].completes++;
    if (type === 'session_start') state.tracking.sessionCount++;
    saveState();
  }

  function getTrackingStats(cutoffDate) {
    const log = state.tracking.log;
    const today = todayKey();
    // If time travel is active, filter log to only include dates <= cutoff
    const filteredLog = cutoffDate ? log.filter(e => e.date <= cutoffDate) : log;
    const todayEvents = filteredLog.filter(e => e.date === today);
    const zones = getZones();
    const zoneLookup = (idx) => zones[idx] || { focusDuration: 25 };

    const sessionsToday = todayEvents.filter(e => e.type === 'session_complete').length;
    const skipsToday = todayEvents.filter(e => e.type === 'skip_block' || e.type === 'skip_zone').length;

    // Track which zones had timer sessions per day (to avoid double-counting zone_complete)
    const zonesWithTimerToday = new Set(todayEvents.filter(e => e.type === 'session_complete').map(e => e.zoneIdx));

    const manualToday = todayEvents.filter(e => e.type === 'zone_complete' && !zonesWithTimerToday.has(e.zoneIdx)).length;
    const focusMinToday = todayEvents.filter(e => e.type === 'session_complete')
      .reduce((a, e) => a + (e.duration || 0), 0)
      + todayEvents.filter(e => e.type === 'zone_complete' && !zonesWithTimerToday.has(e.zoneIdx))
        .reduce((a, e) => a + (zoneLookup(e.zoneIdx).focusDuration || 25), 0)
      + todayEvents.filter(e => e.type === 'overtime')
        .reduce((a, e) => a + Math.round((e.seconds || 0) / 60), 0);
    const archivedDaily = state.tracking.archivedDaily || {};
    const totalSessions = filteredLog.filter(e => e.type === 'session_complete').length
      + Object.entries(archivedDaily).filter(([d]) => !cutoffDate || d <= cutoffDate).reduce((s, [, d]) => s + (d.sessions || 0), 0);

    const dailyMap = {};
    filteredLog.forEach(e => {
      const date = e.date;
      if (!dailyMap[date]) dailyMap[date] = { focusMin: 0, timerMin: 0, sessions: 0, manualDone: 0, skips: 0, events: [] };
      if (e.type === 'session_complete') {
        const d = e.duration || 0;
        dailyMap[date].focusMin += d;
        dailyMap[date].timerMin += d;
        dailyMap[date].sessions++;
      }
      if (e.type === 'zone_complete') {
        // Only count as manual if this zone had NO timer sessions this day
        const hadTimer = filteredLog.some(ev => ev.date === date && ev.type === 'session_complete' && ev.zoneIdx === e.zoneIdx);
        if (!hadTimer) {
          const d = zoneLookup(e.zoneIdx).focusDuration || 25;
          dailyMap[date].focusMin += d;
          dailyMap[date].manualDone++;
        }
      }
      if (e.type === 'skip_block' || e.type === 'skip_zone') {
        dailyMap[date].skips++;
        // Count partial focus time from skipped blocks (duration field added in timerSkip)
        if (e.type === 'skip_block' && e.duration > 0) {
          dailyMap[date].focusMin += e.duration;
        }
      }
      if (e.type === 'overtime') {
        dailyMap[date].focusMin += Math.round((e.seconds || 0) / 60);
      }
      dailyMap[date].events.push(e);
    });
    // Days whose raw events were already trimmed from `log` still need to
    // count toward all-time totals and the History table — pull them back
    // in from the permanent per-day archive. These dates are always older
    // than anything left in `log` (archiveOldEvents never splits a day
    // across the boundary), so there's no overlap/double-count risk.
    Object.keys(archivedDaily).forEach(date => {
      if (cutoffDate && date > cutoffDate) return;
      if (!dailyMap[date]) {
        const a = archivedDaily[date];
        dailyMap[date] = { focusMin: a.focusMin, timerMin: a.focusMin, sessions: a.sessions, manualDone: a.manualDone, skips: a.skips, events: [], archived: true };
      }
    });
    const totalManual = Object.values(dailyMap).reduce((s, d) => s + (d.manualDone || 0), 0);
    const totalFocusMin = Object.values(dailyMap).reduce((s, d) => s + (d.focusMin || 0), 0);

    let streak = 0;
    const dates = Object.keys(dailyMap).sort().reverse();
    for (let i = 0; i < dates.length; i++) {
      // In time travel mode, only count streak up to selected date
      if (cutoffDate && dates[i] > cutoffDate) continue;
      const dMin = dailyMap[dates[i]]?.focusMin || 0;
      if (dMin < 30) {
        // BUG FIX: `dailyMap` gets an entry for ANY logged event (session_start,
        // pause, etc.), not just completed focus sessions. So today could show
        // up here with 0 focus minutes just because a timer was started but not
        // finished yet — that should not zero out a real, ongoing streak since
        // today isn't "over" yet. Skip today instead of breaking on it.
        if (dates[i] === today) continue;
        break;
      }
      if (i > 0) {
        const gap = (Date.parse(dates[i-1]) - Date.parse(dates[i])) / 86400000;
        if (gap > 2) break;
      }
      streak++;
    }

    // Compute zone data — when in time travel, derive from filtered log only
    let zoneData;
    if (cutoffDate) {
      zoneData = zones.map((z, i) => {
        const zoneEvents = filteredLog.filter(e => e.zoneIdx === i);
        const sessions = zoneEvents.filter(e => e.type === 'session_complete').length;
        const skips = zoneEvents.filter(e => e.type === 'skip_block' || e.type === 'skip_zone').length;
        const pauses = zoneEvents.filter(e => e.type === 'pause').length;
        const totalMin = zoneEvents.filter(e => e.type === 'session_complete').reduce((a, e) => a + (e.duration || 0), 0);
        const completes = zoneEvents.filter(e => e.type === 'zone_complete' && zonesWithTimerToday.has(i)).length;
        const doneNoTimer = zoneEvents.filter(e => e.type === 'zone_complete' && !zonesWithTimerToday.has(e.zoneIdx)).length;
        return { ...z, idx: i, sessions, skips, pauses, totalMin, completes, doneNoTimer };
      });
    } else {
      const zoneStats = state.tracking.zoneStats || {};
      zoneData = zones.map((z, i) => ({
        ...z, idx: i,
        ...(zoneStats[i] || { sessions: 0, skips: 0, pauses: 0, totalMin: 0, completes: 0, doneNoTimer: 0 })
      }));
    }

    // Merge daily zone completion snapshots into dailyMap
    const dz = state.tracking.dailyZones || {};
    Object.keys(dz).forEach(date => {
      if (cutoffDate && date > cutoffDate) return;
      if (!dailyMap[date]) dailyMap[date] = { focusMin: 0, timerMin: 0, sessions: 0, manualDone: 0, skips: 0, events: [] };
      dailyMap[date].zoneCompleted = dz[date].completed;
      dailyMap[date].dayComplete = dz[date].dayComplete;
    });

    // Build month-grouped sorted entries
    const sortedEntries = Object.entries(dailyMap).sort((a, b) => b[0].localeCompare(a[0]));
    const monthGroups = [];
    sortedEntries.forEach(([date, data]) => {
      const m = date.slice(0, 7);
      if (!monthGroups.length || monthGroups[monthGroups.length - 1].month !== m) {
        monthGroups.push({ month: m, label: new Date(m + '-01T00:00:00').toLocaleDateString('en', { year: 'numeric', month: 'long' }), days: [], totalFocus: 0, totalSessions: 0, totalManual: 0, totalSkips: 0 });
      }
      const g = monthGroups[monthGroups.length - 1];
      g.days.push({ date, ...data });
      g.totalFocus += data.focusMin;
      g.totalSessions += data.sessions;
      g.totalManual += data.manualDone;
      g.totalSkips += data.skips;
    });

    return { todayEvents, sessionsToday, manualToday, skipsToday, focusMinToday,
      totalSessions, totalManual, totalFocusMin, dailyMap, streak, zoneData, log, monthGroups };
  }

  // ─── Zone Config ──────────────────────────────
  function getZones() { return state.config?.zones || []; }
  function getZone(idx) { return getZones()[idx] || null; }

  function getBreakDur(zone, cycle) {
    if (!zone) return 5;
    // BUG FIX: the `cycle > 0` guard used to force cycle 0's break to always be
    // short, even when cyclesBeforeLongBreak is 1 (i.e. "long break every
    // cycle"). calcZoneTotal() (used for the editor's "Calculated total"
    // preview) never had that guard, so with cyclesBeforeLongBreak=1 the
    // editor promised a longer zone than the live timer actually ran.
    return ((cycle + 1) % (zone.cyclesBeforeLongBreak || 4) === 0)
      ? zone.longBreakDuration : zone.breakDuration;
  }

  function initZoneState(zone, idx) {
    return {
      blockIdx: 0, remaining: (zone.focusDuration || 25) * 60,
      total: (zone.focusDuration || 25) * 60,
      running: false, completed: false, blockComplete: false, overtimeSeconds: 0,
      blockDone: [],
      cycle: 0, blockType: 'focus',
      elapsed: 0,
      zoneElapsed: 0, // cumulative time spent in this zone across ALL blocks today;
                       // unlike `elapsed`, this does NOT reset on focus<->break transitions.
                       // Used to check z.timeLimit ("Max Time"), which is a whole-zone cap.
      lastTick: null   // wall-clock ms timestamp of the last tick, used to correct for
                        // time that passes while the tab/page is closed or backgrounded.
    };
  }

  function rebuildZoneStates() {
    state.byZone = {};
    getZones().forEach((z, i) => { state.byZone[i] = initZoneState(z, i); });
  }

  function getCurrentZs() { return state.byZone[state.currentZoneIdx]; }

  function cycleTitle(z, i) {
    return (z.cycleTitles && z.cycleTitles[i]) || `Cycle ${i + 1}`;
  }

  // ─── Timer Engine ────────────────────────────
  function stopTimer() { if (state.timerHandle) { clearInterval(state.timerHandle); state.timerHandle = null; } document.title = 'Zone — Study OS'; }

  function timerTick() {
    const zs = getCurrentZs();
    if (!zs || !zs.running) { document.title = 'Zone — Study OS'; return; }
    const now = Date.now();
    const delta = zs.lastTick ? Math.max(1, Math.round((now - zs.lastTick) / 1000)) : 1;
    zs.lastTick = now;

    if (zs.blockComplete) {
      zs.overtimeSeconds = (zs.overtimeSeconds || 0) + delta;
      zs.elapsed = (zs.elapsed || 0) + delta;
      zs.zoneElapsed = (zs.zoneElapsed || 0) + delta;
      const z = getZone(state.currentZoneIdx);
      if (z && z.timeLimit && (zs.zoneElapsed >= z.timeLimit * 60)) {
        stopTimer();
        zs.running = false;
        if (zs.overtimeSeconds > 0) {
          logEvent('overtime', { zoneIdx: state.currentZoneIdx, seconds: zs.overtimeSeconds, cycle: zs.cycle });
          const extraMin = Math.round(zs.overtimeSeconds / 60);
          if (extraMin > 0) {
            state.stats.totalFocusMin += extraMin;
            const key = todayKey();
            if (!state.stats.history[key]) state.stats.history[key] = { focusMin: 0, sessions: 0 };
            state.stats.history[key].focusMin += extraMin;
          }
        }
        toast(`Time limit reached for "${z.title}" — auto-completing`, 'warning');
        completeZone();
        return;
      }
      saveState();
      updateTimerDisplay();
      document.title = `+${fmtTime(zs.overtimeSeconds)} — ${getZone(state.currentZoneIdx)?.title || 'Zone'} — Study OS`;
      return;
    }

    zs.remaining = Math.max(0, zs.remaining - delta);
    zs.elapsed = (zs.elapsed || 0) + delta;
    zs.zoneElapsed = (zs.zoneElapsed || 0) + delta;
    if (zs.remaining <= 0) {
      stopTimer();
      zs.running = false;
      handleBlockComplete();
      return;
    }
    const z = getZone(state.currentZoneIdx);
    if (z && z.timeLimit && (zs.zoneElapsed >= z.timeLimit * 60)) {
      stopTimer();
      zs.running = false;
      if (zs.blockType === 'focus') {
        const actualMin = Math.round(zs.elapsed / 60);
        logEvent('session_complete', { zoneIdx: state.currentZoneIdx, duration: actualMin, cycle: zs.cycle, skipped: false });
        state.stats.totalSessions++;
        state.stats.totalFocusMin += actualMin;
        const key = todayKey();
        if (!state.stats.history[key]) state.stats.history[key] = { focusMin: 0, sessions: 0 };
        state.stats.history[key].focusMin += actualMin;
        state.stats.history[key].sessions++;
      }
      toast(`Time limit reached for "${z.title}" — auto-completing`, 'warning');
      completeZone();
      return;
    }
    if (zs.remaining < 300 && Math.ceil((zs.remaining + delta) / 60) > Math.ceil(zs.remaining / 60)) chime('tick');
    saveState();
    updateTimerDisplay();
    document.title = `${fmtTime(zs.remaining)} — ${z ? z.title : 'Zone'} — Study OS`;
  }

  function timerStart() {
    if (state.dayComplete) return;
    const zs = getCurrentZs();
    if (!zs || zs.completed) return;
    notifRequest();
    zs.running = true;
    zs.lastTick = Date.now();
    logEvent('session_start', { zoneIdx: state.currentZoneIdx, blockType: zs.blockType, cycle: zs.cycle });
    stopTimer();
    state.timerHandle = setInterval(timerTick, 1000);
    chime('transition');
    renderControls();
    renderSidebar();
    updateTimerDisplay();
  }

  function timerPause() {
    const zs = getCurrentZs();
    if (!zs) return;
    zs.running = false;
    logEvent('pause', { zoneIdx: state.currentZoneIdx, remaining: zs.remaining });
    stopTimer();
    renderControls();
    renderSidebar();
  }

  function timerReset() {
    const z = getZone(state.currentZoneIdx);
    const zs = getCurrentZs();
    if (!z || !zs) return;
    if (!confirm(`Reset timer for ${z.title}?`)) return;
    stopTimer();
    zs.running = false;
    zs.blockComplete = false;
    zs.overtimeSeconds = 0;
    zs.elapsed = 0;
    zs.zoneElapsed = 0;
    const dur = zs.blockType === 'focus' ? (z.focusDuration || 25) * 60 : (getBreakDur(z, zs.cycle) * 60);
    zs.remaining = dur;
    zs.total = dur;
    renderAll();
    toast('Timer reset', 'info');
  }

  function timerSkip() {
    const z = getZone(state.currentZoneIdx);
    const zs = getCurrentZs();
    if (!z || !zs) return;
    stopTimer();
    zs.running = false;

    // Log overtime before discarding if skipping during overtime
    if (zs.blockComplete && zs.overtimeSeconds > 0) {
      logEvent('overtime', { zoneIdx: state.currentZoneIdx, seconds: zs.overtimeSeconds, cycle: zs.cycle });
      const extraMin = Math.round(zs.overtimeSeconds / 60);
      if (extraMin > 0) {
        state.stats.totalFocusMin += extraMin;
        const key = todayKey();
        if (!state.stats.history[key]) state.stats.history[key] = { focusMin: 0, sessions: 0 };
        state.stats.history[key].focusMin += extraMin;
      }
    }

    if (zs.blockType === 'focus' && !zs.blockComplete) {
      const partial = Math.round(((z.focusDuration || 25) * 60 - zs.remaining) / 60);
      if (partial >= 1) {
        state.stats.totalFocusMin += partial;
        const key = todayKey();
        if (!state.stats.history[key]) state.stats.history[key] = { focusMin: 0, sessions: 0 };
        state.stats.history[key].focusMin += partial;
      }
      logEvent('skip_block', { zoneIdx: state.currentZoneIdx, blockType: zs.blockType, cycle: zs.cycle, remaining: zs.remaining, duration: partial > 0 ? partial : 0 });
    }
    zs.remaining = 0;
    zs.elapsed = 0;
    zs.blockComplete = false;
    zs.overtimeSeconds = 0;
    if (zs.blockType === 'focus') {
      zs.blockType = 'break';
      const bdur = getBreakDur(z, zs.cycle) * 60;
      zs.remaining = bdur; zs.total = bdur;
      chime('breakstart');
      renderAll();
    } else {
      chime('transition');
      zs.cycle++;
      zs.blockType = 'focus';
      const maxCycles = z.totalCycles || 4;
      if (zs.cycle >= maxCycles) { completeZone(); return; }
      zs.remaining = (z.focusDuration || 25) * 60;
      zs.total = (z.focusDuration || 25) * 60;
      renderAll();
    }
  }

  function takeBreak() {
    const z = getZone(state.currentZoneIdx);
    const zs = getCurrentZs();
    if (!z || !zs) return;

    const overtimeSec = zs.overtimeSeconds || 0;
    if (overtimeSec > 0) {
      logEvent('overtime', { zoneIdx: state.currentZoneIdx, seconds: overtimeSec, cycle: zs.cycle });
      const extraMin = Math.round(overtimeSec / 60);
      if (extraMin > 0) {
        state.stats.totalFocusMin += extraMin;
        const key = todayKey();
        if (!state.stats.history[key]) state.stats.history[key] = { focusMin: 0, sessions: 0 };
        state.stats.history[key].focusMin += extraMin;
      }
    }

    stopTimer();
    zs.running = false;
    zs.blockComplete = false;
    zs.overtimeSeconds = 0;
    zs.blockType = 'break';
    const bdur = getBreakDur(z, zs.cycle) * 60;
    zs.remaining = bdur;
    zs.total = bdur;
    zs.elapsed = 0;
    chime('breakstart');
    saveState();
    renderAll();
    if (state.settings.autoStartBreaks) timerStart();
  }

  function handleBlockComplete(actualMin) {
    const z = getZone(state.currentZoneIdx);
    const zs = getCurrentZs();
    if (!z || !zs) return;
    const wasFocus = zs.blockType === 'focus';
    const fullDur = wasFocus ? (z.focusDuration || 25) : getBreakDur(z, zs.cycle);
    const dur = actualMin !== undefined ? actualMin : fullDur;

    if (wasFocus) {
      logEvent('session_complete', { zoneIdx: state.currentZoneIdx, duration: dur, cycle: zs.cycle, skipped: !!actualMin });
      chime('complete');
      notifSend('Focus Complete!', 'Great work! Take a break.');
      toast('Focus complete! Take a break.', 'success');
      state.stats.totalSessions++;
      state.stats.totalFocusMin += dur;
      const key = todayKey();
      if (!state.stats.history[key]) state.stats.history[key] = { focusMin: 0, sessions: 0 };
      state.stats.history[key].focusMin += dur;
      state.stats.history[key].sessions++;
      saveState();

      if (state.settings.autoStartBreaks) {
        zs.blockType = 'break';
        const bdur = getBreakDur(z, zs.cycle) * 60;
        zs.remaining = bdur;
        zs.total = bdur;
        zs.elapsed = 0;
        chime('breakstart');
        renderAll();
        timerStart();
      } else {
        zs.blockComplete = true;
        zs.overtimeSeconds = 0;
        zs.remaining = 0;
        zs.running = true;
        zs.lastTick = Date.now();
        stopTimer();
        state.timerHandle = setInterval(timerTick, 1000);
        renderAll();
      }
    } else {
      chime('transition');
      notifSend('Break Over!', 'Time to focus again.');
      toast('Break over! Back to work.', 'info');
      zs.cycle++;
      zs.blockType = 'focus';
      const maxCycles = z.totalCycles || 4;
      if (zs.cycle >= maxCycles) {
        completeZone();
        return;
      }
      zs.remaining = (z.focusDuration || 25) * 60;
      zs.total = (z.focusDuration || 25) * 60;
      zs.elapsed = 0;
      renderAll();
      if (state.settings.flowMode) timerStart();
    }
  }

  function completeZone() {
    const z = getZone(state.currentZoneIdx);
    const zs = getCurrentZs();
    logEvent('zone_complete', { zoneIdx: state.currentZoneIdx, zoneName: z?.title });
    if (z) toast(`Zone ${z.title} complete! 🎉`, 'success');
    stopTimer();
    if (zs) { zs.running = false; zs.completed = true; zs.blockComplete = false; zs.overtimeSeconds = 0; }
    saveState();
    if (getZones().every((_, i) => state.byZone[i]?.completed)) { finishDay(); return; }
    const next = state.currentZoneIdx + 1;
    if (next >= getZones().length) { renderAll(); return; }
    confetti();
    notifSend('Zone Complete!', `Zone ${state.currentZoneIdx + 1} finished.`);
    if (!state.byZone[next]) state.byZone[next] = initZoneState(getZone(next), next);
    state.currentZoneIdx = next;
    renderAll();
  }

  function markZoneComplete(idx) {
    if (state.selectedDate) { toast('⏳ Exit time travel mode to mark zones', 'warn'); return; }
    const z = getZone(idx);
    const zs = state.byZone[idx];

    // If completing during overtime, record overtime first
    if (zs && zs.blockComplete && zs.overtimeSeconds > 0) {
      logEvent('overtime', { zoneIdx: idx, seconds: zs.overtimeSeconds, zoneName: z?.title });
      const extraMin = Math.round(zs.overtimeSeconds / 60);
      if (extraMin > 0) {
        state.stats.totalFocusMin += extraMin;
        const key = todayKey();
        if (!state.stats.history[key]) state.stats.history[key] = { focusMin: 0, sessions: 0 };
        state.stats.history[key].focusMin += extraMin;
      }
    }

    const evData = { zoneIdx: idx, zoneName: z?.title };
    state.tracking.log.push({ id: uid(), date: todayKey(), time: new Date().toISOString(), type: 'zone_complete', ...evData });
    // Truncate log if too large (same logic as logEvent)
    if (state.tracking.log.length > 5000) {
      let removeCount = state.tracking.log.length - 3000;
      const cutDate = state.tracking.log[removeCount - 1]?.date;
      while (removeCount < state.tracking.log.length && state.tracking.log[removeCount].date === cutDate) removeCount++;
      archiveOldEvents(state.tracking.log.splice(0, removeCount));
    }
    if (!state.tracking.zoneStats[idx]) state.tracking.zoneStats[idx] = { sessions: 0, skips: 0, pauses: 0, totalMin: 0, completes: 0, doneNoTimer: 0 };
    state.tracking.zoneStats[idx].doneNoTimer++;
    if (z) state.tracking.zoneStats[idx].totalMin += (z.focusDuration || 25);
    const key = todayKey();
    if (!state.stats.history[key]) state.stats.history[key] = { focusMin: 0, sessions: 0 };
    state.stats.totalSessions++;
    state.stats.history[key].sessions++;
    if (z) { const d = z.focusDuration || 25; state.stats.totalFocusMin += d; state.stats.history[key].focusMin += d; }
    saveState();
    if (zs) { zs.running = false; zs.completed = true; zs.blockComplete = false; zs.overtimeSeconds = 0; stopTimer(); }
    if (getZones().every((_, i) => state.byZone[i]?.completed)) { finishDay(); renderAll(); return; }
    const next = idx + 1;
    if (next < getZones().length) {
      if (!state.byZone[next]) state.byZone[next] = initZoneState(getZone(next), next);
      state.currentZoneIdx = next;
    }
    renderAll();
  }

  function finishDay() {
    state.dayComplete = true;
    stopTimer();
    saveState();
    confetti();
    notifSend('Day Complete! 🌟', 'All zones finished!');
    toast('All zones complete! Amazing work! 🌟', 'success', 5000);
    renderAll();
  }

  function resetDay() {
    stopTimer();
    state.currentZoneIdx = 0;
    state.dayComplete = false;
    rebuildZoneStates();
    saveState();
    renderAll();
  }

  function continueDay() {
    const zones = getZones();
    const last = zones[zones.length - 1] || {};
    const nh = (parseInt(last.endTime?.split(':')[0] || '21') + 1) % 24;
    const newZone = {
      title: 'Extra',
      subtitle: 'Additional session',
      type: 'focus',
      color: '#38BDF8',
      startTime: last.endTime || '21:00',
      endTime: String(nh).padStart(2,'0') + ':00',
      focusDuration: 25, breakDuration: 5, longBreakDuration: 15,
      cyclesBeforeLongBreak: 4, totalCycles: 4,
      timeLimit: 180, cycleTitles: []
    };
    zones.push(newZone);
    state.config.zones = zones;
    state.dayComplete = false;
    state.currentZoneIdx = zones.length - 1;
    state.byZone[state.currentZoneIdx] = initZoneState(newZone, state.currentZoneIdx);
    saveConfig();
    saveState();
    renderAll();
  }

  function continueSkippedZone(idx) {
    state.dayComplete = false;
    state.currentZoneIdx = idx;
    const z = getZone(idx);
    if (z) state.byZone[idx] = initZoneState(z, idx);
    saveState();
    renderAll();
  }

  function showContinueOptions() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const zones = getZones();
    const todayLog = state.tracking.log.filter(e => e.date === todayKey());
    let items = '';
    let hasDone = false, hasSkipped = false;
    zones.forEach((z, i) => {
      const zoneCompleteEvent = todayLog.find(e => e.type === 'zone_complete' && e.zoneIdx === i);
      const hadTimerToday = todayLog.some(e => e.type === 'session_complete' && e.zoneIdx === i);
      if (zoneCompleteEvent && hadTimerToday) {
        if (!hasDone) { items += '<div style="font-size:10px;color:var(--accent-lecture);font-family:var(--mono);letter-spacing:1px;margin-bottom:6px">DONE (TIMER)</div>'; hasDone = true; }
        items += `<button class="ctl" style="width:100%;padding:12px;margin-bottom:6px;text-align:left;font-size:13px;border-left:4px solid var(--accent-lecture)" onclick="ZoneApp.continueSkippedZone(${i});this.closest('.modal-overlay').remove()">🏁 ${esc(z.title)} <span style="font-size:10px;color:var(--text-muted)">redo</span></button>`;
      } else if (zoneCompleteEvent) {
        if (!hasDone) { items += '<div style="font-size:10px;color:var(--accent-suc);font-family:var(--mono);letter-spacing:1px;margin-bottom:6px">DONE (MANUAL)</div>'; hasDone = true; }
        items += `<button class="ctl" style="width:100%;padding:12px;margin-bottom:6px;text-align:left;font-size:13px;border-left:4px solid var(--accent-suc)" onclick="ZoneApp.continueSkippedZone(${i});this.closest('.modal-overlay').remove()">✓ ${esc(z.title)} <span style="font-size:10px;color:var(--text-muted)">manual · redo</span></button>`;
      } else {
        if (!hasSkipped) { items += '<div style="font-size:10px;color:var(--accent-solve);font-family:var(--mono);letter-spacing:1px;margin:' + (hasDone ? '14px' : '0') + ' 0 6px 0">SKIPPED</div>'; hasSkipped = true; }
        items += `<button class="ctl" style="width:100%;padding:12px;margin-bottom:6px;text-align:left;font-size:13px;border-left:4px solid var(--accent-solve)" onclick="ZoneApp.continueSkippedZone(${i});this.closest('.modal-overlay').remove()">⏭ ${esc(z.title)} <span style="font-size:10px;color:var(--text-muted)">continue</span></button>`;
      }
    });
    items += `<button class="ctl primary" style="width:100%;padding:12px;margin-top:14px;text-align:left;font-size:13px" onclick="ZoneApp.continueDay();this.closest('.modal-overlay').remove()">+ Add Extra Zone</button>`;
    overlay.innerHTML =
      `<div class="modal" style="max-width:340px"><div class="modal-header"><h3 style="font-size:15px">Continue</h3><button class="close-x" onclick="this.closest('.modal-overlay').remove()">✕</button></div><div class="modal-body" style="gap:6px">${items}</div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  // ─── SET EXAM TRACK ─────────────────────────
  async function setExamTrack(trackId, year) {
    if (!state.tracks) { toast('Exam tracks not loaded yet', 'error'); return; }
    const track = state.tracks.find(t => t.id === trackId);
    if (!track) return;
    const y = year || new Date().getFullYear();
    const goals = {
      JEE: { goal: 'JEE Advanced ' + y, tag: 'Consistency over intensity' },
      NEET: { goal: 'NEET UG ' + y, tag: 'Master the concepts, ace the exam' },
      UPSC: { goal: 'UPSC CSE ' + y, tag: 'Perseverance, patience, preparation' },
      GATE: { goal: 'GATE ' + y, tag: 'Deep understanding wins' },
      CA: { goal: 'CA Exams ' + y, tag: 'Discipline is the bridge' },
      BOARDS: { goal: 'Board Exams ' + y, tag: 'Excellence is a habit' },
      CUSTOM: { goal: 'My Goal ' + y, tag: 'My pace, my path' }
    };
    const info = goals[trackId] || goals.CUSTOM;
    state.examTrack = track.name;
    state.config.identity.examTrack = track.name;
    state.config.identity.goalName = info.goal;
    state.config.identity.tagline = info.tag;
    state.config.identity.targetYear = y;
    const trackZones = track.zones.map((tz, i) => {
      const existing = state.config.zones[i] || {};
      return {
        id: tz.id ?? existing.id ?? i + 1,
        title: tz.title,
        subtitle: tz.subtitle,
        type: existing.type || 'focus',
        focusDuration: existing.focusDuration || 35,
        breakDuration: existing.breakDuration || 10,
        longBreakDuration: existing.longBreakDuration || 20,
        cyclesBeforeLongBreak: existing.cyclesBeforeLongBreak || 5,
        totalCycles: existing.totalCycles || 4,
        startTime: existing.startTime || '',
        endTime: existing.endTime || '',
        color: existing.color || ['#7c3aed','#059669','#d97706','#2563eb','#dc2626'][i % 5],
        timeLimit: existing.timeLimit || 180,
        cycleTitles: existing.cycleTitles || [],
      };
    });
    // Preserve any extra zones beyond the track's default 5
    const extraZones = (state.config.zones || []).slice(track.zones.length);
    state.config.zones = trackZones.concat(extraZones);
    try {
      await apiUpdateConfig(state.config);
    } catch (e) {
      console.warn('setExamTrack: API config save failed', e);
    }
    storage().set('config', state.config);
    state.onboarded = true;
    storage().set('onboarded', true);
    rebuildZoneStates();
    renderAll();
  }

  // ─── RENDER ──────────────────────────────────
  function renderAll() { render(); }

  function render() {
    if (!state.config) return;
    if (!state.onboarded) { renderOnboarding(); return; }
    $root.innerHTML = `
      <header>
        <div>
          <div class="kicker">DAILY DISCIPLINE CONSOLE</div>
          <h1 style="cursor:pointer" onclick="ZoneApp.editTitleInline()" title="Click to edit title">${esc(state.config?.identity?.goalName || 'Zone')} ✏️</h1>
        </div>
        <div class="hdr-right">
          <button class="icon-btn" onclick="ZoneApp.openOnboarding()">🎯 ${state.examTrack ? 'CHANGE TRACK' : 'SET GOAL'}</button>
          <div class="hdr-clock">
            <b class="mono" id="wallclock">--:--:--</b>
            ${state.selectedDate ? `<span class="mono tt-date-badge">${esc(state.selectedDate)}</span>` : (state.config?.identity?.examTrack || 'Ready')}
          </div>
        </div>
      </header>

      <div class="tabs">
        <button class="tab-btn ${state.tab === 'console' ? 'active' : ''}" onclick="ZoneApp.switchTab('console')">CONSOLE</button>
        <button class="tab-btn ${state.tab === 'wallpapers' ? 'active' : ''}" onclick="ZoneApp.switchTab('wallpapers')">WALLPAPERS</button>
        <button class="tab-btn ${state.tab === 'calendar' ? 'active' : ''}" onclick="ZoneApp.switchTab('calendar')">CALENDAR</button>
        <button class="tab-btn ${state.tab === 'stats' ? 'active' : ''}" onclick="ZoneApp.switchTab('stats')">STATS</button>
        <button class="tab-btn ${state.tab === 'exam-timer' ? 'active' : ''}" onclick="ZoneApp.switchTab('exam-timer')">EXAM TIMER</button>
        <button class="tab-btn ${state.tab === 'settings' ? 'active' : ''}" onclick="ZoneApp.switchTab('settings')">SETTINGS</button>
      </div>

      ${state.selectedDate ? `
      <div class="time-travel-banner">
        <span class="tt-icon">⏰</span>
        <span class="tt-text">Viewing <b>${esc(state.selectedDate)}</b> — all data shown for this date</span>
        <button class="tt-back" onclick="ZoneApp.clearTimeTravel()">← Back to Today</button>
      </div>` : ''}

      <div id="tabBody"></div>
      <footer>ZONE · study execution system · v4</footer>`;

    renderTabBody();
    tickClock();
  }

  function switchTab(tab) {
    state.tab = tab;
    if (state._examTimerInterval) { clearInterval(state._examTimerInterval); state._examTimerInterval = null; }
    render();
    if (tab === 'exam-timer') {
      state._examTimerInterval = setInterval(() => {
        if (document.querySelector('.exam-timer-wrap')) tickExamTimers();
        else { clearInterval(state._examTimerInterval); state._examTimerInterval = null; }
      }, 1000);
    }
  }

  function renderTabBody() {
    switch (state.tab) {
      case 'console': renderConsoleTab(); break;
      case 'wallpapers': renderWallpaperTab(); break;
      case 'calendar': renderCalendarTab(); break;
      case 'stats': renderStatsTab(); break;
      case 'exam-timer': renderExamTimerTab(); break;
      case 'settings': renderSettingsTab(); break;
    }
  }

  function renderOnboarding() {
    $root.innerHTML = `
      <header>
        <div>
          <div class="kicker">SETUP · ZONE STUDY OS</div>
          <h1>What are you preparing for?</h1>
        </div>
      </header>
      <div class="track-grid" id="trackGrid"></div>
      <div class="onboarding-skip">
        <button onclick="ZoneApp.skipOnboarding()">Skip — use default zones</button>
      </div>`;
    const grid = document.getElementById('trackGrid');
    (state.tracks || []).forEach(t => {
      const c = document.createElement('button');
      c.className = 'track-card';
      c.innerHTML = `<div class="tc-name">${esc(t.name)}</div>
        <div class="tc-cat">${esc(t.zones?.[0]?.subtitle || '')}</div>
        ${t.zones ? `<div class="tc-subjects">${t.zones.map(z => z.title).join(' · ')}</div>` : ''}`;
      c.addEventListener('click', () => selectExamTrack(t.id));
      grid.appendChild(c);
    });
  }

  function skipOnboarding() {
    state.onboarded = true;
    storage().set('onboarded', true);
    rebuildZoneStates();
    render();
  }

  // ─── CONSOLE TAB ─────────────────────────────
  function renderConsoleTab() {
    const body = document.getElementById('tabBody');
    const zones = getZones();
    if (!zones.length) { body.innerHTML = '<div class="note-bar">No zones configured.</div>'; return; }
    if (state.currentZoneIdx >= zones.length) state.currentZoneIdx = 0;
    const cur = getZone(state.currentZoneIdx);

    // TIME TRAVEL: show day summary for selected date
    if (state.selectedDate) {
      renderTimeTravelView(body, state.selectedDate, zones);
      return;
    }

    if (state.dayComplete) {
      const todayEvents = getTodayLog();
      const focusMin = todayEvents.filter(e => e.type === 'session_complete').reduce((a, e) => a + (e.duration || 0), 0) + todayEvents.filter(e => e.type === 'overtime').reduce((a, e) => a + Math.round((e.seconds || 0) / 60), 0)
        + todayEvents.filter(e => e.type === 'zone_complete').reduce((a, e) => {
          const zonesWithTimer = new Set(todayEvents.filter(ev => ev.type === 'session_complete').map(ev => ev.zoneIdx));
          return zonesWithTimer.has(e.zoneIdx) ? a : a + (getZone(e.zoneIdx)?.focusDuration || 25);
        }, 0);
      const sessions = todayEvents.filter(e => e.type === 'session_complete').length;
      const pauses = todayEvents.filter(e => e.type === 'pause').length;
      const stops = todayEvents.filter(e => e.type === 'stop').length;
      const skips = todayEvents.filter(e => e.type === 'skip_block' || e.type === 'skip_zone').length;

      const zoneStats = state.tracking.zoneStats || {};
      const zoneRows = getZones().map((z, i) => {
        const zs = zoneStats[i] || { sessions: 0, skips: 0, pauses: 0, totalMin: 0, completes: 0, doneNoTimer: 0 };
        let status, icon, cls;
        if (zs.completes > 0) { status = 'Done'; icon = '🏁'; cls = 'done'; }
        else if (zs.doneNoTimer > 0) { status = 'Done (manual)'; icon = '✓'; cls = 'manual'; }
        else { status = 'Skipped'; icon = '⏭'; cls = 'skip'; }
        return `<div class="dc-zone-row ${cls}" onclick="ZoneApp.resetDay();ZoneApp.selectZone(${i})" title="${status}: ${esc(z.title)}">
          <div class="dc-zi">${icon}</div>
          <div class="dc-zb">
            <div class="dc-zt"><span class="dc-zn">${esc(z.title)}</span><span class="dc-zm">${zs.totalMin || 0}m</span></div>
            <div class="dc-zs">${zs.sessions || 0} sess · ${zs.skips || 0} skips · ${zs.pauses || 0} pauses</div>
          </div>
          <div class="dc-arrow">→</div>
        </div>`;
      }).join('');

      const eventIcon = { session_start:'▶', session_complete:'✓', skip_block:'⏭', pause:'⏸', skip_zone:'⏩', zone_complete:'🏁', break:'☕', stop:'⏹', overtime:'⏱' };
      const eventLbl = { session_start:'Started', session_complete:'Complete', skip_block:'Skip block', pause:'Paused', skip_zone:'Skip zone', zone_complete:'Zone done', break:'Break', stop:'Stopped', overtime:'Overtime' };
      const timeline = todayEvents.slice(-200).reverse().map(e => `
        <div class="dc-event" onclick="ZoneApp.showDayDetail('${e.id}')" title="${e.type.replace(/_/g,' ')}${e.duration ? ' · '+e.duration+'min' : ''}${e.seconds ? ' · '+e.seconds+'s' : ''}">
          <span class="dc-ei" style="background:${e.type === 'session_complete' ? 'var(--accent-lecture)' : e.type === 'pause' || e.type === 'stop' ? 'var(--accent-solve)' : e.type === 'overtime' ? 'var(--accent-suc)' : 'var(--bg-3)'}">${eventIcon[e.type] || '•'}</span>
          <span class="dc-et">${new Date(e.time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</span>
          <span class="dc-el">${eventLbl[e.type] || e.type}</span>
          <span class="dc-ez">${e.zoneName || (e.zoneIdx !== undefined ? `Z${e.zoneIdx+1}` : '')}</span>
          ${e.duration ? `<span class="dc-ed">${e.duration}m</span>` : ''}${e.seconds ? `<span class="dc-ed">+${e.seconds}s</span>` : ''}
        </div>`).join('');

      body.innerHTML = `
        <div class="dc-screen">
          <div class="dc-glow"></div>
          <div class="dc-hdr">
            <div class="dc-badge glow">ALL ZONES DONE</div>
            <div class="dc-icon-wrap">
              <div class="dc-icon-pulse"></div>
              <span class="dc-icon">🎯</span>
            </div>
            <h2 class="dc-title">MISSION COMPLETE</h2>
            <p class="dc-sub">${esc(state.config?.identity?.goalName || 'Amazing work')}</p>
          </div>

          <div class="dc-metrics">
            <div class="dc-metric" onclick="ZoneApp.toast('Focus time today: ${Math.round(focusMin)} minutes','info')">
              <span class="dc-metric-num" style="color:var(--accent-lecture)">${Math.round(focusMin)}</span>
              <span class="dc-metric-lbl">FOCUS MIN</span>
              <span class="dc-metric-sub">Total deep work</span>
            </div>
            <div class="dc-metric" onclick="ZoneApp.toast('Completed ${sessions} focus sessions today','info')">
              <span class="dc-metric-num">${sessions}</span>
              <span class="dc-metric-lbl">SESSIONS</span>
              <span class="dc-metric-sub">Blocks finished</span>
            </div>
            <div class="dc-metric" onclick="ZoneApp.toast('Paused ${pauses} times today','info')">
              <span class="dc-metric-num" style="color:var(--accent-break)">${pauses}</span>
              <span class="dc-metric-lbl">PAUSES</span>
              <span class="dc-metric-sub">Breaks taken</span>
            </div>
            <div class="dc-metric" onclick="ZoneApp.toast('${skips+stops} skips/stops today','info')">
              <span class="dc-metric-num" style="color:var(--accent-solve)">${skips+stops}</span>
              <span class="dc-metric-lbl">SKIPS/STOPS</span>
              <span class="dc-metric-sub">Interruptions</span>
            </div>
          </div>

          <div class="dc-section">
            <div class="dc-section-title" onclick="this.nextElementSibling.classList.toggle('dc-collapse')">ZONE BREAKDOWN <span class="dc-toggle">−</span></div>
            <div class="dc-breakdown">${zoneRows}</div>
          </div>

          <div class="dc-section">
            <div class="dc-section-title" onclick="this.nextElementSibling.classList.toggle('dc-collapse')">TIMELINE <span class="dc-toggle">−</span></div>
            <div class="dc-timeline">${timeline || '<div class="dc-empty">No events recorded today</div>'}</div>
          </div>

          <div class="dc-actions">
            <button class="dc-secondary-btn" onclick="ZoneApp.showContinueOptions()">▶ CONTINUE</button>
            <button class="dc-primary-btn" onclick="ZoneApp.resetDay()">↻ NEW DAY</button>
          </div>
        </div>`;
      return;
    }

    const zs = getCurrentZs();
    body.innerHTML = `
      <div class="console-toolbar">
        <div class="ct-left">
          <button class="ct-btn sidebar-toggle" onclick="ZoneApp.toggleSidebar()" title="Toggle sidebar">${state.sidebarOpen ? '☰' : '☰'}</button>
          <span class="ct-label">ZONE ${String(cur.id ?? state.currentZoneIdx + 1).padStart(2,'0')} · ${to12h(cur.startTime)} — ${to12h(cur.endTime)}</span>
        </div>
        <div class="ct-actions">
          <button class="ct-btn fs-toggle" onclick="ZoneApp.toggleFullscreen()" title="Fullscreen">⛶</button>
          <label class="ct-btn">⬆ Import<input type="file" accept=".json,application/json" style="display:none" onchange="ZoneApp.importConfig(this.files[0])"></label>
          <button class="ct-btn" onclick="ZoneApp.exportConfig()">⬇ Export</button>
        </div>
      </div>
      <div class="layout ${state.sidebarOpen ? '' : 'sidebar-collapsed'}">
        <div class="sidebar" id="sidebar"></div>
        <div class="panel" style="--zc:${cur.color}">
          <div class="panel-glow"></div>
          <div class="panel-head">
            <div>
              <div class="kicker mono">${to12h(cur.startTime)} — ${to12h(cur.endTime)}</div>
              <h2>${esc(cur.title)}</h2>
            </div>
            <div class="ph-right">
              <span class="type-badge" style="--badge-c:${zs?.blockType === 'break' ? 'var(--accent-break)' : cur.color}">${esc(zs?.blockType === 'focus' ? 'FOCUS' : 'BREAK')}</span>
              <div class="cycle-dots" id="cycleDots"></div>
            </div>
          </div>
          <div id="timerArea"></div>
          <div class="controls" id="controls"></div>
          <div class="zone-note">${esc(cur.subtitle || '')}</div>
        </div>
      </div>
      <div class="day-progress">
        <div class="dp-header">
          <span class="dp-title">DAY PROGRESS</span>
          <span class="dp-pct mono" id="dpPct">0%</span>
        </div>
        <div class="dp-strip" id="dpStrip"></div>
        <div class="dp-labels" id="dpLabels"></div>
      </div>`;
    renderSidebar();
    renderTimerArea();
    renderControls();
    renderDayProgress();
  }

  function renderTimeTravelView(body, date, zones) {
    const log = state.tracking.log;
    const zoneLookup = (idx) => zones[idx] || { focusDuration: 25 };
    const events = log.filter(e => e.date === date).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const archived = events.length === 0 ? (state.tracking.archivedDaily || {})[date] : null;

    const timerSessions = archived ? archived.sessions : events.filter(e => e.type === 'session_complete').length;
    const zonesWithTimer = new Set(events.filter(e => e.type === 'session_complete').map(e => e.zoneIdx));
    const manualDone = archived ? archived.manualDone : events.filter(e => e.type === 'zone_complete' && !zonesWithTimer.has(e.zoneIdx)).length;
    const totalFocus = archived ? archived.focusMin
      : events.filter(e => e.type === 'session_complete').reduce((a, e) => a + (e.duration || 0), 0)
      + events.filter(e => e.type === 'zone_complete' && !zonesWithTimer.has(e.zoneIdx)).reduce((a, e) => a + (zoneLookup(e.zoneIdx).focusDuration || 25), 0)
      + events.filter(e => e.type === 'overtime').reduce((a, e) => a + Math.round((e.seconds || 0) / 60), 0);
    const sessions = timerSessions + manualDone;
    const skips = archived ? archived.skips : events.filter(e => e.type === 'skip_block' || e.type === 'skip_zone').length;
    const pauses = events.filter(e => e.type === 'pause').length;
    const stops = events.filter(e => e.type === 'stop').length;
    const rate = sessions + skips > 0 ? Math.round((sessions / (sessions + skips)) * 100) : 0;

    const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });

    // Zone rows for sidebar
    const dz = (state.tracking.dailyZones || {})[date];
    const sidebarHtml = zones.map((z, i) => {
      let status = '', dotClass = '';
      if (dz && dz.completed[i]) { status = 'Done'; dotClass = 'done'; }
      else if (events.some(e => e.type === 'zone_complete' && e.zoneIdx === i && zonesWithTimer.has(i))) { status = 'Done'; dotClass = 'done'; }
      else if (events.some(e => e.type === 'zone_complete' && e.zoneIdx === i)) { status = 'Done (manual)'; dotClass = 'done'; }
      else if (events.some(e => (e.type === 'skip_zone' || e.type === 'skip_block') && e.zoneIdx === i)) { status = 'Skipped'; dotClass = 'skip'; }
      const dayLog = events.filter(e => e.zoneIdx === i);
      const mins = dayLog.filter(e => e.type === 'session_complete').reduce((a, e) => a + (e.duration || 0), 0);
      return `<button class="zone-btn" style="--zc:${z.color}">
        <div class="zb-bar" style="background:${z.color}"></div>
        <div class="zb-body">
          <div class="zb-top">
            <span class="zb-id">Z${String(z.id ?? i + 1).padStart(2,'0')}</span>
            <span class="zb-type">${esc(z.type || 'FOCUS')}</span>
            <span class="dot ${dotClass}"></span>
          </div>
          <div class="zb-name">${esc(z.title)}</div>
          <div class="zb-bottom">
            <span class="zb-time">${to12h(z.startTime)} — ${to12h(z.endTime)}</span>
            <span style="font-size:10px;color:var(--text-muted);font-family:var(--mono)">${mins || 0}m · ${status || 'No activity'}</span>
          </div>
        </div>
      </button>`;
    }).join('');

    // Timeline events
    const eventIcon = { session_start:'▶', session_complete:'✓', skip_block:'⏭', pause:'⏸', skip_zone:'⏩', zone_complete:'🏁', break:'☕', stop:'⏹', overtime:'⏱' };
    const eventLbl = { session_start:'Started', session_complete:'Complete', skip_block:'Skip block', pause:'Paused', skip_zone:'Skip zone', zone_complete:'Zone done', break:'Break', stop:'Stopped', overtime:'Overtime' };
    const timeline = events.slice(-50).reverse().map(e => `
      <div class="dc-event">
        <span class="dc-ei" style="background:${e.type === 'session_complete' ? 'var(--accent-lecture)' : e.type === 'pause' || e.type === 'stop' ? 'var(--accent-solve)' : e.type === 'overtime' ? 'var(--accent-suc)' : 'var(--bg-3)'}">${eventIcon[e.type] || '•'}</span>
        <span class="dc-et">${e.time ? new Date(e.time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '--:--'}</span>
        <span class="dc-el">${eventLbl[e.type] || e.type}</span>
        <span class="dc-ez">${e.zoneName || (e.zoneIdx !== undefined ? `Z${e.zoneIdx+1}` : '')}</span>
        ${e.duration ? `<span class="dc-ed">${e.duration}m</span>` : ''}${e.seconds ? `<span class="dc-ed">+${e.seconds}s</span>` : ''}
      </div>`).join('');

    // Calendar events
    const calEvents = getMergedEvents().filter(e => e.date === date);

    // Day progress bars
    const totalZones = zones.length;
    const completedZones = zones.filter((z, i) =>
      (dz && dz.completed[i]) || events.some(e => e.type === 'zone_complete' && e.zoneIdx === i)
    ).length;
    const pct = totalZones > 0 ? Math.round((completedZones / totalZones) * 100) : 0;

    body.innerHTML = `
      <div class="console-toolbar">
        <div class="ct-left">
          <span class="ct-label" style="color:var(--accent-lecture)">⏰ TIME TRAVEL · ${esc(dateLabel)}</span>
        </div>
        <div class="ct-actions">
          <button class="ct-btn" onclick="ZoneApp.clearTimeTravel()" style="color:var(--accent-lecture);font-weight:600">← TODAY</button>
        </div>
      </div>
      <div class="layout ${state.sidebarOpen ? '' : 'sidebar-collapsed'}">
        <div class="sidebar">${sidebarHtml}</div>
        <div class="panel" style="--zc:var(--accent-lecture)">
          <div class="panel-glow"></div>
          <div class="panel-head">
            <div>
              <div class="kicker mono" style="color:var(--accent-lecture)">📅 ${esc(dateLabel)}</div>
              <h2>Day Summary</h2>
            </div>
            <div class="ph-right" style="display:flex;gap:12px;align-items:center">
              <div style="text-align:right">
                <div style="font-size:22px;font-weight:700;color:var(--accent-lecture);font-family:var(--mono)">${Math.round(totalFocus)}m</div>
                <div style="font-size:10px;color:var(--text-muted)">FOCUS</div>
              </div>
            </div>
          </div>
          <div style="padding:0 20px 16px">
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">
              <div style="text-align:center;padding:10px 0;background:var(--bg-2);border-radius:8px">
                <div style="font-size:18px;font-weight:700">${sessions}</div>
                <div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">DONE</div>
              </div>
              <div style="text-align:center;padding:10px 0;background:var(--bg-2);border-radius:8px">
                <div style="font-size:18px;font-weight:700;color:var(--accent-break)">${pauses}</div>
                <div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">PAUSES</div>
              </div>
              <div style="text-align:center;padding:10px 0;background:var(--bg-2);border-radius:8px">
                <div style="font-size:18px;font-weight:700;color:var(--accent-solve)">${skips + stops}</div>
                <div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">SKIPS</div>
              </div>
              <div style="text-align:center;padding:10px 0;background:var(--bg-2);border-radius:8px">
                <div style="font-size:18px;font-weight:700">${rate}%</div>
                <div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">RATE</div>
              </div>
            </div>
            ${calEvents.length > 0 ? `
            <div style="margin-bottom:12px">
              <div style="font-size:10px;color:var(--text-muted);letter-spacing:1px;margin-bottom:6px">CALENDAR EVENTS</div>
              ${calEvents.map(e => `
                <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;margin-bottom:4px;background:var(--bg-2);border-radius:6px;border-left:3px solid ${e.color}">
                  <span style="flex:1;font-size:12px">${esc(e.title)}</span>
                  <span style="font-size:10px;color:var(--text-muted);font-family:var(--mono)">${esc(e.start || '')}${e.end ? '–'+esc(e.end) : ''}</span>
                </div>`).join('')}
            </div>` : ''}
            <div style="font-size:10px;color:var(--text-muted);letter-spacing:1px;margin-bottom:6px">TIMELINE (${events.length} events)</div>
            <div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:2px">
              ${archived ? '<div style="color:var(--text-muted);font-size:12px;padding:12px 0;text-align:center">Archived — only summary available</div>'
                : events.length === 0 ? '<div style="color:var(--text-muted);font-size:12px;padding:12px 0;text-align:center">No activity on this day</div>'
                : timeline}
            </div>
          </div>
        </div>
      </div>
      <div class="day-progress">
        <div class="dp-header">
          <span class="dp-title">DAY PROGRESS</span>
          <span class="dp-pct mono">${pct}%</span>
        </div>
        <div class="dp-strip">
          ${zones.map((z, i) => {
            const done = (dz && dz.completed[i]) || events.some(e => e.type === 'zone_complete' && e.zoneIdx === i);
            return `<div style="flex:1;height:100%;background:${done ? z.color : 'var(--bg-3)'};opacity:${done ? 1 : 0.3};border-radius:2px" title="${esc(z.title)}: ${done ? 'Done' : 'Pending'}"></div>`;
          }).join('')}
        </div>
        <div class="dp-labels">
          ${zones.map((z, i) => {
            const done = (dz && dz.completed[i]) || events.some(e => e.type === 'zone_complete' && e.zoneIdx === i);
            return `<span style="font-size:9px;color:var(--text-muted);text-align:center;flex:1;${done ? 'color:var(--accent-solve)' : ''}">${done ? '✓' : '—'}</span>`;
          }).join('')}
        </div>
      </div>`;
  }

  function renderSidebar() {
    const sb = document.getElementById('sidebar');
    if (!sb) return;
    sb.innerHTML = getZones().map((z, i) => {
      const zs = state.byZone[i];
      const active = i === state.currentZoneIdx;
      const dotClass = zs?.completed ? 'done' : (zs?.running ? 'live' : '');
      let pct = 0;
      if (zs?.completed) pct = 100;
      else if (zs && z.totalCycles) pct = Math.round((zs.cycle / z.totalCycles) * 100);
      return `<button class="zone-btn ${active ? 'active' : ''}" style="--zc:${z.color}" onclick="ZoneApp.selectZone(${i})">
        <div class="zb-bar" style="background:${z.color}"></div>
        <div class="zb-body">
          <div class="zb-top">
            <span class="zb-id">Z${String(z.id ?? i + 1).padStart(2,'0')}</span>
            <span class="zb-type">${esc(z.type || 'FOCUS')}</span>
            <span class="dot ${dotClass}"></span>
          </div>
          <div class="zb-name">${esc(z.title)}</div>
          <div class="zb-bottom">
            <span class="zb-time">${to12h(z.startTime)} — ${to12h(z.endTime)}</span>
            <span class="zb-progress"><i style="width:${pct}%"></i></span>
          </div>
        </div>
      </button>`;
    }).join('');
  }

  function selectZone(idx) {
    if (idx === state.currentZoneIdx) return;
    // BUG FIX: the shared timer interval only ever ticks the CURRENT zone
    // (via getCurrentZs()). Switching away used to leave the old zone's
    // `running` flag stuck at true forever, even though it had silently
    // stopped counting down — misleading UI (still shows "running"/PAUSE
    // button) and no pause event ever logged for it. Explicitly pause it.
    const prevZs = getCurrentZs();
    if (prevZs && prevZs.running) timerPause();
    state.currentZoneIdx = idx;
    renderConsoleTab();
  }

  function ringSVG(fraction, colorVar) {
    const r = 96, c = 2 * Math.PI * r, size = 260, cx = 130, cy = 130;
    const offset = c * (1 - fraction);
    let ticks = '';
    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * 2 * Math.PI;
      const long = i % 5 === 0;
      const rOuter = long ? 126 : 122;
      const rInner = long ? 115 : 120;
      const x1 = cx + rOuter * Math.cos(angle), y1 = cy + rOuter * Math.sin(angle);
      const x2 = cx + rInner * Math.cos(angle), y2 = cy + rInner * Math.sin(angle);
      ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--tick, var(--line))" stroke-width="${long ? 2.5 : 1.5}" stroke-linecap="round"/>`;
    }
    return `<svg width="${size}" height="${size}" viewBox="0 0 260 260">
      <circle cx="${cx}" cy="${cy}" r="96" fill="none" stroke="var(--bg-3)" stroke-width="20"/>
      <circle cx="${cx}" cy="${cy}" r="96" fill="none" stroke="${colorVar}" stroke-width="20"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"
        style="transition:stroke-dashoffset .35s linear"/>
      ${ticks}
    </svg>`;
  }

  function renderTimerArea() {
    const z = getZone(state.currentZoneIdx);
    const zs = getCurrentZs();
    const area = document.getElementById('timerArea');
    if (!area || !z || !zs) return;

    const color = zs.blockType === 'break' ? 'var(--accent-break)' : z.color;
    const total = zs.total || 1;
    const frac = (zs.completed || zs.blockComplete) ? 1 : (total - zs.remaining) / total;
    const cycles = z.totalCycles || 3;

    const dotsEl = document.getElementById('cycleDots');
    if (dotsEl) {
      dotsEl.innerHTML = Array.from({length: cycles}, (_, i) =>
        `<span class="cdot ${i < zs.cycle ? 'filled' : (i === zs.cycle && (zs.blockType === 'focus' || zs.blockComplete) ? 'live' : '')}" style="--zc:${z.color}"></span>`
      ).join('');
    }

    let tlHTML = '';
    for (let i = 0; i < cycles; i++) {
      const isCurFocus = i === zs.cycle && zs.blockType === 'focus' && !zs.completed && !zs.blockComplete;
      const isCurBreak = i === zs.cycle && zs.blockType === 'break' && !zs.completed;
      const focusDone = i < zs.cycle || (i === zs.cycle && zs.blockType === 'break') || (i === zs.cycle && zs.blockComplete);
      const breakDone = i < zs.cycle;
      const focusPct = isCurFocus ? Math.round((1 - zs.remaining / ((z.focusDuration || 25) * 60)) * 100) : (focusDone ? 100 : 0);
      const breakDur = getBreakDur(z, i);

      tlHTML += `<div class="tl-group">
        <div class="tl-block ${isCurFocus ? 'current' : ''} ${focusDone ? 'done' : ''}" style="--zc:${z.color}" onclick="ZoneApp.jumpToCycle(${i})">
          <div class="tlb-head">
            <span class="tlb-name">${cycleTitle(z, i)}</span>
            <span class="tlb-dur">${z.focusDuration || 25}m</span>
          </div>
          <div class="tlb-track"><i style="width:${focusPct}%"></i></div>
          <div class="tlb-status">${focusDone ? '✓' : (isCurFocus ? '▶' : '')}</div>
        </div>`;
      if (i < cycles) {
        const breakClick = i < cycles - 1 ? `onclick="ZoneApp.jumpToCycle(${i+1})"` : '';
        tlHTML += `<div class="tl-block tl-break ${isCurBreak ? 'current' : ''} ${breakDone ? 'done' : ''}" ${breakClick}>
          <div class="tlb-head">
            <span class="tlb-name">Break</span>
            <span class="tlb-dur">${breakDur}m</span>
          </div>
          <div class="tlb-track"><i style="width:${breakDone ? 100 : 0}%"></i></div>
          <div class="tlb-status">${breakDone ? '✓' : (isCurBreak ? '⏸' : '')}</div>
        </div>`;
      }
      tlHTML += `</div>`;
    }

    const ringTime = zs.blockComplete ? '+' + fmtTime(zs.overtimeSeconds || 0) : (zs.completed ? '✓ DONE' : fmtTime(zs.remaining));
    const ringLabel = zs.blockComplete ? 'OVERTIME · ' + (state.settings.autoStartBreaks ? 'auto' : 'TAKE BREAK') : (zs.completed ? 'ZONE COMPLETE' : (zs.blockType === 'focus' ? 'FOCUS' : 'BREAK') + ' · ' + cycleTitle(z, zs.cycle));

    area.innerHTML = `
      <div class="timer-area">
        <div class="ring-section">
          <div class="ring-wrap ${zs.running ? 'running' : ''}" style="--zc:${color}">
            ${ringSVG(frac, color)}
            <div class="ring-center">
              <div class="ring-time mono" style="color:${color}">${ringTime}</div>
              <div class="ring-label">${ringLabel}</div>
            </div>
          </div>
        </div>
        <div class="tl-section">
          <div class="tl-header">
            <span>SEQUENCE</span>
            <span class="tl-hdr-dur">${z.focusDuration || 25}m focus · ${getBreakDur(z, zs.cycle)}m break</span>
          </div>
          <div class="tl-scroll">${tlHTML}</div>
        </div>
      </div>`;
  }

  function renderControls() {
    const zs = getCurrentZs();
    const c = document.getElementById('controls');
    if (!c) return;
    if (zs?.completed) {
      const nextIdx = state.currentZoneIdx + 1;
      c.innerHTML = `
        <button class="ctl" onclick="ZoneApp.resetZone(${state.currentZoneIdx})"><span class="ctl-icon">↺</span> RESET</button>
        ${nextIdx < getZones().length ? `<button class="ctl" onclick="ZoneApp.selectZone(${nextIdx})"><span class="ctl-icon">⏩</span> SKIP</button>` : ''}`;
      return;
    }
    if (zs?.blockComplete) {
      c.innerHTML = `
        <button class="ctl primary big" onclick="ZoneApp.takeBreak()"><span class="ctl-icon">⏸</span> TAKE BREAK</button>
        <button class="ctl" onclick="ZoneApp.timerToggle()"><span class="ctl-icon">⏸</span> PAUSE/RESUME</button>
        <button class="ctl" onclick="ZoneApp.markZoneComplete(${state.currentZoneIdx})"><span class="ctl-icon">✓</span> DONE</button>`;
      return;
    }
    c.innerHTML = `
      <button class="ctl primary big" onclick="ZoneApp.timerToggle()">
        <span class="ctl-icon">${zs?.running ? '⏸' : '▶'}</span>
        ${zs?.running ? 'PAUSE' : 'START'}
        <kbd class="ctl-kbd">SPACE</kbd>
      </button>
      <button class="ctl" onclick="ZoneApp.timerSkip()"><span class="ctl-icon">⏭</span> SKIP</button>
      <button class="ctl" onclick="ZoneApp.timerReset()"><span class="ctl-icon">↺</span> RESET</button>
      <button class="ctl" onclick="ZoneApp.markZoneComplete(${state.currentZoneIdx})"><span class="ctl-icon">✓</span> DONE</button>`;
  }

  function timerToggle() {
    if (state.selectedDate) { toast('⏳ Timer paused — exit time travel mode first', 'warn'); return; }
    const zs = getCurrentZs();
    if (zs?.running) timerPause();
    else timerStart();
  }

  function jumpToCycle(cycle) {
    const z = getZone(state.currentZoneIdx);
    const zs = getCurrentZs();
    if (!z || !zs) return;
    if (zs.cycle === cycle && zs.blockType === 'focus') return;
    if (!confirm(`Jump to ${cycleTitle(z, cycle)}? Current progress will be lost.`)) return;
    zs.cycle = Math.min(cycle, (z.totalCycles || 4) - 1);
    zs.blockType = 'focus';
    zs.blockComplete = false;
    zs.overtimeSeconds = 0;
    zs.remaining = (z.focusDuration || 25) * 60;
    zs.total = (z.focusDuration || 25) * 60;
    zs.elapsed = 0;
    zs.zoneElapsed = 0;
    zs.lastTick = Date.now();   // prevent stale delta on next tick
    if (!zs.running) stopTimer();
    renderAll();
  }

  function resetZone(idx) {
    const z = getZone(idx);
    const zs = state.byZone[idx];
    if (!z || !zs) return;
    if (!confirm(`Reset today's progress for "${z.title}"?`)) return;
    logEvent('stop', { zoneIdx: idx, zoneName: z.title });
    stopTimer();

    // Roll back stats for this zone
    const today = todayKey();
    const dur = z.focusDuration || 25;
    const zoneEvents = state.tracking.log.filter(e => e.zoneIdx === idx && e.date === today);
    const hadTimerToday = zoneEvents.some(e => e.type === 'session_complete');
    const zst = state.tracking.zoneStats[idx];
    zoneEvents.forEach(e => {
      if (e.type === 'session_start') {
        state.tracking.sessionCount = Math.max(0, state.tracking.sessionCount - 1);
      }
      if (e.type === 'session_complete') {
        state.stats.totalSessions = Math.max(0, state.stats.totalSessions - 1);
        const d = e.duration || dur;
        state.stats.totalFocusMin = Math.max(0, state.stats.totalFocusMin - d);
        if (state.stats.history[today]) {
          state.stats.history[today].sessions = Math.max(0, (state.stats.history[today].sessions || 0) - 1);
          state.stats.history[today].focusMin = Math.max(0, (state.stats.history[today].focusMin || 0) - d);
        }
        if (zst) {
          zst.sessions = Math.max(0, zst.sessions - 1);
          zst.totalMin = Math.max(0, zst.totalMin - d);
        }
      }
      if (e.type === 'zone_complete') {
        state.stats.totalSessions = Math.max(0, state.stats.totalSessions - 1);
        state.stats.totalFocusMin = Math.max(0, state.stats.totalFocusMin - dur);
        if (state.stats.history[today]) {
          state.stats.history[today].sessions = Math.max(0, (state.stats.history[today].sessions || 0) - 1);
          state.stats.history[today].focusMin = Math.max(0, (state.stats.history[today].focusMin || 0) - dur);
        }
        if (zst) {
          if (hadTimerToday) zst.completes = Math.max(0, zst.completes - 1);
          else zst.doneNoTimer = Math.max(0, zst.doneNoTimer - 1);
        }
      }
      if ((e.type === 'skip_block' || e.type === 'skip_zone') && zst) {
        zst.skips = Math.max(0, zst.skips - 1);
      }
      if (e.type === 'pause' && zst) {
        zst.pauses = Math.max(0, (zst.pauses || 0) - 1);
      }
      if (e.type === 'skip_block' && e.blockType === 'focus') {
        const partial = Math.round((((z?.focusDuration || 25) * 60) - (e.remaining || 0)) / 60);
        if (partial >= 1) {
          state.stats.totalFocusMin = Math.max(0, state.stats.totalFocusMin - partial);
          if (state.stats.history[today]) {
            state.stats.history[today].focusMin = Math.max(0, (state.stats.history[today].focusMin || partial) - partial);
          }
        }
      }
      if (e.type === 'overtime') {
        const rollMin = Math.max(1, Math.round((e.seconds || 0) / 60));
        state.stats.totalFocusMin = Math.max(0, state.stats.totalFocusMin - rollMin);
        if (state.stats.history[today]) {
          state.stats.history[today].focusMin = Math.max(0, (state.stats.history[today].focusMin || rollMin) - rollMin);
        }
      }
    });
    state.tracking.log = state.tracking.log.filter(e => !(e.zoneIdx === idx && e.date === today));

    // BUG FIX: this used to call rebuildZoneStatsFromLog(idx), which recomputed
    // zoneStats[idx] purely from state.tracking.log. That's lossy once old
    // events have been archived out of the raw log (see logEvent's trim) —
    // it would silently drop every archived day's contribution for this zone,
    // shrinking its all-time totals. Precise decrementing above (only for the
    // entries actually being removed) fixes this without needing to know
    // anything about history that's no longer in the live log.

    // Reset timer state
    zs.running = false;
    zs.completed = false;
    zs.blockComplete = false;
    zs.overtimeSeconds = 0;
    zs.cycle = 0;
    zs.blockType = 'focus';
    zs.remaining = dur * 60;
    zs.total = dur * 60;
    zs.elapsed = 0;
    zs.zoneElapsed = 0;
    zs.lastTick = null;
    if (state.dayComplete) state.dayComplete = false;
    saveState();
    renderAll();
    toast('Zone reset — stats rolled back', 'info');
  }

  function renderDayProgress() {
    const strip = document.getElementById('dpStrip');
    if (!strip) return;
    const zones = getZones();
    let totalPct = 0;
    strip.innerHTML = zones.map((z, i) => {
      const zs = state.byZone[i];
      let pct = 0;
      if (zs?.completed) pct = 100;
      else if (zs && z.totalCycles) pct = Math.round((zs.cycle / z.totalCycles) * 100);
      totalPct += pct / zones.length;
      return `<div class="dp-seg" onclick="ZoneApp.selectZone(${i})" title="${esc(z.title)}"><i style="width:${pct}%;background:${z.color}"></i></div>`;
    }).join('');
    const pctEl = document.getElementById('dpPct');
    if (pctEl) pctEl.textContent = Math.round(totalPct) + '%';
    const lbl = document.getElementById('dpLabels');
    if (lbl) lbl.innerHTML = zones.map((z, i) => `<span style="color:${state.currentZoneIdx === i ? z.color : ''}" onclick="ZoneApp.selectZone(${i})">${esc(z.title)}</span>`).join('');
  }

  let _tickRenderCount = 0;
  function updateTimerDisplay() {
    const zs = getCurrentZs();
    if (!zs) return;
    renderTimerArea();
    renderControls();
    renderDayProgress();
    // Sidebar only needs rebuilding when state changes, not every tick (~every 10s)
    _tickRenderCount++;
    if (_tickRenderCount % 10 === 0) renderSidebar();
  }

  function tickClock() {
    const el = document.getElementById('wallclock');
    if (el) el.textContent = new Date().toLocaleTimeString();
  }

  // ─── ONBOARDING MODAL ────────────────────────
  function openOnboarding() {
    const presets = [
      { id: 'JEE', name: 'JEE Main & Advanced', cat: 'ENGINEERING', subs: ['Physics', 'Chemistry', 'Mathematics'] },
      { id: 'NEET', name: 'NEET UG', cat: 'MEDICAL', subs: ['Physics', 'Chemistry', 'Biology'] },
      { id: 'UPSC', name: 'UPSC CSE', cat: 'CIVIL SERVICES', subs: ['GS', 'Optional', 'CSAT'] },
      { id: 'GATE', name: 'GATE', cat: 'ENGINEERING PG', subs: ['Core Subject', 'General Aptitude'] },
      { id: 'CA', name: 'CA Exams', cat: 'COMMERCE', subs: ['Accounts', 'Law', 'Tax'] },
      { id: 'BOARDS', name: 'Board Exams', cat: 'SCHOOL', subs: ['Science', 'Maths', 'Languages'] },
      { id: 'CUSTOM', name: 'Custom Track', cat: 'OTHER', subs: ['Your subjects here'] }
    ];
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.id = 'onboardOv';
    ov.innerHTML = `
      <div class="modal">
        <div class="modal-header"><h3>🎯 What are you preparing for?</h3><button class="close-x" onclick="ZoneApp.closeModal('onboardOv')">✕</button></div>
        <div class="modal-body">
          <div class="track-grid">
            ${presets.map(p => `<button class="track-card" onclick="ZoneApp.selectExamTrack('${p.id}')">
              <div class="tc-name">${p.name}</div>
              <div class="tc-cat">${p.cat}</div>
              <div class="tc-subjects">${p.subs.join(' · ')}</div>
            </button>`).join('')}
          </div>
          <div class="onboarding-skip"><button onclick="ZoneApp.closeModal('onboardOv')">Close</button></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  }

  function selectExamTrack(id) {
    closeModal('onboardOv');
    const preset = {
      JEE: 'JEE Advanced',
      NEET: 'NEET UG',
      UPSC: 'UPSC CSE',
      GATE: 'GATE',
      CA: 'CA Exams',
      BOARDS: 'Board Exams',
      CUSTOM: 'My Goal'
    };
    const label = preset[id] || id;
    const yr = new Date().getFullYear();
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.id = 'yearOv';
    ov.innerHTML = `
      <div class="modal" style="max-width:300px">
        <div class="modal-header"><h3>${label} — Year</h3></div>
        <div class="modal-body" style="gap:12px">
          <p style="font-size:13px;color:var(--text-muted);margin:0">Which year are you targeting?</p>
          <input type="number" id="targetYear" value="${yr}" min="${yr}" max="${yr+10}" style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--bg-3);color:var(--text);font-size:16px;text-align:center;outline:none">
          <button class="ctl primary" style="width:100%" onclick="ZoneApp.confirmExamTrack('${id}')">Set Target</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    setTimeout(() => document.getElementById('targetYear')?.focus(), 100);
  }

  function confirmExamTrack(id) {
    const year = document.getElementById('targetYear')?.value || new Date().getFullYear();
    closeModal('yearOv');
    setExamTrack(id, year);
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  // ─── CALENDAR ────────────────────────────────
  let calMonth = new Date().getMonth();
  let calYear = new Date().getFullYear();

  function renderCalendarTab() {
    const body = document.getElementById('tabBody');
    const now = new Date();
    const year = calYear, month = calMonth;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const mName = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' });
    const labels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const allMergedEvents = getMergedEvents();
    const totalEvents = allMergedEvents.length;

    let cells = labels.map(d => `<div class="cal-day-label">${d}</div>`).join('');
    for (let i = 0; i < firstDay; i++) cells += '<div></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = d === now.getDate() && month === now.getMonth() && year === now.getFullYear();
      const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayEvents = allMergedEvents.filter(e => e.date === dateStr);
      const nEvents = dayEvents.length;
      const isSelected = dateStr === state.selectedDate;
      cells += `<div class="cal-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" onclick="ZoneApp.setCalDate('${dateStr}')" title="${nEvents} event${nEvents !== 1 ? 's' : ''}">
        <span class="cal-num">${d}</span>
        ${nEvents > 0 ? `<span class="cal-dot-count">${nEvents > 9 ? '9+' : nEvents}</span>` : ''}
        ${nEvents > 0 ? `<div class="cal-dots">${dayEvents.slice(0, 3).map(e => `<span style="background:${e.color}"></span>`).join('')}</div>` : ''}
      </div>`;
    }

    const activeDate = state.selectedDate || todayKey();
    const todayEvents = allMergedEvents.filter(e => e.date === activeDate);
    const dateLabel = state.selectedDate
      ? new Date(state.selectedDate + 'T00:00:00').toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : 'Today';

    body.innerHTML = `
      <div class="cal-wrap" style="display:flex;flex-direction:column;gap:16px;padding:8px 0;">
        <div class="cal-header">
          <h2>📅 Calendar</h2>
          <div class="cal-actions">
            <button class="ctl" onclick="ZoneApp.calToday()" style="padding:6px 14px;font-size:11px">Today</button>
            <button class="ctl primary" onclick="ZoneApp.showAddEvent()" style="padding:6px 14px;font-size:11px">+ Event</button>
            <button class="ctl" onclick="ZoneApp.exportEvents()" style="padding:6px 12px;font-size:11px">⬇ Export</button>
            <label class="ctl" style="padding:6px 12px;font-size:11px;cursor:pointer">⬆ Import<input type="file" accept=".json,application/json" style="display:none" onchange="ZoneApp.importEvents(this.files[0])"></label>
          </div>
        </div>

        <div class="cal-panel">
          <div class="cal-nav">
            <div class="cal-nav-left">
              <button class="cal-nav-btn" onclick="ZoneApp.calPrev()">◀</button>
              <span class="cal-month-label">${mName}</span>
              <button class="cal-nav-btn" onclick="ZoneApp.calNext()">▶</button>
            </div>
            <div class="cal-nav-right">${totalEvents} event${totalEvents !== 1 ? 's' : ''}</div>
          </div>
          <div class="cal-grid">${cells}</div>
        </div>

        <div class="cal-events-panel">
          <div class="cal-events-header">
            <span>📅 ${dateLabel}</span>
            <button class="cal-add-btn" onclick="ZoneApp.showAddEvent('${state.selectedDate || todayKey()}')">+ ADD</button>
          </div>
          <div id="calTodayEvents">
            ${todayEvents.length === 0
              ? '<div class="cal-empty">Tap a date on the calendar to add or view events</div>'
              : todayEvents.map(e => `<div class="cal-event-row ${e.default ? 'cal-default' : ''}" onclick="${e.default ? '' : `ZoneApp.showEditEvent('${jsEsc(e.id)}')`}">
                  <div class="cal-event-bar" style="background:${e.color}"></div>
                  <span class="cal-event-time">${esc(e.start || '──')}${e.end ? '–' + esc(e.end) : ''}</span>
                  <span class="cal-event-title">${esc(e.title)}${e.notes ? ` <span style="font-size:9px;color:var(--text-muted);font-family:var(--mono)">(${esc(e.notes)})</span>` : ''}</span>
                  <span class="cal-event-type">${e.type}</span>
                  ${e.default ? '<span style="font-size:9px;color:var(--text-muted);font-family:var(--mono)">DEFAULT</span>'
                    : `<button class="btn-mini" onclick="event.stopPropagation();ZoneApp.deleteEvent('${jsEsc(e.id)}')" style="width:24px;height:24px;font-size:11px;flex-shrink:0">✕</button>`}
                </div>`).join('')}
          </div>
        </div>
      </div>`;
  }

  function calPrev() { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendarTab(); }
  function calNext() { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendarTab(); }
  function calToday() { state.selectedDate = null; calMonth = new Date().getMonth(); calYear = new Date().getFullYear(); render(); }
  function setCalDate(dateStr) {
    state.selectedDate = dateStr;
    const d = new Date(dateStr + 'T00:00:00');
    calMonth = d.getMonth();
    calYear = d.getFullYear();
    render();
  }
  function clearTimeTravel() { state.selectedDate = null; render(); }

  function showDayMenu(dateStr) {
    const dayEvents = getMergedEvents().filter(e => e.date === dateStr);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'dayMenu';
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px">
        <div class="modal-header">
          <h3>📅 ${dateStr}</h3>
          <button class="close-x" onclick="this.closest('.modal-overlay').remove()">✕</button>
        </div>
        <div class="modal-body" style="gap:10px">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="ctl primary" onclick="ZoneApp.closeAndAddEvent('${dateStr}')" style="padding:8px 16px;font-size:12px;flex:1">+ Add Event</button>
          </div>
          ${dayEvents.length > 0 ? `
            <div style="font-size:12px;color:var(--text-muted);font-family:var(--mono);letter-spacing:1px">${dayEvents.length} EVENT${dayEvents.length !== 1 ? 'S' : ''}</div>
            ${dayEvents.map(e => `
              <div class="cal-event-row ${e.default ? 'cal-default' : ''}" style="cursor:pointer;padding:10px 12px;background:var(--bg-2);border-radius:8px;${e.default ? 'opacity:0.85' : ''}" onclick="${e.default ? '' : `ZoneApp.closeAndEditEvent('${jsEsc(e.id)}')`}">
                <div class="cal-event-bar" style="background:${e.color}"></div>
                <span class="cal-event-time">${esc(e.start || '──')}${e.end ? '–' + esc(e.end) : ''}</span>
                <div style="flex:1"><span class="cal-event-title">${esc(e.title)}</span><br><span style="font-size:10px;color:var(--text-muted)">${e.default ? '· Default · ' : ''}${e.type}${e.notes ? ' · ' + esc(e.notes) : ''}</span></div>
                ${e.default ? '' : `<button class="btn-mini" onclick="event.stopPropagation();ZoneApp.deleteEvent('${jsEsc(e.id)}');this.closest('.modal-overlay').querySelector('.close-x').click()" style="width:24px;height:24px;font-size:11px">✕</button>`}
              </div>`).join('')}
          ` : '<div style="color:var(--text-muted);font-size:13px;padding:8px 0;text-align:center">No events on this day</div>'}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  function closeAndAddEvent(date) { closeModal('dayMenu'); showAddEvent(date); }
  function closeAndEditEvent(id) { closeModal('dayMenu'); showEditEvent(id); }

  // ─── EVENTS CRUD ──────────────────────────────
  function showAddEvent(prefillDate) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><h3>+ Add Event</h3><button class="close-x" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
        <div class="modal-body">
          <div><span class="field-label">Title</span><input type="text" id="ev-title" placeholder="e.g. Physics coaching" autofocus></div>
          <div class="field-row">
            <div><span class="field-label">Date</span><input type="date" id="ev-date" value="${prefillDate || localDateKey()}"></div>
            <div><span class="field-label">Start</span><input type="time" id="ev-start" value="${new Date().toTimeString().slice(0,5)}"></div>
            <div><span class="field-label">End</span><input type="time" id="ev-end" value="${new Date(Date.now() + 3600000).toTimeString().slice(0,5)}"></div>
          </div>
          <div><span class="field-label">Type</span>
            <select id="ev-type">
              <option value="lecture">Lecture</option><option value="test">Test</option><option value="coaching">Coaching</option>
              <option value="break">Break</option><option value="meal">Meal</option><option value="personal">Personal</option>
              <option value="travel">Travel</option><option value="meeting">Meeting</option>
            </select>
          </div>
          <div><span class="field-label">Notes</span><input type="text" id="ev-notes" placeholder="Optional details"></div>
        </div>
        <div class="modal-footer" style="justify-content:flex-end">
          <button class="ctl" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
          <button class="ctl primary" onclick="ZoneApp.saveEvent(this)">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    setTimeout(() => overlay.querySelector('#ev-title')?.focus(), 100);
  }

  function saveEvent(btn) {
    const ov = btn.closest('.modal-overlay');
    const title = ov.querySelector('#ev-title').value.trim();
    if (!title) { toast('Please enter a title', 'warning'); return; }
    const dateVal = ov.querySelector('#ev-date').value;
    if (!dateVal) { toast('Please select a date', 'warning'); return; }
    const colors = { lecture: '#38BDF8', test: '#F26B6B', coaching: '#FBBF24', break: '#34D399', meal: '#A78BFA', personal: '#F472B6', travel: '#FB923C', meeting: '#A78BFA' };
    const type = ov.querySelector('#ev-type').value;
    if (!Array.isArray(state.events)) state.events = [];
    state.events.push({
      id: uid(), title, date: dateVal,
      start: ov.querySelector('#ev-start').value, end: ov.querySelector('#ev-end').value,
      type, color: colors[type] || '#38BDF8',
      notes: ov.querySelector('#ev-notes')?.value?.trim() || ''
    });
    saveState();
    ov.remove();
    toast('Event added!', 'success');
    renderCalendarTab();
  }

  function showEditEvent(id) {
    if (id && id.startsWith('default-')) { toast('Default events cannot be edited', 'info'); return; }
    const ev = state.events.find(e => e.id === id);
    if (!ev) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><h3>✏ Edit Event</h3><button class="close-x" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
        <div class="modal-body">
          <div><span class="field-label">Title</span><input type="text" id="ev-edit-title" value="${esc(ev.title)}"></div>
          <div class="field-row">
            <div><span class="field-label">Date</span><input type="date" id="ev-edit-date" value="${ev.date}"></div>
            <div><span class="field-label">Start</span><input type="time" id="ev-edit-start" value="${ev.start}"></div>
            <div><span class="field-label">End</span><input type="time" id="ev-edit-end" value="${ev.end}"></div>
          </div>
          <div><span class="field-label">Type</span>
            <select id="ev-edit-type">
              ${['lecture','test','coaching','break','meal','personal','travel','meeting'].map(t =>
                `<option value="${t}" ${ev.type === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`
              ).join('')}
            </select>
          </div>
          <div><span class="field-label">Notes</span><input type="text" id="ev-edit-notes" value="${esc(ev.notes || '')}"></div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <button class="ctl" style="color:var(--danger);border-color:rgba(242,107,107,0.3)" onclick="ZoneApp.deleteEvent('${jsEsc(ev.id)}');this.closest('.modal-overlay').remove()">🗑 Delete</button>
          <div style="display:flex;gap:8px">
            <button class="ctl" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            <button class="ctl primary" onclick="ZoneApp.updateEvent('${jsEsc(ev.id)}', this)">Save Changes</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }

  function updateEvent(id, btn) {
    const ov = btn.closest('.modal-overlay');
    const ev = state.events.find(e => e.id === id);
    if (!ev) return;
    const title = ov.querySelector('#ev-edit-title').value.trim();
    if (!title) { toast('Title cannot be empty', 'warning'); return; }
    const dateVal = ov.querySelector('#ev-edit-date').value;
    if (!dateVal) { toast('Please select a date', 'warning'); return; }
    const colors = { lecture: '#38BDF8', test: '#F26B6B', coaching: '#FBBF24', break: '#34D399', meal: '#A78BFA', personal: '#F472B6', travel: '#FB923C', meeting: '#A78BFA' };
    const type = ov.querySelector('#ev-edit-type').value;
    ev.title = title;
    ev.date = dateVal;
    ev.start = ov.querySelector('#ev-edit-start').value;
    ev.end = ov.querySelector('#ev-edit-end').value;
    ev.type = type;
    ev.color = colors[type] || '#38BDF8';
    ev.notes = ov.querySelector('#ev-edit-notes')?.value?.trim() || '';
    saveState();
    ov.remove();
    toast('Event updated!', 'success');
    renderCalendarTab();
  }

  function deleteEvent(id) {
    if (id && id.startsWith('default-')) { toast('Default events cannot be deleted', 'info'); return; }
    if (!confirm('Delete this event?')) return;
    state.events = state.events.filter(e => e.id !== id);
    saveState();
    renderCalendarTab();
    toast('Event deleted', 'info');
  }

  function exportEvents() {
    const data = { version: 1, exportedAt: new Date().toISOString(), events: state.events };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `zone-events-${todayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Events exported!', 'success');
  }

  function importEvents(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = parseImportedJSON(reader.result);
        const events = data.events || data;
        if (!Array.isArray(events) || events.length === 0) { toast('No events found in file', 'error'); return; }
        // Only import events that have both title AND date — reject ghosts
        const valid = events.filter(e => e.title && e.date);
        if (valid.length === 0) { toast('Invalid event data', 'error'); return; }
        valid.forEach(e => {
          e.id = uid();
          if (!e.color) e.color = '#38BDF8';
        });
        if (!Array.isArray(state.events)) state.events = [];
        state.events = [...state.events, ...valid];
        saveState();
        renderCalendarTab();
        toast(`Imported ${valid.length} events!`, 'success');
      } catch (e) { toast('Invalid JSON file', 'error'); }
    };
    reader.readAsText(file);
  }

  // ─── STATS TAB ──────────────────────────────
  let chartInstances = {};

  function destroyCharts() {
    Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch {} });
    chartInstances = {};
  }

  function renderStatsTab() {
    const body = document.getElementById('tabBody');
    destroyCharts();

    const ts = getTrackingStats(state.selectedDate);
    const totalFocus = ts.totalFocusMin;
    const totalSessions = ts.totalSessions;
    const totalManual = ts.totalManual;
    const sessionsToday = ts.sessionsToday;
    const manualToday = ts.manualToday;
    const skipsToday = ts.skipsToday;
    const focusToday = ts.focusMinToday;
    const streak = ts.streak;

    const allSessionsTotal = totalSessions + totalManual;
    const avgSession = allSessionsTotal > 0 ? Math.round(totalFocus / allSessionsTotal) : 0;
    const allTodaySessions = sessionsToday + manualToday;
    const completionRate = allTodaySessions + skipsToday > 0
      ? Math.round((allTodaySessions / (allTodaySessions + skipsToday)) * 100) : 0;

    const today = todayKey();
    const todayEvents = ts.todayEvents.slice(-20).reverse();

    // Weekly grid
    const weeklyData = [];
    const now = state.selectedDate ? new Date(state.selectedDate + 'T23:59:59') : new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = localDateKey(d);
      const dayData = ts.dailyMap[key];
      const min = dayData?.focusMin || 0;
      const isToday = key === today;
      const cls = isToday ? 'today' : (min === 0 ? '' : (min < 30 ? 'low' : (min < 60 ? 'med' : (min < 120 ? 'high' : 'peak'))));
      const label = d.toLocaleDateString('en', { weekday: 'short' }).slice(0, 2);
      weeklyData.push({ key, min, cls, label, isToday });
    }

    body.innerHTML = `
      <div class="stats-dash">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <h2 style="font-size:20px;font-weight:700">📊 Analytics Dashboard</h2>
          <div style="display:flex;gap:8px">
            <button class="ctl" onclick="ZoneApp.refreshCharts()" style="padding:6px 14px;font-size:11px">🔄 Refresh</button>
          </div>
        </div>

        <div class="stats-grid-4">
          <div class="stat-card-s highlight" onclick="ZoneApp.scrollToChart('focusChart')">
            <div class="num">${sessionsToday}</div>
            <div class="lbl">${state.selectedDate ? 'DATE SESSIONS' : 'TODAY SESSIONS'}</div>
          </div>
          <div class="stat-card-s">
            <div class="num">${manualToday}</div>
            <div class="lbl">${state.selectedDate ? 'DATE MANUAL' : 'MANUAL DONE'}</div>
          </div>
          <div class="stat-card-s" onclick="ZoneApp.scrollToChart('focusChart')">
            <div class="num">${focusToday}</div>
            <div class="lbl">${state.selectedDate ? 'DATE FOCUS' : 'TODAY FOCUS'}</div>
          </div>
          <div class="stat-card-s ${skipsToday > 2 ? 'warn' : ''}">
            <div class="num">${skipsToday}</div>
            <div class="lbl">${state.selectedDate ? 'DATE SKIPS' : 'SKIPS TODAY'}</div>
          </div>
        </div>

        <div class="stats-grid-4">
          <div class="stat-card-s highlight">
            <div class="num">${totalSessions + totalManual}</div>
            <div class="lbl">ALL SESSIONS</div>
          </div>
          <div class="stat-card-s">
            <div class="num">${(totalFocus / 60).toFixed(1)}h</div>
            <div class="lbl">TOTAL FOCUS</div>
          </div>
          <div class="stat-card-s">
            <div class="num">${avgSession}</div>
            <div class="lbl">AVG SESSION</div>
          </div>
          <div class="stat-card-s">
            <div class="num">${completionRate}%</div>
            <div class="lbl">COMPLETION</div>
          </div>
        </div>

        <div class="chart-panel" id="focusChart">
          <div class="chart-title">Daily Focus Minutes — Last 14 Days</div>
          <div class="chart-container"><canvas id="focusLineChart"></canvas></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="chart-panel">
            <div class="chart-title">Zone Distribution</div>
            <div class="chart-container tall"><canvas id="zoneDoughnutChart"></canvas></div>
          </div>
          <div class="chart-panel">
            <div class="chart-title">Completion vs Skips (Today)</div>
            <div class="chart-container"><canvas id="completionChart"></canvas></div>
          </div>
        </div>

        <div class="chart-panel">
          <div class="chart-title">This Week</div>
          <div class="weekly-grid">
            ${weeklyData.map(w => `
              <div class="weekly-cell ${w.cls}" title="${w.key}: ${w.min}min">
                <span class="day">${w.label}</span>
                <span class="val">${w.min}</span>
              </div>`).join('')}
          </div>
        </div>

        <div class="chart-panel">
          <div class="chart-title">Daily Progress</div>
          <div class="daily-table-wrap">
            <table class="daily-table">
              <thead><tr>
                <th>Date</th>
                <th>Focus</th>
                <th>Timer</th>
                <th>Manual</th>
                <th>Skips</th>
                <th>Rate</th>
                <th>Zones</th>
              </tr></thead>
              <tbody>
                ${ts.monthGroups.map(g => `
                  <tr class="month-row"><td colspan="7">${esc(g.label)} <span class="month-total">${g.totalFocus}m · ${g.totalSessions} timer · ${g.totalManual} manual · ${g.totalSkips} skips</span></td></tr>
                  ${g.days.map(d => {
                    const totalDone = d.sessions + d.manualDone;
                    const total = totalDone + d.skips;
                    const rate = total > 0 ? Math.round((totalDone / total) * 100) + '%' : '—';
                    const dateObj = new Date(d.date + 'T00:00:00');
                    const label = dateObj.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
                    const isToday = d.date === todayKey();
                    const minBar = Math.min(d.focusMin, 200);
                    const zoneDots = d.zoneCompleted ? d.zoneCompleted.map((c, zi) => {
                      const zColor = ts.zoneData[zi]?.color || '#666';
                      return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c ? zColor : '#333'};margin:0 1px;opacity:${c ? 1 : 0.3}" title="${esc(ts.zoneData[zi]?.title || 'Zone ' + (zi+1))}: ${c ? 'Done' : '—'}"></span>`;
                    }).join('') : '—';
                    return `<tr class="${isToday ? 'today-row' : ''}" onclick="ZoneApp.showDayReport('${d.date}')" style="cursor:pointer">
                      <td class="dt-date">${label}</td>
                      <td class="dt-focus">
                        <div class="min-bar-wrap">
                          <div class="min-bar" style="width:${(minBar / 200) * 100}%"></div>
                          <span class="min-val">${d.focusMin}m</span>
                        </div>
                      </td>
                      <td class="dt-num">${d.sessions}</td>
                      <td class="dt-num ${d.manualDone > 0 ? 'dt-manual' : ''}">${d.manualDone || '—'}</td>
                      <td class="dt-num ${d.skips > 2 ? 'dt-warn' : ''}">${d.skips}</td>
                      <td class="dt-num">${rate}</td>
                      <td class="dt-zones">${zoneDots}</td>
                    </tr>`;
                  }).join('')}
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="chart-panel">
          <div class="chart-title">Zone Breakdown</div>
          ${ts.zoneData.length > 0 ? `
          <div class="zone-breakdown">
            ${ts.zoneData.map(z => {
              const total = ts.totalSessions || 1;
              const pct = Math.round((z.sessions / total) * 100);
              return `<div class="zone-row" onclick="ZoneApp.selectZone(${z.idx})">
                <div class="z-bar" style="background:${z.color}"></div>
                <div class="z-info">
                  <div class="z-name">${esc(z.title)}</div>
                  <div class="z-stat">${z.sessions} sessions · ${z.totalMin} min · ${z.skips} skips</div>
                </div>
                <div class="z-pct" style="color:${z.color}">${pct}%</div>
              </div>`;
            }).join('')}
          </div>` : '<div style="color:var(--text-muted);font-size:13px;padding:12px 0">Complete a session in a zone to see breakdown</div>'}
        </div>

        <div class="chart-panel">
          <div class="chart-title">Live Activity Log (Today)</div>
          <div class="event-timeline" id="eventTimeline">
            ${todayEvents.length === 0
              ? '<div style="color:var(--text-muted);font-size:13px;padding:12px 0">Start a timer — every action is logged here in real time</div>'
              : todayEvents.map(e => {
                  const iconMap = { session_start: '▶', session_complete: '✓', skip_block: '⏭', pause: '⏸', skip_zone: '⏩', zone_complete: '🏁', break: '☕' };
                  const icon = iconMap[e.type] || '•';
                  const clsMap = { session_start: 'start', session_complete: 'complete', skip_block: 'skip', pause: 'pause', skip_zone: 'skip', zone_complete: 'zone', break: 'break' };
                  const cls = clsMap[e.type] || '';
                  const labelMap = { session_start: 'Session started', session_complete: 'Session complete', skip_block: 'Block skipped', pause: 'Timer paused', skip_zone: 'Zone skipped', zone_complete: 'Zone complete', break: 'Break started' };
                  const label = labelMap[e.type] || e.type;
                  const detail = e.zoneIdx !== undefined ? `Zone ${(e.zoneIdx || 0) + 1}` : '';
                  return `<div class="event-item">
                    <span class="event-time">${e.time.slice(11, 16)}</span>
                    <span class="event-icon ${cls}">${icon}</span>
                    <span class="event-label">${label}</span>
                    ${detail ? `<span class="event-detail">${detail}</span>` : ''}
                  </div>`;
                }).join('')}
          </div>
        </div>
      </div>`;

    // Initialize charts after DOM is ready
    setTimeout(() => initCharts(ts), 100);
  }

  function showDayReport(date) {
    const log = state.tracking.log;
    const zones = getZones();
    const zoneLookup = (idx) => zones[idx] || { focusDuration: 25 };
    const events = log.filter(e => e.date === date).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    // BUG FIX: once a day's raw events have been trimmed out of `log` (see
    // logEvent's archiveOldEvents), `events` here is empty even though the
    // History table row for this same date (getTrackingStats()) still shows
    // its real totals from tracking.archivedDaily. Without this, clicking an
    // archived day's row showed "No activity" and all-zero stats — directly
    // contradicting the row that was just clicked. Fall back to the archived
    // per-day summary when there's no live log left for this date.
    const archived = events.length === 0 ? (state.tracking.archivedDaily || {})[date] : null;
    const timerSessions = archived ? archived.sessions : events.filter(e => e.type === 'session_complete').length;
    const zonesWithTimerPerDay = new Set(events.filter(e => e.type === 'session_complete').map(e => e.zoneIdx));
    const manualDone = archived ? archived.manualDone : events.filter(e => e.type === 'zone_complete' && !zonesWithTimerPerDay.has(e.zoneIdx)).length;
    const totalFocus = archived ? archived.focusMin
      : events.filter(e => e.type === 'session_complete').reduce((a, e) => a + (e.duration || 0), 0)
      + events.filter(e => e.type === 'zone_complete' && !zonesWithTimerPerDay.has(e.zoneIdx)).reduce((a, e) => a + (zoneLookup(e.zoneIdx).focusDuration || 25), 0)
      + events.filter(e => e.type === 'overtime').reduce((a, e) => a + Math.round((e.seconds || 0) / 60), 0);
    const sessions = timerSessions + manualDone;
    const skips = archived ? archived.skips : events.filter(e => e.type === 'skip_block' || e.type === 'skip_zone').length;
    const rate = sessions + skips > 0 ? Math.round((sessions / (sessions + skips)) * 100) : 0;
    const dateObj = new Date(date + 'T00:00:00');
    const label = dateObj.toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const iconMap = { session_start: '▶', session_complete: '✓', skip_block: '⏭', pause: '⏸', skip_zone: '⏩', zone_complete: '🏁', break: '☕' };
    const clsMap = { session_start: 'start', session_complete: 'complete', skip_block: 'skip', pause: 'pause', skip_zone: 'skip', zone_complete: 'zone', break: 'break' };
    function eventLabel(e) {
      if (e.type === 'zone_complete') return zonesWithTimerPerDay.has(e.zoneIdx) ? 'Zone complete' : 'Done (manual)';
      const m = { session_start: 'Session started', session_complete: 'Session complete', skip_block: 'Block skipped', pause: 'Timer paused', skip_zone: 'Zone skipped', break: 'Break started' };
      return m[e.type] || e.type;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal day-report-modal">
      <div class="modal-header">
        <h3 style="font-size:16px">📅 ${esc(label)}</h3>
        <button class="close-x" onclick="this.closest('.modal-overlay').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="dr-summary">
          <div class="dr-stat"><span class="dr-num">${totalFocus}</span><span class="dr-lbl">Focus min</span></div>
          <div class="dr-stat"><span class="dr-num">${timerSessions}</span><span class="dr-lbl">Timer</span></div>
          <div class="dr-stat"><span class="dr-num">${manualDone}</span><span class="dr-lbl">Manual</span></div>
          <div class="dr-stat"><span class="dr-num">${skips}</span><span class="dr-lbl">Skips</span></div>
          <div class="dr-stat"><span class="dr-num">${rate}%</span><span class="dr-lbl">Completion</span></div>
        </div>
        ${(() => {
          const dz = (state.tracking.dailyZones || {})[date];
          if (!dz) return '';
          return `<div style="font-size:12px;font-weight:600;margin:16px 0 8px;letter-spacing:1px">Zone Completion</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${
            dz.completed.map((c, i) => {
              const z = zones[i];
              if (!z) return '';
              const color = c ? (z.color || '#34D399') : '#333';
              const label = c ? 'Done' : 'Skipped';
              return `<span style="display:flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;background:${color}22;border:1px solid ${color};font-size:11px;font-family:var(--mono);color:${c ? 'var(--text-primary)' : 'var(--text-muted)'}">
                <span style="width:8px;height:8px;border-radius:50%;background:${color}"></span>
                ${esc(z.title)} <span style="font-size:9px;color:var(--text-muted)">${label}</span>
              </span>`;
            }).join('')
          }</div>`;
        })()}
        <div style="font-size:12px;font-weight:600;margin:16px 0 10px;letter-spacing:1px">Timeline</div>
        <div class="event-timeline" style="max-height:300px;overflow-y:auto">
          ${archived ? '<div style="color:var(--text-muted);font-size:13px;padding:12px 0">Detailed event log for this day has been archived — only the summary totals above are kept.</div>'
          : events.length === 0 ? '<div style="color:var(--text-muted);font-size:13px;padding:12px 0">No activity on this day</div>'
          : events.map(e => {
            const icon = iconMap[e.type] || '•';
            const cls = clsMap[e.type] || '';
            const l = eventLabel(e);
            const detail = e.zoneIdx !== undefined ? `Zone ${(e.zoneIdx || 0) + 1}` : '';
            const time = e.time ? e.time.slice(11, 16) : '--:--';
            return `<div class="event-item">
              <span class="event-time">${time}</span>
              <span class="event-icon ${cls}">${icon}</span>
              <span class="event-label">${l}</span>
              ${detail ? `<span class="event-detail">${detail}</span>` : ''}
              ${e.duration ? `<span class="event-detail">${e.duration}min</span>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  function initCharts(ts) {
    const isDark = true;
    const gridColor = 'rgba(255,255,255,0.06)';
    const textColor = '#6B7686';
    const accentGreen = '#34D399';
    const accentBlue = '#38BDF8';
    const accentRed = '#F26B6B';
    const accentPurple = '#A78BFA';

    const chartDefaults = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: textColor, font: { family: 'JetBrains Mono', size: 10 } } } },
      scales: { x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 9 } } }, y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 9 } } } }
    };

    // Line chart — last 14 days focus minutes
    const lineCtx = document.getElementById('focusLineChart');
    if (lineCtx && window.Chart) {
      const last14 = Object.entries(ts.dailyMap).sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
      const labels = last14.map(([k]) => k.slice(5));
      const data = last14.map(([, v]) => v.focusMin || 0);
      chartInstances.focusLine = new Chart(lineCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Focus Minutes',
            data,
            borderColor: accentGreen,
            backgroundColor: accentGreen + '20',
            fill: true,
            tension: 0.35,
            pointBackgroundColor: accentGreen,
            pointRadius: 3,
            pointHoverRadius: 6,
            borderWidth: 2
          }]
        },
        options: {
          ...chartDefaults,
          plugins: {
            ...chartDefaults.plugins,
            tooltip: {
              backgroundColor: '#161C26',
              titleColor: '#EDF1F7',
              bodyColor: '#A7B0BE',
              borderColor: '#232B38',
              borderWidth: 1,
              cornerRadius: 8
            }
          },
          scales: {
            x: { ...chartDefaults.scales.x, grid: { display: false } },
            y: { ...chartDefaults.scales.y, beginAtZero: true }
          }
        }
      });
    }

    // Doughnut — zone distribution
    const doughnutCtx = document.getElementById('zoneDoughnutChart');
    if (doughnutCtx && window.Chart) {
      const zoneData = ts.zoneData.filter(z => z.sessions > 0);
      if (zoneData.length > 0) {
        chartInstances.zoneDoughnut = new Chart(doughnutCtx, {
          type: 'doughnut',
          data: {
            labels: zoneData.map(z => z.title),
            datasets: [{
              data: zoneData.map(z => z.sessions),
              backgroundColor: zoneData.map(z => z.color),
              borderColor: '#10141C',
              borderWidth: 2,
              hoverOffset: 8
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: { color: textColor, font: { family: 'JetBrains Mono', size: 10 }, padding: 12 }
              },
              tooltip: {
                backgroundColor: '#161C26',
                titleColor: '#EDF1F7',
                bodyColor: '#A7B0BE',
                borderColor: '#232B38',
                borderWidth: 1,
                cornerRadius: 8
              }
            },
            cutout: '65%'
          }
        });
      } else {
        doughnutCtx.parentElement.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:40px 0;text-align:center">Complete sessions across zones to see distribution</div>';
      }
    }

    // Completion rate gauge
    const compCtx = document.getElementById('completionChart');
    if (compCtx && window.Chart) {
      const completed = ts.sessionsToday + ts.manualToday;
      const skipped = ts.skipsToday;
      if (completed + skipped > 0) {
        chartInstances.completion = new Chart(compCtx, {
          type: 'doughnut',
          data: {
            labels: ['Completed', 'Skipped'],
            datasets: [{
              data: [completed, skipped],
              backgroundColor: [accentGreen, accentRed],
              borderColor: '#10141C',
              borderWidth: 2,
              hoverOffset: 6
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: { color: textColor, font: { family: 'JetBrains Mono', size: 10 }, padding: 12 }
              },
              tooltip: {
                backgroundColor: '#161C26',
                titleColor: '#EDF1F7',
                bodyColor: '#A7B0BE',
                borderColor: '#232B38',
                borderWidth: 1,
                cornerRadius: 8
              }
            },
            cutout: '60%'
          }
        });
      } else {
        compCtx.parentElement.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:30px 0;text-align:center">Start a timer to see completion rate</div>';
      }
    }
  }

  function scrollToChart(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function showDayDetail(id) {
    const e = state.tracking.log.find(ev => ev.id === id);
    if (!e) return;
    const m = { session_start:'▶ Started', session_complete:'✓ Completed', skip_block:'⏭ Skipped', pause:'⏸ Paused', skip_zone:'⏩ Skipped zone', zone_complete:'🏁 Zone done', break:'☕ Break', stop:'⏹ Stopped' };
    const p = [m[e.type] || e.type];
    if (e.zoneName) p.push('Zone: '+e.zoneName);
    else if (e.zoneIdx !== undefined) p.push('Zone: '+(e.zoneIdx+1));
    if (e.duration) p.push(e.duration+'min');
    if (e.cycle !== undefined) p.push('Cycle '+(e.cycle+1));
    p.push(new Date(e.time).toLocaleTimeString());
    toast(p.join(' · '), 'info', 4000);
  }

  function refreshCharts() { renderStatsTab(); }

  // ─── EXAM TIMER TAB ─────────────────────────
  function getExamDates() {
    const trackId = state.tracks?.find(t => t.name === state.examTrack)?.id;
    // Use the user-selected target year from onboarding, fall back to current year + 1
    const targetYear = state.config?.identity?.targetYear || new Date().getFullYear() + 1;
    const defaultsObj = EXAM_DATES_BY_TRACK(targetYear);
    const defaults = defaultsObj[trackId] || defaultsObj.CUSTOM;
    const userDates = state.examDates || [];
    return defaults.map(d => {
      const user = userDates.find(u => u.id === d.id);
      return { ...d, date: user?.date || d.defaultDate };
    });
  }

  function setCountdownMode(mode) {
    state.examCountdownMode = mode;
    try { localStorage.setItem('zg:examCountdownMode', mode); } catch {}
    renderExamTimerTab();
  }

  function renderExamTimerTab() {
    const body = document.getElementById('tabBody');
    const exams = getExamDates();
    const now = Date.now();
    const mode = state.examCountdownMode || 'full';

    // Restore mode from localStorage
    try {
      const saved = localStorage.getItem('zg:examCountdownMode') || localStorage.getItem('zu:examCountdownMode');
      if (saved && ['full','days','hours','mins','secs'].includes(saved)) {
        state.examCountdownMode = saved;
      }
    } catch {}

    const modes = [
      { key: 'full', label: 'DD:HH:MM:SS' },
      { key: 'days', label: 'Days' },
      { key: 'hours', label: 'Hours' },
      { key: 'mins', label: 'Mins' },
      { key: 'secs', label: 'Secs' }
    ];

    function ringSVG(target) {
      const diff = target - now;
      const ONE_YEAR = 365.25 * 24 * 60 * 60 * 1000;
      const start = target - ONE_YEAR;
      const total = target - start;
      const frac = diff > 0 ? Math.min(1, Math.max(0, 1 - diff / total)) : 1;
      const r = 80, ar = r - 10, c = 2 * Math.PI * ar, size = 220, cx = 110, cy = 110;
      const offset = c * (1 - frac);
      return `<svg width="${size}" height="${size}" viewBox="0 0 220 220" class="exam-ring-svg">
        <circle cx="${cx}" cy="${cy}" r="${r - 10}" fill="none" stroke="var(--bg-3)" stroke-width="12"/>
        <circle cx="${cx}" cy="${cy}" r="${r - 10}" fill="none" stroke="var(--accent-lecture)" stroke-width="12"
          stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"
          style="transition:stroke-dashoffset .5s linear;transform:rotate(-90deg);transform-origin:${cx}px ${cy}px"/>
      </svg>`;
    }

    function buildCountdownHTML(i, target, expired) {
      if (expired) return '<div class="exam-expired">🎉 Exam Date Reached</div>';
      const diff = target - now;
      // Always show DD:HH:MM:SS — highlight selected unit
      return `
        <div class="exam-unit ${mode === 'days' ? 'exam-unit-hl' : ''}" id="ecd-${i}-d-wrap">
          <span class="exam-num ${mode === 'days' ? 'exam-num-hl' : ''}" id="ecd-${i}-d">00</span><span class="exam-lbl">Days</span>
        </div>
        <span class="exam-sep">:</span>
        <div class="exam-unit ${mode === 'hours' ? 'exam-unit-hl' : ''}" id="ecd-${i}-h-wrap">
          <span class="exam-num ${mode === 'hours' ? 'exam-num-hl' : ''}" id="ecd-${i}-h">00</span><span class="exam-lbl">Hours</span>
        </div>
        <span class="exam-sep">:</span>
        <div class="exam-unit ${mode === 'mins' ? 'exam-unit-hl' : ''}" id="ecd-${i}-m-wrap">
          <span class="exam-num ${mode === 'mins' ? 'exam-num-hl' : ''}" id="ecd-${i}-m">00</span><span class="exam-lbl">Mins</span>
        </div>
        <span class="exam-sep">:</span>
        <div class="exam-unit ${mode === 'secs' ? 'exam-unit-hl' : ''}" id="ecd-${i}-s-wrap">
          <span class="exam-num ${mode === 'secs' ? 'exam-num-hl' : ''}" id="ecd-${i}-s">00</span><span class="exam-lbl">Secs</span>
        </div>`;
    }

    body.innerHTML = `
      <div class="exam-timer-wrap">
        <div class="exam-timer-header">
          <h2>⏳ Exam Countdown${state.examTrack ? ' · ' + esc(state.examTrack) : ''}</h2>
          <button class="ctl" onclick="ZoneApp.openExamDateEditor()" style="padding:6px 14px;font-size:11px">✏️ Edit Dates</button>
        </div>
        <div class="exam-grid" id="examGrid">
          ${exams.map((e, i) => {
            const target = new Date(e.date + 'T23:59:59').getTime();
            const diff = target - now;
            const expired = diff <= 0;
            return `<div class="exam-card ${expired ? 'expired' : ''}" data-target="${target}">
              <div class="exam-card-head">
                <span class="exam-icon">${e.icon}</span>
                <span class="exam-name">${esc(e.name)}</span>
                <span class="exam-date">${e.date}</span>
              </div>
              <div class="exam-countdown-wrap">
                ${!expired ? ringSVG(target) : ''}
                <div class="exam-countdown" id="ecd-${i}">
                  ${buildCountdownHTML(i, target, expired)}
                </div>
              </div>
              ${!expired ? `<div class="exam-total" id="ecd-${i}-total">${getRemainingText(diff, state.examCountdownMode)}</div>` : ''}
            </div>`;
          }).join('')}
        </div>
      <div class="exam-footer-note">
        ${state.examTrack ? 'Dates auto-configured for ' + esc(state.examTrack) + '. Click "Edit Dates" to customize.' : 'Select an exam track in Settings to see countdown.'}
      </div>
      </div>`;
    tickExamTimers();
  }

  function getRemainingText(diff, mode) {
    const m = mode || 'full';
    if (m === 'days') return Math.floor(diff / 86400000) + ' days remaining';
    if (m === 'hours') return Math.floor(diff / 3600000) + ' hours remaining';
    if (m === 'mins') return Math.floor(diff / 60000) + ' minutes remaining';
    if (m === 'secs') return Math.floor(diff / 1000) + ' seconds remaining';
    return Math.floor(diff / 86400000) + ' days remaining';
  }

  function tickExamTimers() {
    const now = Date.now();
    const mode = state.examCountdownMode || 'full';
    document.querySelectorAll('.exam-card[data-target]').forEach((card, i) => {
      const target = parseInt(card.dataset.target);
      const diff = target - now;
      if (diff <= 0) {
        const cd = card.querySelector('.exam-countdown');
        if (cd && !cd.querySelector('.exam-expired')) {
          cd.innerHTML = '<div class="exam-expired">🎉 Exam Date Reached</div>';
          const wrap = card.querySelector('.exam-countdown-wrap');
          const ring = wrap?.querySelector('.exam-ring-svg');
          if (ring) ring.remove();
          const total = card.querySelector('.exam-total');
          if (total) total.remove();
          card.classList.add('expired');
        }
        return;
      }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);

      const dEl = document.getElementById('ecd-' + i + '-d');
      const hEl = document.getElementById('ecd-' + i + '-h');
      const mEl = document.getElementById('ecd-' + i + '-m');
      const sEl = document.getElementById('ecd-' + i + '-s');
      if (dEl) dEl.textContent = String(days).padStart(2, '0');
      if (hEl) hEl.textContent = String(hours).padStart(2, '0');
      if (mEl) mEl.textContent = String(mins).padStart(2, '0');
      if (sEl) sEl.textContent = String(secs).padStart(2, '0');

      const tEl = document.getElementById('ecd-' + i + '-total');
      if (tEl) tEl.textContent = getRemainingText(diff, mode);

      const ring = card.querySelector('.exam-ring-svg circle:last-child');
      if (ring) {
        const ONE_YEAR = 365.25 * 24 * 60 * 60 * 1000;
        const start = target - ONE_YEAR;
        const total = target - start;
        const frac = diff > 0 ? Math.min(1, Math.max(0, 1 - diff / total)) : 1;
        const c = 2 * Math.PI * 70;
        ring.setAttribute('stroke-dashoffset', c * (1 - frac));
      }
    });
  }

  function openExamDateEditor() {
    const exams = getExamDates();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal" style="max-width:400px">
      <div class="modal-header">
        <h3>✏️ Edit Exam Dates</h3>
        <button class="close-x" onclick="this.closest('.modal-overlay').remove()">✕</button>
      </div>
      <div class="modal-body" style="gap:12px">
        <p style="font-size:12px;color:var(--text-muted);margin:0 0 8px">Adjust target dates for your exams.</p>
        ${exams.map((e, i) => `
          <div style="display:flex;gap:8px;align-items:center">
            <span style="font-size:16px">${e.icon}</span>
            <span style="font-size:13px;font-weight:500;min-width:120px">${esc(e.name)}</span>
            <input type="date" id="ed-${i}" value="${e.date}"
              style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg-3);color:var(--text);font-size:13px;outline:none">
          </div>
        `).join('')}
        <button class="ctl primary" style="width:100%;margin-top:8px" onclick="ZoneApp.saveExamDates(this)">Save Dates</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
  }

  function saveExamDates(btn) {
    const exams = getExamDates();
    const dates = exams.map((e, i) => ({
      id: e.id,
      date: document.getElementById('ed-' + i)?.value || e.defaultDate
    }));
    state.examDates = dates;
    storage().set('examDates', dates);
    saveUserDataToServer('examDates');
    const ov = btn?.closest('.modal-overlay');
    if (ov) ov.remove();
    renderTabBody();
    toast('Exam dates saved', 'success');
  }

  // ─── SETTINGS TAB ───────────────────────────
  function renderSettingsTab() {
    const body = document.getElementById('tabBody');
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:20px;padding:8px 0">
        <h2 style="font-size:20px;font-weight:700">⚙️ Settings</h2>
        <div class="settings-grid">
          ${state.username ? `
          <div class="settings-card">
            <div class="field-label" style="margin-bottom:14px">Account</div>
            <div style="display:flex;flex-direction:column;gap:10px">
              <div style="display:flex;gap:8px;align-items:center">
                <div style="font-size:13px;font-weight:600;color:var(--text-primary);min-width:70px">Username</div>
                <input type="text" id="usernameInput" value="${esc(state.username)}" style="flex:1;background:var(--bg-3);border:1px solid var(--line);border-radius:8px;padding:8px 12px;color:var(--text-primary);font-size:14px;font-weight:600">
                <button class="ctl primary" onclick="ZoneApp.changeUsername()" style="padding:8px 14px;font-size:11px">Save</button>
              </div>
              <div style="display:flex;gap:8px;align-items:center">
                <div style="font-size:13px;font-weight:600;color:var(--text-primary);min-width:70px">Password</div>
                <input type="password" id="currentPwInput" placeholder="Current password" style="flex:1;background:var(--bg-3);border:1px solid var(--line);border-radius:8px;padding:8px 12px;color:var(--text-primary);font-size:13px">
                <input type="password" id="newPwInput" placeholder="New password" style="flex:1;background:var(--bg-3);border:1px solid var(--line);border-radius:8px;padding:8px 12px;color:var(--text-primary);font-size:13px">
                <button class="ctl primary" onclick="ZoneApp.changePassword()" style="padding:8px 14px;font-size:11px">Change</button>
              </div>
            </div>
          </div>
          ` : ''}
          <div class="settings-card">
            <div class="field-label" style="margin-bottom:14px">Goal</div>
            <div style="display:flex;flex-direction:column;gap:10px">
              <div style="display:flex;gap:8px;align-items:center">
                <input type="text" id="goalNameInput" value="${esc(state.config?.identity?.goalName || '')}" placeholder="e.g. NEET 2026" style="flex:1;background:var(--bg-3);border:1px solid var(--line);border-radius:8px;padding:8px 12px;color:var(--text-primary);font-size:14px;font-weight:600">
                <button class="ctl primary" onclick="ZoneApp.saveGoalName()" style="padding:8px 14px;font-size:11px">Save</button>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
                <div><div style="font-weight:500;font-size:13px">${state.config?.identity?.examTrack || 'Not set'}</div><div style="font-size:11px;color:var(--text-muted)">Exam track</div></div>
                <button class="ctl" onclick="ZoneApp.openOnboarding()" style="padding:6px 14px;font-size:11px">Change</button>
              </div>
            </div>
          </div>
          <div class="settings-card">
            <div class="field-label" style="margin-bottom:14px">Notifications & Sound</div>
            ${[
              { id: 'notifEnabled', label: 'Browser Notifications', desc: 'Get notified when blocks end', val: state.settings.notifEnabled },
              { id: 'soundEnabled', label: 'Sound Effects', desc: 'Play sounds on timer events', val: state.settings.soundEnabled },
              { id: 'quietMode', label: 'Quiet Mode', desc: 'Suppress non-critical notifications', val: state.settings.quietMode }
            ].map(s => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)">
              <div><div style="font-weight:500;font-size:13px">${s.label}</div><div style="font-size:11px;color:var(--text-muted)">${s.desc}</div></div>
              <div style="width:44px;height:24px;border-radius:12px;background:${s.val ? 'var(--accent-solve)' : 'var(--bg-3)'};cursor:pointer;position:relative;transition:background .15s;border:1px solid var(--line)" onclick="ZoneApp.toggleSetting('${s.id}')">
                <div style="width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;top:2px;${s.val ? 'right:2px' : 'left:2px'};transition:left .15s,right .15s;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>
              </div>
            </div>`).join('')}
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0">
              <div><div style="font-weight:500;font-size:13px">Sound Pack</div><div style="font-size:11px;color:var(--text-muted)">Tone profile for timer events</div></div>
              <select onchange="ZoneApp.setSetting('soundPack', this.value)" style="background:var(--bg-3);border:1px solid var(--line);border-radius:8px;padding:6px 10px;color:var(--text-primary);font-size:12px;font-family:var(--mono)">
                ${Object.entries(SOUND_PACKS).map(([k, v]) => `<option value="${k}" ${state.settings.soundPack === k ? 'selected' : ''}>${v.label || k.charAt(0).toUpperCase() + k.slice(1)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="settings-card">
            <div class="field-label" style="margin-bottom:14px">Timer Behavior</div>
            ${[
              { id: 'autoStartBreaks', label: 'Auto-Start Breaks', desc: 'Focus ends → break starts automatically', val: state.settings.autoStartBreaks },
              { id: 'flowMode', label: 'Flow Mode', desc: 'Auto-continue through all cycles without intervention', val: state.settings.flowMode }
            ].map(s => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)">
              <div><div style="font-weight:500;font-size:13px">${s.label}</div><div style="font-size:11px;color:var(--text-muted)">${s.desc}</div></div>
              <div style="width:44px;height:24px;border-radius:12px;background:${s.val ? 'var(--accent-solve)' : 'var(--bg-3)'};cursor:pointer;position:relative;transition:background .15s;border:1px solid var(--line)" onclick="ZoneApp.toggleSetting('${s.id}')">
                <div style="width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;top:2px;${s.val ? 'right:2px' : 'left:2px'};transition:left .15s,right .15s;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>
              </div>
            </div>`).join('')}
          </div>
          <div class="settings-card">
            <div class="field-label" style="margin-bottom:14px">Exam Countdown Display</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">Choose how the countdown shows on each exam card</div>
            <div class="exam-cd-toggle" style="margin:0">
              ${[
                { key:'full', label:'DD:HH:MM:SS' },
                { key:'days', label:'Days' },
                { key:'hours', label:'Hours' },
                { key:'mins', label:'Mins' },
                { key:'secs', label:'Secs' }
              ].map(m => `<button class="exam-cd-btn ${state.examCountdownMode === m.key ? 'active' : ''}" onclick="ZoneApp.setCountdownMode('${m.key}')">${m.label}</button>`).join('')}
            </div>
          </div>
          <div class="settings-card">
            <div class="field-label" style="margin-bottom:14px">Timer Preset</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
              ${Object.entries(TIMER_PRESETS).filter(([k]) => k !== 'custom').map(([k, p]) => `<button onclick="ZoneApp.setSetting('timerPreset', '${k}')" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 8px;border-radius:var(--r-sm);cursor:pointer;background:${state.settings.timerPreset === k ? 'var(--accent-solve)' : 'var(--bg-2)'};border:1px solid ${state.settings.timerPreset === k ? 'var(--accent-solve)' : 'var(--line)'};color:var(--text-primary);font-family:var(--mono);transition:all .15s;text-align:center">
                <span style="font-size:13px;font-weight:600">${p.label}</span>
                <span style="font-size:10px;color:var(--text-muted)">${p.focus}m focus · ${p.break}m break</span>
              </button>`).join('')}
            </div>
          </div>
          <div class="settings-card">
            <div class="field-label" style="margin-bottom:14px">Theme</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
              ${[
                { id:'hacker', label:'Hacker', icon:'💚', desc:'Matrix green terminal' },
                { id:'cyber', label:'Cyberpunk', icon:'💜', desc:'Neon purple cyan' },
                { id:'midnight', label:'Midnight', icon:'💙', desc:'Glass deep blue' },
                { id:'amber', label:'Amber', icon:'🧡', desc:'Warm amber glow' },
                { id:'corporate', label:'Corporate', icon:'💼', desc:'Clean blue dark' },
                { id:'platinum', label:'Platinum', icon:'✨', desc:'Premium gold/silver' }
              ].map(t => `<button onclick="ZoneApp.setTheme('${t.id}')" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px;border-radius:var(--r-sm);cursor:pointer;background:${state.settings.theme === t.id ? 'var(--accent-solve)' : 'var(--bg-2)'};border:1px solid ${state.settings.theme === t.id ? 'var(--accent-solve)' : 'var(--line)'};color:var(--text-primary);font-family:var(--mono);transition:all .15s;text-align:center">
                <span style="font-size:24px;line-height:1">${t.icon}</span>
                <span style="font-size:11px;font-weight:600">${t.label}</span>
                <span style="font-size:9px;color:var(--text-muted);white-space:nowrap">${t.desc}</span>
              </button>`).join('')}
            </div>
          </div>
          <div class="settings-card">
            <div class="field-label" style="margin-bottom:14px">Calendar</div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;">
              <div><div style="font-weight:500;font-size:13px">Indian Holidays & Festivals</div><div style="font-size:11px;color:var(--text-muted)">Show default Indian calendar events</div></div>
              <div style="width:44px;height:24px;border-radius:12px;background:${state.settings.showDefaultEvents ? 'var(--accent-solve)' : 'var(--bg-3)'};cursor:pointer;position:relative;transition:background .15s;border:1px solid var(--line)" onclick="ZoneApp.toggleSetting('showDefaultEvents')">
                <div style="width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;top:2px;${state.settings.showDefaultEvents ? 'right:2px' : 'left:2px'};transition:left .15s,right .15s;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>
              </div>
            </div>
          </div>
          ${state.isAdmin ? `
          <div class="settings-card">
            <div class="field-label" style="margin-bottom:12px">🔑 Reset Keys for Users</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Generate a key to give to users so they can reset their password without the admin env password.</div>
            <button class="ctl" onclick="ZoneApp.generateResetKey()" style="padding:8px 16px;font-size:11px">🎲 Generate Reset Key</button>
            <div id="resetKeyDisplay" style="margin-top:10px;display:none">
              <div style="font-size:10px;color:var(--text-muted);font-family:var(--mono);margin-bottom:4px">Share this key with the user:</div>
              <div style="background:var(--bg-3);border:1px solid var(--accent-suc);border-radius:8px;padding:12px;font-family:var(--mono);font-size:13px;color:var(--accent-suc);text-align:center;word-break:break-all" id="resetKeyValue"></div>
            </div>
          </div>` : ''}
          <div class="settings-card" style="grid-column:1/-1">
            <div class="field-label" style="margin-bottom:14px">Schedule Editor</div>
            <div id="zoneEditorList">${renderZoneEditors()}</div>
            <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <button class="ctl" onclick="ZoneApp.addZone()" style="padding:8px 18px;font-size:11px">+ Add Zone</button>
              <button class="ctl primary" onclick="ZoneApp.saveZoneEdits()" style="padding:8px 18px;font-size:11px;font-weight:600">💾 Save Schedule</button>
              <span style="font-size:10px;color:var(--text-muted);font-family:var(--mono)">Changes apply after day reset</span>
            </div>
          </div>
          <div class="settings-card">
            <div class="field-label" style="margin-bottom:14px">Data</div>
            <div style="display:flex;flex-wrap:wrap;gap:10px">
              <button class="ctl" onclick="ZoneApp.exportConfig()" style="padding:8px 16px;font-size:11px">⬇ Export Config</button>
              <button class="ctl" onclick="ZoneApp.syncExport()" style="padding:8px 16px;font-size:11px">📦 Full Backup</button>
              <button class="ctl" onclick="ZoneApp.syncImport()" style="padding:8px 16px;font-size:11px">📥 Restore Backup</button>
              <button class="ctl" onclick="ZoneApp.clearStats()" style="padding:8px 16px;font-size:11px">🗑 Clear Stats</button>
              <button class="ctl danger" onclick="ZoneApp.resetAll()" style="padding:8px 16px;font-size:11px">⚠ Reset All</button>
            </div>
          </div>
          <div class="settings-card">
            <div class="field-label" style="margin-bottom:14px">Session</div>
            <button class="ctl danger" onclick="ZoneApp.logout()" style="padding:8px 16px;font-size:11px">🚪 Logout</button>
          </div>
        </div>`;
  }

  function editTitleInline() {
    const current = state.config?.identity?.goalName || 'Zone';
    const v = prompt('Edit title:', current);
    if (v && v.trim() && v.trim() !== current) {
      state.config.identity.goalName = v.trim();
      saveConfig();
      render();
    }
  }

  function saveGoalName() {
    const inp = document.getElementById('goalNameInput');
    if (!inp) return;
    const v = inp.value.trim();
    if (!v) return;
    state.config.identity.goalName = v;
    saveConfig();
    render();
  }

  function toggleSetting(key) {
    state.settings[key] = !state.settings[key];
    storage().set('settings', state.settings);
    if (!isGuest()) saveUserDataToServer('settings');
    renderTabBody();
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme || 'hacker');
  }

  function setTheme(theme) {
    state.settings.theme = theme;
    storage().set('settings', state.settings);
    if (!isGuest()) saveUserDataToServer('settings');
    applyTheme(theme);
    renderTabBody();
    initThemeEffects();
  }

  // ─── THEME AMBIENT EFFECTS ─────────────────────
  let _themeFxCanvas = null;
  let _themeFxCtx = null;
  let _themeFxRaf = null;
  let _themeFxParticles = [];
  let _themeFxVisHandler = null;

  function initThemeEffects() {
    if (_themeFxRaf) { cancelAnimationFrame(_themeFxRaf); _themeFxRaf = null; }
    _themeFxParticles = [];
    const theme = state.settings.theme || 'hacker';
    if (theme === 'hacker' || theme === 'cyber' || theme === 'midnight' || theme === 'amber') {
      if (!_themeFxCanvas) {
        _themeFxCanvas = document.createElement('canvas');
        _themeFxCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0.7';
        document.body.appendChild(_themeFxCanvas);
      }
      _themeFxCanvas.style.display = 'block';
      _themeFxCtx = _themeFxCanvas.getContext('2d');
      resizeThemeCanvas();
      window.removeEventListener('resize', resizeThemeCanvas);
      window.addEventListener('resize', resizeThemeCanvas);
      const fx = getThemeFx(theme);
      if (fx) fx.init();
      function frame() {
        if (fx) fx.update();
        if (fx) fx.draw();
        _themeFxRaf = requestAnimationFrame(frame);
      }
      _themeFxRaf = requestAnimationFrame(frame);
      if (_themeFxVisHandler) document.removeEventListener('visibilitychange', _themeFxVisHandler);
      _themeFxVisHandler = function onVis() {
        if (document.hidden && _themeFxRaf) {
          cancelAnimationFrame(_themeFxRaf);
          _themeFxRaf = null;
        } else if (!document.hidden && !_themeFxRaf) {
          _themeFxRaf = requestAnimationFrame(frame);
        }
      };
      document.addEventListener('visibilitychange', _themeFxVisHandler);
    } else {
      if (_themeFxVisHandler) { document.removeEventListener('visibilitychange', _themeFxVisHandler); _themeFxVisHandler = null; }
      if (_themeFxCanvas) _themeFxCanvas.style.display = 'none';
      if (_themeFxParticles.length) _themeFxParticles = [];
    }
  }

  function resizeThemeCanvas() {
    if (!_themeFxCanvas) return;
    _themeFxCanvas.width = window.innerWidth;
    _themeFxCanvas.height = window.innerHeight;
  }

  function getThemeFx(theme) {
    const c = _themeFxCtx;
    const w = () => _themeFxCanvas?.width || 0;
    const h = () => _themeFxCanvas?.height || 0;

    if (theme === 'hacker') {
      const cols = [];
      const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789<>/{}[]|&^%$#@!';
      return {
        init() {
          const n = Math.max(40, Math.floor(w() / 15));
          for (let i = 0; i < n; i++) {
            cols.push({
              x: i * (w() / n) + Math.random() * 10,
              y: Math.random() * h() * -1,
              speed: 1.5 + Math.random() * 3,
              len: 8 + Math.floor(Math.random() * 20),
            });
          }
        },
        update() {
          for (const col of cols) {
            col.y += col.speed;
            if (col.y - col.len * 14 > h()) {
              col.y = -col.len * 14;
              col.x = Math.random() * w();
              col.speed = 1.5 + Math.random() * 3;
            }
          }
        },
        draw() {
          c.clearRect(0, 0, w(), h());
          c.font = '13px "JetBrains Mono", monospace';
          for (const col of cols) {
            for (let i = 0; i < col.len; i++) {
              const y = col.y - i * 14;
              if (y < 0 || y > h()) continue;
              const ch = chars[Math.floor(Math.random() * chars.length)];
              const alpha = 1 - (i / col.len) * 0.85;
              c.fillStyle = i === 0 ? `rgba(200,255,200,${Math.min(1,alpha+0.3)})`
                : `rgba(52,211,153,${alpha * 0.7})`;
              c.fillText(ch, col.x, y);
            }
          }
        }
      };
    }

    if (theme === 'cyber') {
      const particles = [];
      return {
        init() {
          const n = Math.min(80, Math.floor(w() * h() / 12000));
          for (let i = 0; i < n; i++) {
            particles.push({
              x: Math.random() * w(), y: Math.random() * h(),
              vx: (Math.random() - 0.5) * 0.6,
              vy: (Math.random() - 0.5) * 0.6,
              r: 1.5 + Math.random() * 3,
              hue: Math.random() < 0.5 ? 270 : 190,
              life: 0.5 + Math.random() * 0.5,
            });
          }
        },
        update() {
          for (const p of particles) {
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0 || p.x > w()) p.vx *= -1;
            if (p.y < 0 || p.y > h()) p.vy *= -1;
            p.life -= 0.002;
            if (p.life <= 0) {
              p.x = Math.random() * w(); p.y = Math.random() * h();
              p.life = 0.5 + Math.random() * 0.5;
            }
          }
        },
        draw() {
          c.clearRect(0, 0, w(), h());
          for (const p of particles) {
            c.beginPath();
            c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            c.fillStyle = `hsla(${p.hue},80%,60%,${p.life * 0.4})`;
            c.fill();
            // connect nearby
            for (const q of particles) {
              if (p === q) continue;
              const dx = p.x - q.x, dy = p.y - q.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < 100) {
                c.beginPath();
                c.moveTo(p.x, p.y);
                c.lineTo(q.x, q.y);
                c.strokeStyle = `hsla(${p.hue},80%,60%,${(1 - dist / 100) * 0.1})`;
                c.lineWidth = 0.5;
                c.stroke();
              }
            }
          }
        }
      };
    }

    if (theme === 'midnight') {
      const stars = [];
      return {
        init() {
          const n = Math.min(100, Math.floor(w() * h() / 10000));
          for (let i = 0; i < n; i++) {
            stars.push({
              x: Math.random() * w(), y: Math.random() * h(),
              r: 0.5 + Math.random() * 2,
              phase: Math.random() * Math.PI * 2,
              speed: 0.3 + Math.random() * 0.7,
            });
          }
        },
        update() {
          // stars twinkle via sin in draw
        },
        draw() {
          c.clearRect(0, 0, w(), h());
          const t = Date.now() / 1000;
          for (const s of stars) {
            const alpha = 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
            if (alpha < 0.15) continue;
            c.beginPath();
            c.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            c.fillStyle = `rgba(150,200,255,${alpha})`;
            c.fill();
            if (s.r > 1.2) {
              c.beginPath();
              c.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2);
              c.fillStyle = `rgba(150,200,255,${alpha * 0.08})`;
              c.fill();
            }
          }
        }
      };
    }

    if (theme === 'amber') {
      const embers = [];
      return {
        init() {
          const n = Math.min(35, Math.floor(w() / 30));
          for (let i = 0; i < n; i++) {
            embers.push({
              x: Math.random() * w(), y: h() + 20 + Math.random() * 60,
              vx: (Math.random() - 0.5) * 0.4,
              vy: -(0.5 + Math.random() * 1.2),
              r: 2 + Math.random() * 3,
              opacity: 0.3 + Math.random() * 0.4,
              drift: Math.random() * 0.3,
            });
          }
        },
        update() {
          for (const e of embers) {
            e.x += e.vx + Math.sin(Date.now() / 1000 * e.drift) * 0.2;
            e.y += e.vy;
            e.vy -= 0.003;
            e.opacity -= 0.002;
            if (e.opacity <= 0 || e.y < -20) {
              e.x = Math.random() * w();
              e.y = h() + 20 + Math.random() * 40;
              e.vy = -(0.5 + Math.random() * 1.2);
              e.opacity = 0.3 + Math.random() * 0.4;
              e.r = 2 + Math.random() * 3;
            }
          }
        },
        draw() {
          c.clearRect(0, 0, w(), h());
          for (const e of embers) {
            const grad = c.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * 2);
            grad.addColorStop(0, `rgba(251,191,36,${e.opacity * 0.8})`);
            grad.addColorStop(0.5, `rgba(251,146,60,${e.opacity * 0.3})`);
            grad.addColorStop(1, `rgba(251,146,60,0)`);
            c.beginPath();
            c.arc(e.x, e.y, e.r * 2, 0, Math.PI * 2);
            c.fillStyle = grad;
            c.fill();
          }
        }
      };
    }

    return null;
  }

  async function changePassword() {
    const cur = document.getElementById('currentPwInput')?.value;
    const pw = document.getElementById('newPwInput')?.value;
    if (!cur || !pw) { toast('Fill in both fields', 'warning'); return; }
    if (pw.length < 8) { toast('New password too short (min 8)', 'warning'); return; }
    if (new TextEncoder().encode(pw).length > 72) { toast('Password too long (max 72 bytes — try shorter)', 'warning'); return; }
    try {
      const res = await fetchJSON('/api/change-password', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ current_password: cur, new_password: pw })
      });
      toast('Password updated!', 'success');
      document.getElementById('currentPwInput').value = '';
      document.getElementById('newPwInput').value = '';
    } catch (e) {
      toast(e.message || 'Failed to change password', 'error');
    }
  }

  async function changeUsername() {
    const inp = document.getElementById('usernameInput');
    if (!inp) return;
    const newName = inp.value.trim();
    if (!newName || newName.length < 2) { toast('Username too short', 'warning'); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(newName)) { toast('Only letters, numbers, hyphens and underscores', 'warning'); return; }
    if (newName === state.username) { toast('That is already your username', 'info'); return; }
    if (!confirm(`Change username from "${state.username}" to "${newName}"?`)) return;
    try {
      const res = await fetchJSON('/api/change-username', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ new_username: newName })
      });
      state.username = res.username;
      toast('Username changed!', 'success');
    } catch (e) {
      toast(e.message || 'Failed to change username', 'error');
    }
  }

  function renderZoneEditors() {
    return getZones().map((z, i) => {
      const colors = ['#38BDF8','#F26B6B','#FBBF24','#34D399','#A78BFA','#F472B6','#FB923C'];
      const color = z.color || colors[i % colors.length];
      const typeLabels = { focus: 'Focus', break: 'Break', buffer: 'Buffer' };
      const maxLimit = z.type === 'buffer' ? 90 : 300;
      return `<div class="zone-editor-card" style="border-left:4px solid ${color}" id="ze-card-${i}">
        <div class="ze-section">
          <div class="ze-section-title">Basic Info</div>
          <div class="ze-row">
            <div class="ze-field flex-1">
              <label>Title</label>
              <input type="text" value="${esc(z.title)}" id="ze-${i}-title" placeholder="e.g. Morning Core">
            </div>
            <div class="ze-field" style="max-width:140px">
              <label>Type</label>
              <select id="ze-${i}-type" onchange="ZoneApp.onZoneTypeChange(${i})">
                ${['focus','break','buffer'].map(t => `<option value="${t}" ${z.type === t ? 'selected' : ''}>${typeLabels[t]}</option>`).join('')}
              </select>
            </div>
            <div class="ze-field" style="max-width:80px">
              <label>Color</label>
              <input type="color" value="${color}" id="ze-${i}-color" oninput="document.getElementById('ze-card-${i}').style.borderLeftColor=this.value" style="width:44px;height:36px;padding:2px;cursor:pointer;background:none;border:1px solid var(--line);border-radius:8px">
            </div>
          </div>
          <div class="ze-field">
            <label>Subtitle (optional)</label>
            <input type="text" value="${esc(z.subtitle || '')}" id="ze-${i}-sub" placeholder="e.g. Deep work session">
          </div>
        </div>
        <div class="ze-section">
          <div class="ze-section-title">Duration</div>
          <div class="ze-row">
            <div class="ze-field flex-1">
              <label>Focus <span class="ze-label-val" id="ze-${i}-focus-v">${z.focusDuration || 25} min</span></label>
              <input type="range" min="5" max="120" value="${z.focusDuration || 25}" id="ze-${i}-focus" oninput="document.getElementById('ze-${i}-focus-v').textContent=this.value+' min';ZoneApp.recalcHint(${i})">
            </div>
          </div>
          <div class="ze-row ze-row-3">
            <div class="ze-field">
              <label>Short Break</label>
              <div style="display:flex;align-items:center;gap:4px"><input type="number" min="1" max="30" value="${z.breakDuration || 5}" id="ze-${i}-break" oninput="ZoneApp.recalcHint(${i})"><span class="ze-unit">min</span></div>
            </div>
            <div class="ze-field">
              <label>Long Break</label>
              <div style="display:flex;align-items:center;gap:4px"><input type="number" min="1" max="60" value="${z.longBreakDuration || 15}" id="ze-${i}-long" oninput="ZoneApp.recalcHint(${i})"><span class="ze-unit">min</span></div>
            </div>
            <div class="ze-field">
              <label>Long Break Every</label>
              <div style="display:flex;align-items:center;gap:4px"><input type="number" min="1" max="20" value="${z.cyclesBeforeLongBreak || 4}" id="ze-${i}-lb-cycle" style="width:50px" oninput="ZoneApp.recalcHint(${i})"><span class="ze-unit">cycles</span></div>
            </div>
          </div>
          <div class="ze-row">
            <div class="ze-field flex-1">
              <label>Max Time <span class="ze-label-val" id="ze-${i}-tl-v">${z.timeLimit || maxLimit} min</span></label>
              <input type="range" min="15" max="${maxLimit}" value="${z.timeLimit || maxLimit}" id="ze-${i}-tlim" oninput="document.getElementById('ze-${i}-tl-v').textContent=this.value+' min';ZoneApp.recalcHint(${i})">
            </div>
          </div>
          <div class="ze-hint" id="ze-${i}-hint">Calculated total: <strong style="color:var(--accent-solve)">${calcZoneTotal(z)}</strong> min</div>
          <div id="ze-${i}-ct-wrap">${renderCycleNames(z, i)}</div>
        </div>
        <div class="ze-section">
          <div class="ze-section-title">Schedule</div>
          <div class="ze-row ze-row-3">
            <div class="ze-field">
              <label>Cycles</label>
              <div style="display:flex;align-items:center;gap:4px"><input type="number" min="1" max="20" value="${z.totalCycles || 4}" id="ze-${i}-cycles" style="width:60px" oninput="ZoneApp.recalcHint(${i});ZoneApp.syncCycleNames(${i})"><span class="ze-unit">blocks</span></div>
            </div>
            <div class="ze-field">
              <label>Start Time</label>
              <input type="time" value="${z.startTime || '09:00'}" id="ze-${i}-start">
            </div>
            <div class="ze-field">
              <label>End Time</label>
              <input type="time" value="${z.endTime || '10:00'}" id="ze-${i}-end">
            </div>
          </div>
        </div>
        ${i > 0 ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line);text-align:right"><button class="zone-remove" onclick="ZoneApp.removeZone(${i})">Remove this zone</button></div>` : ''}
      </div>`;
    }).join('');
  }

  function renderCycleNames(z, i) {
    const cycles = z.totalCycles || 4;
    if (cycles <= 1) return '';
    return `<div style="margin-top:14px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:8px;font-family:var(--mono)">Cycle Names</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${Array.from({length: cycles}, (_, ci) => `<input type="text" value="${esc(z.cycleTitles?.[ci] || '')}" id="ze-${i}-ct-${ci}" placeholder="Cycle ${ci+1}" style="flex:1;min-width:100px;background:var(--bg-3);border:1px solid var(--line);border-radius:8px;color:var(--text-primary);padding:7px 10px;font-size:12px;font-weight:500">`).join('')}
      </div>
    </div>`;
  }

  function syncCycleNames(i) {
    const wrap = document.getElementById(`ze-${i}-ct-wrap`);
    const cyclesEl = document.getElementById(`ze-${i}-cycles`);
    if (!wrap || !cyclesEl) return;
    const n = parseInt(cyclesEl.value) || 4;
    const existing = [];
    const allInputs = wrap.querySelectorAll('input');
    allInputs.forEach(inp => { existing.push(inp.value); });
    const z = { totalCycles: n, cycleTitles: existing };
    wrap.innerHTML = renderCycleNames(z, i);
  }

  function onZoneTypeChange(i) {
    const typeEl = document.getElementById(`ze-${i}-type`);
    const tlSlider = document.getElementById(`ze-${i}-tlim`);
    const tlVal = document.getElementById(`ze-${i}-tl-v`);
    if (!typeEl || !tlSlider) return;
    const isBuffer = typeEl.value === 'buffer';
    const max = isBuffer ? 90 : 300;
    tlSlider.max = max;
    if (parseInt(tlSlider.value) > max) {
      tlSlider.value = max;
      if (tlVal) tlVal.textContent = max + ' min';
    }
  }

  function calcZoneTotal(z) {
    const focusTotal = (z.focusDuration || 25) * (z.totalCycles || 4);
    const breaks = (z.totalCycles || 4);
    let breakTotal = 0;
    const longEvery = z.cyclesBeforeLongBreak || 4;
    for (let b = 0; b < breaks; b++) {
      breakTotal += ((b + 1) % longEvery === 0) ? (z.longBreakDuration || 15) : (z.breakDuration || 5);
    }
    return focusTotal + breakTotal;
  }

  function recalcHint(i) {
    const focus = parseInt(document.getElementById(`ze-${i}-focus`)?.value) || 25;
    const brk = parseInt(document.getElementById(`ze-${i}-break`)?.value) || 5;
    const lng = parseInt(document.getElementById(`ze-${i}-long`)?.value) || 15;
    const lbCycle = parseInt(document.getElementById(`ze-${i}-lb-cycle`)?.value) || 4;
    const cycles = parseInt(document.getElementById(`ze-${i}-cycles`)?.value) || 4;
    const z = { focusDuration: focus, breakDuration: brk, longBreakDuration: lng, cyclesBeforeLongBreak: lbCycle, totalCycles: cycles };
    const hint = document.getElementById(`ze-${i}-hint`);
    const tlEl = document.getElementById(`ze-${i}-tlim`);
    if (hint) {
      const total = calcZoneTotal(z);
      const tl = parseInt(tlEl?.value) || 180;
      const ok = total <= tl;
      hint.innerHTML = `Calculated total: <strong style="color:${ok ? 'var(--accent-solve)' : 'var(--danger)'}">${total}</strong> min ${ok ? '✓ ≤ ' + tl : '> ' + tl + ' min limit'}`;
    }
  }

  let _zoneIdCounter = 0;
  function _nextZoneId() {
    _zoneIdCounter = Math.max(_zoneIdCounter, ...getZones().map(z => z.id || 0)) + 1;
    return _zoneIdCounter;
  }

  function addZone() {
    const zones = getZones();
    const last = zones[zones.length - 1] || {};
    const prevEnd = last.endTime || '21:00';
    const [h, m] = prevEnd.split(':').map(Number);
    const nextStart = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    let nextEnd;
    if (h >= 22) {
      nextEnd = '23:00';
    } else {
      nextEnd = `${String(Math.min(h + 2, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    if (nextEnd <= nextStart) nextEnd = '23:00';
    const colors = ['#38BDF8','#F26B6B','#FBBF24','#34D399','#A78BFA','#F472B6','#FB923C'];
    const newZone = {
      id: _nextZoneId(),
      title: `Zone ${_zoneIdCounter}`,
      subtitle: 'New session',
      type: 'focus',
      color: colors[zones.length % colors.length],
      startTime: nextStart,
      endTime: nextEnd,
      focusDuration: 25, breakDuration: 5, longBreakDuration: 15,
      cyclesBeforeLongBreak: 4, totalCycles: 4,
      timeLimit: 180, cycleTitles: []
    };
    zones.push(newZone);
    saveConfig();
    renderTabBody();
    toast('New zone added!', 'success');
  }

  function saveZoneEdits() {
    const liveZones = getZones();
    // Work on a deep copy so live state isn't mutated until validation passes
    const zones = liveZones.map(z => JSON.parse(JSON.stringify(z)));
    zones.forEach((z, i) => {
      const titleEl = document.getElementById(`ze-${i}-title`);
      if (titleEl) z.title = titleEl.value.trim() || z.title;
      const subEl = document.getElementById(`ze-${i}-sub`);
      if (subEl) z.subtitle = subEl.value.trim();
      const typeEl = document.getElementById(`ze-${i}-type`);
      if (typeEl) z.type = typeEl.value;
      const focusEl = document.getElementById(`ze-${i}-focus`);
      if (focusEl) z.focusDuration = parseInt(focusEl.value) || 25;
      const breakEl = document.getElementById(`ze-${i}-break`);
      if (breakEl) z.breakDuration = parseInt(breakEl.value) || 5;
      const longEl = document.getElementById(`ze-${i}-long`);
      if (longEl) z.longBreakDuration = parseInt(longEl.value) || 15;
      const lbCycleEl = document.getElementById(`ze-${i}-lb-cycle`);
      if (lbCycleEl) z.cyclesBeforeLongBreak = parseInt(lbCycleEl.value) || 4;
      const cyclesEl = document.getElementById(`ze-${i}-cycles`);
      if (cyclesEl) z.totalCycles = parseInt(cyclesEl.value) || 4;
      const startEl = document.getElementById(`ze-${i}-start`);
      if (startEl) z.startTime = startEl.value;
      const endEl = document.getElementById(`ze-${i}-end`);
      if (endEl) z.endTime = endEl.value;
      const colorEl = document.getElementById(`ze-${i}-color`);
      if (colorEl) z.color = colorEl.value;
      const tlEl = document.getElementById(`ze-${i}-tlim`);
      if (tlEl) z.timeLimit = parseInt(tlEl.value) || 180;
      z.cycleTitles = [];
      for (let ci = 0; ci < (z.totalCycles || 4); ci++) {
        const ctEl = document.getElementById(`ze-${i}-ct-${ci}`);
        z.cycleTitles.push(ctEl ? ctEl.value.trim() : '');
      }
    });

    let err = false;
    const badZones = [];
    zones.forEach((z, i) => {
      const total = calcZoneTotal(z);
      if (total > z.timeLimit) {
        err = true;
        badZones.push(z.title || `Zone ${i+1}`);
        const card = document.querySelectorAll('.zone-editor-card')[i];
        if (card) {
          card.style.borderColor = 'var(--danger)';
          card.style.boxShadow = '0 0 0 1px var(--danger)';
        }
      }
    });
    if (err) {
      toast(`⛔ ${badZones.join(', ')} total > max time limit`, 'error');
      return;
    }

    document.querySelectorAll('.zone-editor-card').forEach(card => {
      card.style.borderColor = '';
      card.style.boxShadow = '';
    });
    state.config.zones = zones;
    saveConfig();
    if (state.currentZoneIdx >= zones.length) state.currentZoneIdx = Math.max(0, zones.length - 1);
    rebuildZoneStates();
    toast('Schedule saved! Reset day to apply changes.', 'success');
  }

  function removeZone(idx) {
    const zones = getZones();
    if (zones.length <= 1) { toast('Cannot remove the only zone', 'warning'); return; }
    if (!confirm(`Remove "${zones[idx].title}"?`)) return;
    zones.splice(idx, 1);
    state.config.zones = zones;
    storage().set('config', state.config);
    saveConfig();
    if (state.currentZoneIdx >= zones.length) state.currentZoneIdx = Math.max(0, zones.length - 1);
    rebuildZoneStates();
    renderTabBody();
    toast('Zone removed', 'info');
  }

  function exportConfig() {
    const blob = new Blob([JSON.stringify(state.config, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = 'zone-config.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Config exported!', 'success');
  }

  function importConfig(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = parseImportedJSON(reader.result);
        if (!data.zones || !Array.isArray(data.zones) || data.zones.length === 0) {
          toast('Invalid config: no zones found', 'error'); return;
        }
        state.config = data;
        (state.config.zones || []).forEach((z, i) => {
          if (z.id == null) z.id = i + 1;
          if (z.timeLimit == null) z.timeLimit = z.type === 'buffer' ? 90 : 180;
          if (!z.cycleTitles) z.cycleTitles = [];
        });
        saveConfig();
        resetDay();
        renderAll();
        toast('Schedule imported!', 'success');
      } catch (e) { toast('Invalid JSON file', 'error'); }
    };
    reader.readAsText(file);
  }

  function clearStats() {
    if (confirm('Clear all study statistics?')) {
      state.stats = { totalSessions: 0, totalFocusMin: 0, dayStart: null, history: {} };
      state.tracking = { log: [], zoneStats: {}, sessionCount: 0, dailyZones: {}, archivedDaily: {} };
      storage().set('stats', state.stats);
      storage().set('tracking', state.tracking);
      saveUserDataToServer('stats');
      saveUserDataToServer('tracking');
      renderTabBody();
      toast('Stats cleared', 'info');
    }
  }

  async function resetAll() {
    if (!confirm('Reset all data? This cannot be undone.')) return;
    state._clearingData = true;
    if (_pendingHttpSave) { clearTimeout(_pendingHttpSave); _pendingHttpSave = null; }
    state.stats = { totalSessions: 0, totalFocusMin: 0, dayStart: null, history: {} };
    state.tracking = { log: [], zoneStats: {}, sessionCount: 0, dailyZones: {}, archivedDaily: {} };
    state.events = [];
    state.config = { identity: {}, zones: [] };
    state.settings = { notifEnabled: true, soundEnabled: true, quietMode: false, showDefaultEvents: true, theme: 'hacker', autoStartBreaks: true, flowMode: false, timerPreset: 'custom', soundPack: 'default' };
    state.examTrack = null;
    state.onboarded = false;
    state.byZone = {};
    state.dayComplete = false;
    state.currentZoneIdx = 0;
    stopTimer();
    // Clear server data first — send proper default shapes so init() doesn't
    // crash when it loads these back (e.g. tracking.zoneStats being undefined).
    try {
      await Promise.all([
        fetch('/api/config', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ zones: [], identity: {} }) }),
        fetch('/api/user-data', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ key: 'stats', value: state.stats }) }),
        fetch('/api/user-data', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ key: 'tracking', value: state.tracking }) }),
        fetch('/api/user-data', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ key: 'events', value: [] }) }),
        fetch('/api/user-data', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ key: 'settings', value: state.settings }) }),
        fetch('/api/user-data', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ key: 'session', value: { currentZoneIdx: 0, byZone: {}, dayComplete: false } }) }),
        fetch('/api/user-data', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ key: 'examTrack', value: null }) }),
        fetch('/api/user-data', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ key: 'examDates', value: [] }) }),
        fetch('/api/user-data', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ key: 'onboarded', value: false }) }),
      ]);
    } catch {}
    ['zu:', 'zg:', 'zone:'].forEach(p => {
      ['onboarded','config','session','stats','tracking','events','settings','examTrack','examDates'].forEach(k => {
        try { localStorage.removeItem(p + k); } catch {}
      });
    });
    // Save empty state to localStorage so beforeunload doesn't restore old data
    storage().set('onboarded', state.onboarded);
    storage().set('session', { currentZoneIdx: 0, byZone: {}, dayComplete: false });
    storage().set('events', []);
    storage().set('stats', state.stats);
    storage().set('tracking', state.tracking);
    storage().set('settings', state.settings);
    storage().set('config', state.config);
    storage().set('examTrack', null);
    storage().set('examDates', []);
    location.reload();
  }

  function logout() {
    state._clearingData = true;
    if (_pendingHttpSave) { clearTimeout(_pendingHttpSave); _pendingHttpSave = null; }
    fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(()=>{});
    ['zu:', 'zg:', 'zone:'].forEach(p => {
      ['onboarded','config','session','stats','tracking','events','settings','examTrack','examDates'].forEach(k => {
        try { localStorage.removeItem(p + k); } catch {}
      });
    });
    try { localStorage.removeItem('zone_user'); localStorage.removeItem('zone_guest'); } catch {}
    window.location.href = '/login.html';
  }

  async function generateResetKey() {
    try {
      const r = await fetchJSON('/api/admin/generate-reset-key', { method: 'POST' });
      const val = document.getElementById('resetKeyValue');
      const dsp = document.getElementById('resetKeyDisplay');
      if (val) val.textContent = r.key;
      if (dsp) dsp.style.display = 'block';
      toast('Reset key generated! Share it with the user.', 'success');
    } catch { toast('Failed to generate key', 'error'); }
  }

  async function syncExport() {
    try {
      const d = await fetchJSON('/api/sync/export');
      if (!d) return;
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url; a.download = 'zone-backup-' + Date.now() + '.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast('Backup downloaded!', 'success');
    } catch (e) { toast('Export failed: ' + e.message, 'error'); }
  }

  function syncImport() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const file = inp.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = parseImportedJSON(text);
        const r = await fetchJSON('/api/sync/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
        if (!r) return;
        if (r.errors && r.errors.length) toast('Restore with errors: ' + r.errors.join(', '), 'warning');
        else toast('Backup restored! Reloading…', 'success');
        setTimeout(() => location.reload(), 1000);
      } catch (e) { toast('Restore failed: ' + e.message, 'error'); }
    };
    inp.click();
  }



  // ─── WALLPAPER TAB ──────────────────────────
  const WALLPAPER_STYLES = {
    mission_control: { label: 'Mission Control', tag: 'PROFESSIONAL', bg: 'linear-gradient(180deg,#0A0E14,#0D131C)', panel: '#131920', line: '#232B36', textP: '#E7ECF2', textM: '#7C8896', radius: 14, borderW: 1.5, glowC: '#4ADE80', kicker: 'DAILY DISCIPLINE CONSOLE', swatch: '#4ADE80' },
    motivational_hustle: { label: 'Motivational Hustle', tag: 'MOTIVATIONAL', bg: 'radial-gradient(circle at 50% 0%,#2B0A05,#120302)', panel: '#1D0906', line: '#3A140C', textP: '#FFF3EC', textM: '#D89A7E', radius: 8, borderW: 2, glowC: '#FF8A3D', kicker: 'NO ZERO DAYS', swatch: '#FF8A3D' },
    minimal_editorial: { label: 'Minimal Editorial', tag: 'PROFESSIONAL', bg: '#F5F3EE', panel: '#FFFFFF', line: '#DAD5C9', textP: '#1B1B1B', textM: '#8A8578', radius: 0, borderW: 1, kicker: 'DAILY SCHEDULE', swatch: '#1B1B1B' },
    neon_cyberpunk: { label: 'Neon Cyberpunk', tag: 'EDGY', bg: '#05060A', panel: '#0B0E16', line: '#1E2440', textP: '#E9F9FF', textM: '#7B8FC9', radius: 4, borderW: 1.5, glowC: '#FF2DAF', kicker: 'SYSTEM: FOCUS.EXE', swatch: '#FF2DAF' },
    retro_terminal: { label: 'Retro Terminal', tag: 'EDGY', bg: '#020402', panel: '#041006', line: '#0F3D1D', textP: '#33FF66', textM: '#1FA043', radius: 0, borderW: 2, glowC: '#33FF66', kicker: '> SYSTEM READY_', swatch: '#33FF66' },
    nature_calm: { label: 'Nature Calm', tag: 'CALM', bg: '#EDEAE0', panel: '#F7F5EC', line: '#C9CBB8', textP: '#33402F', textM: '#7C8567', radius: 24, borderW: 1.5, kicker: 'STEADY, NOT RUSHED', swatch: '#4B6B53' },
    cosmic_space: { label: 'Cosmic Space', tag: 'CALM', bg: 'linear-gradient(180deg,#0B0620,#1A0B3D)', panel: '#150A33', line: '#332065', textP: '#EDE9FE', textM: '#A594D1', radius: 16, borderW: 1.5, glowC: '#C4B5FD', kicker: 'ORBIT ONE DAY AT A TIME', swatch: '#C4B5FD' },
    journal_notebook: { label: 'Journal Notebook', tag: 'CALM', bg: '#FBF6EC', panel: '#FFFDF7', line: '#E4D9BF', textP: '#2B3A55', textM: '#8A7E63', radius: 6, borderW: 1.2, kicker: "today's plan", swatch: '#E07856' },
    athletic_bold: { label: 'Athletic Bold', tag: 'MOTIVATIONAL', bg: '#0D0D0D', panel: '#161616', line: '#2B2B2B', textP: '#F5F5F5', textM: '#9A9A9A', radius: 2, borderW: 2.5, glowC: '#E11D2E', kicker: 'TRAIN THE DISCIPLINE', swatch: '#E11D2E' },
    corporate_dashboard: { label: 'Corporate Dashboard', tag: 'PROFESSIONAL', bg: '#0F1B2D', panel: '#FFFFFF', line: '#D7DEE8', textP: '#1F2937', textM: '#64748B', radius: 12, borderW: 0, kicker: 'PERFORMANCE PLAN', swatch: '#2563EB' }
  };

  function renderWallpaperTab() {
    const body = document.getElementById('tabBody');
    body.innerHTML = `
      <div class="wp-layout">
        <div class="wp-preview-wrap">
          <div class="wp-size-toggle">
            <button class="wp-size-btn ${state.wpSize === 'mobile' ? 'active' : ''}" onclick="ZoneApp.setWpSize('mobile')">MOBILE</button>
            <button class="wp-size-btn ${state.wpSize === 'desktop' ? 'active' : ''}" onclick="ZoneApp.setWpSize('desktop')">DESKTOP</button>
          </div>
          <div class="wp-canvas-frame"><div id="wpPoster" class="wp-poster"></div></div>
          <div class="wp-actions">
            <button class="ctl primary" onclick="ZoneApp.downloadWallpaper()">⬇ DOWNLOAD PNG</button>
          </div>
        </div>
        <div class="wp-style-list" id="wpStyleList"></div>
      </div>`;
    renderWpStyleList();
    buildPoster();
  }

  function renderWpStyleList() {
    const list = document.getElementById('wpStyleList');
    if (!list) return;
    list.innerHTML = Object.entries(WALLPAPER_STYLES).map(([key, s]) => `
      <button class="wp-style-btn ${state.wpStyle === key ? 'active' : ''}" onclick="ZoneApp.selectWpStyle('${key}')">
        <span class="wp-swatch" style="background:${s.swatch}"></span>
        <span><span class="wp-style-name">${s.label}</span><br><span class="wp-style-tag">${s.tag}</span></span>
      </button>`).join('');
  }

  function selectWpStyle(key) { state.wpStyle = key; renderWpStyleList(); buildPoster(); }
  function setWpSize(size) { state.wpSize = size; renderWallpaperTab(); }

  function toggleSidebar() { state.sidebarOpen = !state.sidebarOpen; renderConsoleTab(); }
  function toggleFullscreen() {
    state.fullscreen = !state.fullscreen;
    document.body.classList.toggle('fs-active', state.fullscreen);
    if (state.fullscreen) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (state.tab !== 'console') return;
    if (e.code === 'KeyF') { e.preventDefault(); toggleFullscreen(); }
    if (e.code === 'Escape' && state.fullscreen) { toggleFullscreen(); }
    if (e.code === 'KeyS') { e.preventDefault(); toggleSidebar(); }
    if (e.code === 'ArrowRight') { e.preventDefault(); const n = state.currentZoneIdx + 1; if (n < getZones().length) selectZone(n); }
    if (e.code === 'ArrowLeft') { e.preventDefault(); const p = state.currentZoneIdx - 1; if (p >= 0) selectZone(p); }
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && state.fullscreen) { state.fullscreen = false; document.body.classList.remove('fs-active'); }
  });

  function cardHTML(s, z, desktop, idx) {
    const accent = s.glowC || z.color;
    return `<div class="wp-card" style="background:${s.panel};border:${s.borderW}px solid ${s.line};border-radius:${s.radius}px">
      <div class="wp-card-accent" style="background:${accent}"></div>
      <div class="wp-card-top">
        <span class="wp-card-num" style="color:${accent}">${String(z.id ?? idx + 1).padStart(2,'0')}</span>
        <span class="wp-card-badge" style="color:${accent};border-color:${accent}">${esc(z.type || 'SOLVE')}</span>
      </div>
      <div class="wp-card-name" style="color:${s.textP}">${esc(z.title)}</div>
      <div class="wp-card-time" style="color:${s.textM}">${to12h(z.startTime)} — ${to12h(z.endTime)}</div>
      <div class="wp-card-blocks" style="color:${s.textM}">
        <span>FOCUS</span><span style="color:${s.textP}">${z.focusDuration || 25}m × ${z.totalCycles || 3}</span>
      </div>
    </div>`;
  }

  function buildPoster() {
    const s = WALLPAPER_STYLES[state.wpStyle];
    if (!s) return;
    const meta = state.config?.identity || {};
    const zones = getZones();
    const desktop = state.wpSize === 'desktop';
    const el = document.getElementById('wpPoster');
    if (!el) return;
    el.className = 'wp-poster' + (desktop ? ' desktop' : '');
    el.style.background = s.bg;
    el.style.color = s.textP;

    let cardsHTML;
    if (desktop && zones.length > 0) {
      const rows = zones.length <= 3 ? [zones.length] : [Math.min(Math.ceil(zones.length/2), 3), zones.length - Math.min(Math.ceil(zones.length/2), 3)];
      let zi = 0;
      cardsHTML = rows.map(count => {
        const rowZones = zones.slice(zi, zi + count);
        const baseIdx = zi;
        zi += count;
        return `<div class="wp-row">${rowZones.map((z, ri) => cardHTML(s, z, desktop, baseIdx + ri)).join('')}</div>`;
      }).join('');
    } else {
      cardsHTML = zones.map((z, i) => cardHTML(s, z, desktop, i)).join('');
    }

    el.innerHTML = `
      <div style="position:relative;z-index:1">
        <div class="wp-kicker" style="color:${s.textM}">${esc(s.kicker)}</div>
        <div class="wp-title">${esc(meta.goalName || 'STUDY PLAN')}</div>
        <div class="wp-hr" style="background:${s.line}"></div>
        <div class="wp-sub" style="color:${s.textM}">
          <span>${zones.length} ZONES</span>
          <span>${desktop ? 'DESKTOP' : 'MOBILE'}</span>
        </div>
      </div>
      <div class="wp-cards">${cardsHTML}</div>
      <div class="wp-footer-txt" style="color:${s.textM}">
        <div>ZONE STUDY OS · ${esc(meta.examTrack || 'FOCUS')}</div>
      </div>`;
  }

  function downloadWallpaper() {
    const el = document.getElementById('wpPoster');
    if (!window.html2canvas) { toast('html2canvas not loaded', 'error'); return; }
    const scale = state.wpSize === 'desktop' ? 4 : 3.6;
    html2canvas(el, { scale, backgroundColor: null }).then(canvas => {
      canvas.toBlob(blob => {
        if (!blob) { toast('Could not generate image', 'error'); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `zone-${state.wpStyle}-${state.wpSize}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        toast('Wallpaper downloaded!', 'success');
      });
    }).catch(() => toast('Could not render wallpaper', 'error'));
  }

  // ─── Server timer sync (desktop overlay) ─────
  let _lastSeenControlTs = 0;
  let _serverPollHandle = null;

  async function _pollTimerState() {
    if (isGuest()) return;
    try {
      const data = await fetchJSON('/api/timer/state');
      if (!data || !data.session) return;
      const serverSession = data.session;

      // 1. Apply desktop control actions (pause/start/stop/skip)
      const lc = serverSession.lastControl;
      if (lc && lc.ts > _lastSeenControlTs) {
        _lastSeenControlTs = lc.ts;
        _applyServerControl(lc.action, serverSession);
      }

      // 2. Always reconcile running state with server
      const zs = getCurrentZs();
      const sZs = (serverSession.byZone || {})[String(state.currentZoneIdx)];
      if (sZs && zs) {
        // If server says running but browser isn't — start the interval
        if (sZs.running && !state.timerHandle && zs.remaining > 0) {
          zs.running = true;
          zs.lastTick = Date.now();
          state.timerHandle = setInterval(timerTick, 1000);
          renderControls();
          renderSidebar();
          updateTimerDisplay();
        }
        // If server says not running but browser is — stop it
        else if (!sZs.running && zs.running) {
          zs.running = false;
          stopTimer();
          renderControls();
          renderSidebar();
          updateTimerDisplay();
        }
      }
    } catch {}
  }

  function _applyServerControl(action, serverSession) {
    const zs = getCurrentZs();
    const sZs = (serverSession.byZone || {})[String(state.currentZoneIdx)];
    if (!zs || !sZs) return;

    if (action === 'pause') {
      zs.running = false;
      stopTimer();
      renderControls();
      renderSidebar();
    } else if (action === 'stop') {
      zs.running = false;
      stopTimer();
      zs.remaining = sZs.total || zs.total || 25 * 60;
      zs.total = sZs.total || zs.total || 25 * 60;
      zs.elapsed = 0;
      zs.zoneElapsed = 0;
      zs.blockComplete = false;
      zs.overtimeSeconds = 0;
      renderAll();
    } else if (action === 'skip') {
      // Apply server state directly instead of calling timerSkip (avoids double-logging)
      zs.running = false;
      stopTimer();
      zs.blockType = sZs.blockType;
      zs.remaining = sZs.remaining;
      zs.total = sZs.total;
      zs.cycle = sZs.cycle;
      zs.elapsed = 0;
      zs.blockComplete = false;
      zs.overtimeSeconds = 0;
      renderAll();
    } else if (action === 'start') {
      if (!state.timerHandle && zs.remaining > 0) {
        zs.running = true;
        zs.lastTick = Date.now();
        state.timerHandle = setInterval(timerTick, 1000);
        renderControls();
        renderSidebar();
        updateTimerDisplay();
      }
    }
  }

  // ─── INIT ────────────────────────────────────
  async function init() {
    $root = document.getElementById('app-root');
    $toastContainer = document.createElement('div');
    $toastContainer.className = 'toast-container';
    document.body.appendChild($toastContainer);
    $root.innerHTML = '<div class="init-loader"><div class="init-spinner"></div><div class="init-text">Loading Zone OS…</div></div>';

    try {
      const [cfg, tr, au] = await Promise.all([apiConfig(), apiTracks(), fetchJSON('/api/auth-check')]);
      if (!cfg || !tr || !au) return;
      state.config = cfg; state.tracks = tr.tracks;
      state.isAdmin = au.isAdmin;
      state.username = au.username;

      // Cross-device sync: server config is ALWAYS the source of truth for
      // authenticated users. localStorage config is only used as fallback when
      // server config is empty (fresh account, no saves yet).
      const savedCfg = storage().get('config');
      if (!state.config?.zones?.length && savedCfg?.zones?.length) {
        state.config.zones = savedCfg.zones;
      }
      if (savedCfg?.identity && (!state.config.identity || !Object.keys(state.config.identity).length)) {
        Object.assign(state.config.identity ??= {}, savedCfg.identity);
      }
      // Always update localStorage cache with server config so it stays fresh
      if (state.config) storage().set('config', state.config);

      (state.config.zones || []).forEach(z => {
        if (z.timeLimit == null) z.timeLimit = z.type === 'buffer' ? 90 : 180;
        if (!z.cycleTitles) z.cycleTitles = [];
      });
    } catch (e) {
      $root.innerHTML = '<div style="padding:40px;text-align:center"><h2>Failed to load</h2><p>Check that the server is running.</p></div>';
      return;
    }

    // ── Step 1: Load server data FIRST for authenticated users (source of truth) ──
    let serverData = null;
    if (!isGuest()) {
      try {
        serverData = await fetchJSON('/api/user-data');
      } catch {}
    }

    // ── Step 1.5: Load local tracking so the merge below has both sides ──
    if (!isGuest()) {
      try {
        const localTracking = storage().get('tracking');
        if (localTracking) {
          if (!Array.isArray(localTracking.log)) localTracking.log = [];
          state.tracking = localTracking;
        }
      } catch {}
    }

    // ── Step 2: Apply server data (server wins for everything except tracking.log merge) ──
    if (serverData) {
      if (serverData.session) {
        storage().set('session', serverData.session);
      }
      if (serverData.stats) {
        storage().set('stats', serverData.stats);
        state.stats = serverData.stats;
      }
      if (serverData.tracking) {
        // Tracking log: ID-based merge (log entries are append-only, both sides valid)
        const localLog = state.tracking.log || [];
        const serverLog = serverData.tracking.log || [];
        const localIds = new Set(localLog.map(e => e.id));
        const merged = [...serverLog.filter(e => !localIds.has(e.id)), ...localLog];
        merged.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        serverData.tracking.log = merged;
        if (!serverData.tracking.archivedDaily) serverData.tracking.archivedDaily = {};
        const localArchived = state.tracking.archivedDaily || {};
        Object.keys(localArchived).forEach(k => {
          if (!serverData.tracking.archivedDaily[k]) serverData.tracking.archivedDaily[k] = localArchived[k];
        });
        storage().set('tracking', serverData.tracking);
        state.tracking = serverData.tracking;
      }
      // Events: server is complete source of truth (no merge — deletions must propagate)
      if (serverData.events && Array.isArray(serverData.events)) {
        storage().set('events', serverData.events);
        state.events = serverData.events;
      }
      if (serverData.settings) {
        storage().set('settings', serverData.settings);
        state.settings = serverData.settings;
        applyTheme(state.settings.theme || 'hacker');
      }
      if (serverData.examTrack) {
        storage().set('examTrack', serverData.examTrack);
        state.examTrack = serverData.examTrack;
      }
      if (serverData.examDates) {
        storage().set('examDates', serverData.examDates);
        state.examDates = serverData.examDates;
      }
      if (serverData.onboarded) {
        storage().set('onboarded', true);
        state.onboarded = true;
      }
    }

    // ── Step 3: localStorage fallback only for things server didn't return ──
    if (!isGuest() && serverData) {
      // Server data loaded — localStorage cache is stale, skip it
    } else {
      // Guest or server unavailable — use localStorage
      const savedSettings = storage().get('settings');
      if (savedSettings) Object.assign(state.settings, savedSettings);

      const savedEvents = storage().get('events');
      if (Array.isArray(savedEvents)) state.events = savedEvents;

      const savedStats = storage().get('stats');
      if (savedStats) { if (typeof savedStats.totalSessions !== 'number') savedStats.totalSessions = 0; if (typeof savedStats.totalFocusMin !== 'number') savedStats.totalFocusMin = 0; Object.assign(state.stats, savedStats); }

      const savedTracking = storage().get('tracking');
      if (savedTracking) { if (!Array.isArray(savedTracking.log)) savedTracking.log = []; Object.assign(state.tracking, savedTracking); }

      const savedExam = storage().get('examTrack');
      if (savedExam) state.examTrack = savedExam;

      const savedExamDates = storage().get('examDates');
      if (savedExamDates) state.examDates = savedExamDates;

      if (storage().get('onboarded')) {
        state.onboarded = true;
      }
    }
    // Always init theme effects
    applyTheme(state.settings.theme || 'hacker');
    initThemeEffects();

    if (state.onboarded) {
      // Load session to restore timer states (byZone, currentZoneIdx, etc.)
      // state.onboarded is set from serverData (Step 2) or localStorage (Step 3 fallback)
      const sess = loadSession();
      if (sess && sess.byZone) {
        const today = todayKey();
        if (sess.date && sess.date !== today) {
          // Save previous day's zone completion snapshot
          const zones = getZones();
          if (zones.length > 0) {
            if (!state.tracking.dailyZones) state.tracking.dailyZones = {};
            if (!state.tracking.dailyZones[sess.date]) {
              state.tracking.dailyZones[sess.date] = {
                completed: zones.map((z, i) => !!(sess.byZone[i]?.completed)),
                dayComplete: !!sess.dayComplete
              };
            }
          }
          // Catch up elapsed time for any running zone from the previous day
          // and log session_stop so events aren't left dangling
          if (sess.byZone) {
            Object.keys(sess.byZone).forEach(k => {
              const zs = sess.byZone[k];
              if (zs && zs.running && zs.lastTick) {
                const elapsedSec = Math.max(0, Math.floor((Date.now() - zs.lastTick) / 1000));
                if (elapsedSec > 0) {
                  zs.elapsed = (zs.elapsed || 0) + elapsedSec;
                  zs.zoneElapsed = (zs.zoneElapsed || 0) + elapsedSec;
                  zs.remaining = Math.max(0, zs.remaining - elapsedSec);
                }
                // Log a partial session_stop for the in-progress block
                logEvent('session_stop', {
                  zoneIdx: parseInt(k),
                  date: sess.date,
                  reason: 'cross_midnight',
                  elapsed: zs.elapsed || 0
                });
                zs.running = false;
              }
            });
          }
          state.dayComplete = false;
          state.currentZoneIdx = 0;
          rebuildZoneStates();
        } else {
          state.byZone = sess.byZone;
          if (sess.currentZoneIdx != null) state.currentZoneIdx = sess.currentZoneIdx;
          if (state.currentZoneIdx >= getZones().length || state.currentZoneIdx < 0) state.currentZoneIdx = 0;
          state.dayComplete = !!sess.dayComplete;
          const zs = getCurrentZs();
          if (zs && zs.running) {
            const elapsedSec = zs.lastTick ? Math.max(0, Math.floor((Date.now() - zs.lastTick) / 1000)) : 0;
            if (elapsedSec > 0) {
              zs.elapsed = (zs.elapsed || 0) + elapsedSec;
              zs.zoneElapsed = (zs.zoneElapsed || 0) + elapsedSec;
              zs.remaining = Math.max(0, zs.remaining - elapsedSec);
            }
            zs.lastTick = Date.now();
            if (zs.remaining <= 0 && zs.blockComplete) {
              // Resume overtime counting — block was already completed before reload
              zs.running = true;
              state.timerHandle = setInterval(timerTick, 1000);
            } else if (zs.remaining <= 0) {
              zs.running = false;
              handleBlockComplete();
            } else {
              state.timerHandle = setInterval(timerTick, 1000);
            }
          }
        }
      } else {
        rebuildZoneStates();
      }
    }

    render();
    window.addEventListener('beforeunload', e => {
      if (!state._clearingData) forceSave();
      const zs = getCurrentZs();
      if (zs && zs.running) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const modals = document.querySelectorAll('.modal-overlay');
        if (modals.length) modals[modals.length - 1].remove();
        return;
      }
      if (e.key === ' ' && state.tab === 'console') {
        // Don't hijack spacebar when a button/link/select is focused — let native behavior fire
        const tag = e.target?.tagName;
        if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT') return;
        if (e.target?.getAttribute('role') === 'button') return;
        e.preventDefault();
        timerToggle();
      }
    });
    setInterval(saveState, 5000);
    setInterval(tickClock, 1000);
    // Poll server for timer control from desktop overlay
    if (!isGuest()) _serverPollHandle = setInterval(_pollTimerState, 3000);
  }

  return {
    init, render, renderTabBody,
    switchTab, selectZone, jumpToCycle,
    timerToggle, timerStart, timerPause, timerSkip, timerReset,
    markZoneComplete, resetZone, resetDay,
    continueDay, continueSkippedZone, showContinueOptions,
    toast,
    openOnboarding, selectExamTrack, confirmExamTrack, closeModal, skipOnboarding,
    showAddEvent, saveEvent, deleteEvent,
    showEditEvent, updateEvent,
    calPrev, calNext, calToday, showDayMenu, setCalDate, clearTimeTravel,
    closeAndAddEvent, closeAndEditEvent,
    exportEvents, importEvents, exportConfig, importConfig,
    toggleSetting, clearStats, resetAll, logout,
    syncExport, syncImport,
    saveGoalName, editTitleInline, generateResetKey,
    changePassword, changeUsername,
    onZoneTypeChange, recalcHint, syncCycleNames, saveZoneEdits, removeZone, addZone,
    selectWpStyle, setWpSize, downloadWallpaper, buildPoster,
    toggleSidebar, toggleFullscreen,
    refreshCharts, scrollToChart, showDayDetail,
    openExamDateEditor, saveExamDates,
    setCountdownMode,
    applyTheme, setTheme,
    takeBreak, setSetting, applyPreset
  };
})();

document.addEventListener('DOMContentLoaded', () => ZoneApp.init());
