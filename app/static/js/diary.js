/* ═══════════════════════════════════════════════════════════
   Zone Diary — Full journal module
   View mode, attachments (images/video/PDF/MD), markdown
   Standalone module, hooks into ZoneApp via _ctx
   ═══════════════════════════════════════════════════════════ */
;(function () {
  'use strict';

  /* ── Helpers ──────────────────────────────────────────── */
  function ctx()     { return ZoneApp._ctx; }
  function state()   { return ctx().state; }
  function esc(s)    { return ctx().esc(s); }
  function todayKey(){ return ctx().todayKey(); }
  function toast(m,t){ ctx().toast(m, t); }

  function entries() { return state().diary || (state().diary = []); }

  const MOODS = {
    great:   { e: '😄', l: 'Great' },
    good:    { e: '🙂', l: 'Good' },
    neutral: { e: '😐', l: 'Neutral' },
    low:     { e: '😔', l: 'Low' },
    bad:     { e: '😢', l: 'Bad' }
  };
  const PROMPTS = [
    'What went well today?',
    'What did I learn today?',
    'What challenged me today?',
    'What am I grateful for?',
    'What will I do differently tomorrow?'
  ];

  const ATTACH_MAX_MB = 100;
  const ATTACH_EXTENSIONS = ['jpg','jpeg','png','gif','webp','svg','bmp','tiff','mp4','webm','mov','avi','pdf','md','txt'];

  /* ── State ────────────────────────────────────────────── */
  let _sel       = null;
  let _mood      = null;
  let _tags      = [];
  let _calY, _calM;
  let _search    = '';
  let _fltMood   = '';
  let _delTarget = null;
  let _viewDate  = null;
  let _viewMode  = false;   // true = read-only view mode
  let _dragOver  = false;

  function initCal(){ const n=new Date(); _calY=n.getFullYear(); _calM=n.getMonth(); }
  initCal();

  /* ── CRUD ─────────────────────────────────────────────── */
  function create(date) {
    const d = date || todayKey();
    const e = {
      id: _uid(), date: d, title: '', content: '',
      mood: null, tags: [], attachments: [],
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    };
    entries().unshift(e);
    _sel = e.id; _mood = null; _tags = []; _viewMode = false;
    saveDiary();
    renderDiaryTab();
    setTimeout(()=>{ const el=document.getElementById('diaTitle'); if(el) el.focus(); },50);
  }

  function save() {
    const e = entries().find(x=>x.id===_sel);
    if(!e) return;
    const title   = (document.getElementById('diaTitle')?.value||'').trim();
    const content = (document.getElementById('diaContent')?.value||'').trim();
    const date    = document.getElementById('diaDate')?.value || e.date;
    if(!title && !content){ toast('Write something first!','warning'); return; }
    e.title   = title;
    e.content = content;
    e.date    = date;
    e.mood    = _mood;
    e.tags    = [..._tags];
    e.updated = new Date().toISOString();
    if(!e.attachments) e.attachments = [];
    _viewMode = true;  // switch to view mode after save
    saveDiary();
    renderDiaryTab();
    toast('💾 Saved','success');
  }

  function remove(id) {
    const e = entries().find(x=>x.id===id);
    if(!e) return;
    _delTarget = id;
    openDelModal(e);
  }

  function confirmDel() {
    if(!_delTarget) return;
    state().diary = entries().filter(x=>x.id!==_delTarget);
    if(_sel===_delTarget){ _sel=null; _mood=null; _tags=[]; _viewMode=false; }
    _delTarget = null;
    saveDiary(); closeDelModal(); renderDiaryTab();
    toast('Deleted','info');
  }

  function select(id) {
    const e = entries().find(x=>x.id===id);
    if(!e) return;
    _sel = id; _mood = e.mood; _tags = [...(e.tags||[])];
    _viewMode = true;  // default: view mode when selecting
    renderDiaryTab();
  }

  function toggleViewMode() {
    _viewMode = !_viewMode;
    renderDiaryTab();
  }

  /* ── Save to storage + server ─────────────────────────── */
  function saveDiary() {
    try { ctx().storage().set('diary', entries()); } catch {}
    try { fetch('/api/user-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'diary',value:entries()})}); } catch {}
  }

  /* ── Attachments ──────────────────────────────────────── */
  function uploadAttachment(file) {
    const ext = (file.name||'').split('.').pop().toLowerCase();
    if(!ATTACH_EXTENSIONS.includes(ext)) {
      toast(`File type .${ext} not supported`, 'error');
      return;
    }
    if(file.size > ATTACH_MAX_MB * 1024 * 1024) {
      toast(`File too large (max ${ATTACH_MAX_MB}MB)`, 'error');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    toast('Uploading...', 'info');

    fetch('/api/diary/upload', { method: 'POST', body: fd })
      .then(r => r.json())
      .then(data => {
        if(!data.ok) throw new Error(data.detail || 'Upload failed');
        const e = entries().find(x=>x.id===_sel);
        if(!e) return;
        if(!e.attachments) e.attachments = [];
        e.attachments.push({
          fileId: data.fileId,
          name: data.originalName,
          size: data.size,
          type: data.type,
          url: data.url
        });
        e.updated = new Date().toISOString();
        saveDiary();
        renderDiaryTab();
        toast('📎 Attached!', 'success');
      })
      .catch(err => {
        toast('Upload failed: ' + err.message, 'error');
      });
  }

  function removeAttachment(fileId) {
    const e = entries().find(x=>x.id===_sel);
    if(!e || !e.attachments) return;
    // Delete from server
    fetch('/api/diary/attachment/' + fileId, { method: 'DELETE' }).catch(()=>{});
    e.attachments = e.attachments.filter(a => a.fileId !== fileId);
    e.updated = new Date().toISOString();
    saveDiary();
    renderDiaryTab();
    toast('Attachment removed', 'info');
  }

  function handleFileDrop(e2) {
    e2.preventDefault(); e2.stopPropagation();
    _dragOver = false;
    const files = e2.dataTransfer?.files;
    if(files) { for(const f of files) uploadAttachment(f); }
  }
  function handleFileDragOver(e2) { e2.preventDefault(); e2.stopPropagation(); _dragOver = true; }
  function handleFileDragLeave(e2) { e2.preventDefault(); e2.stopPropagation(); _dragOver = false; }

  function triggerFileInput() {
    const inp = document.getElementById('diaAttachInp');
    if(inp) inp.click();
  }
  function onFileInputChange(ev) {
    const files = ev.target.files;
    if(files) { for(const f of files) uploadAttachment(f); }
    ev.target.value = '';
  }

  /* ── Markdown Renderer ────────────────────────────────── */
  function renderMd(text) {
    if(!text) return '';
    let h = esc(text);
    // Code blocks (```)
    h = h.replace(/```([\s\S]*?)```/g, '<pre class="dia-md-code"><code>$1</code></pre>');
    // Inline code
    h = h.replace(/`([^`]+)`/g, '<code class="dia-md-inline">$1</code>');
    // Headers
    h = h.replace(/^### (.+)$/gm, '<h4 class="dia-md-h">$1</h4>');
    h = h.replace(/^## (.+)$/gm, '<h3 class="dia-md-h">$1</h3>');
    h = h.replace(/^# (.+)$/gm, '<h2 class="dia-md-h">$1</h2>');
    // Bold + italic
    h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Strikethrough
    h = h.replace(/~~(.+?)~~/g, '<del>$1</del>');
    // Blockquote
    h = h.replace(/^&gt; (.+)$/gm, '<blockquote class="dia-md-quote">$1</blockquote>');
    // Unordered lists
    h = h.replace(/^[\-\*] (.+)$/gm, '<li class="dia-md-li">$1</li>');
    // Ordered lists
    h = h.replace(/^\d+\. (.+)$/gm, '<li class="dia-md-li dia-md-oli">$1</li>');
    // Wrap consecutive li's in ul
    h = h.replace(/((?:<li class="dia-md-li(?:\s+dia-md-oli)?">.*<\/li>\n?)+)/g, '<ul class="dia-md-list">$1</ul>');
    // Links
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="dia-md-link" href="$2" target="_blank" rel="noopener">$1</a>');
    // Horizontal rule
    h = h.replace(/^---+$/gm, '<hr class="dia-md-hr">');
    // Line breaks → paragraphs (double newline = paragraph)
    h = h.replace(/\n\n/g, '</p><p class="dia-md-p">');
    h = h.replace(/\n/g, '<br>');
    h = '<p class="dia-md-p">' + h + '</p>';
    // Clean empty p tags
    h = h.replace(/<p class="dia-md-p"><\/p>/g, '');
    h = h.replace(/<p class="dia-md-p">(<h[234]|<hr|<pre|<ul|<blockquote)/g, '$1');
    h = h.replace(/(<\/h[234]>|<\/pre>|<\/ul>|<\/blockquote>)<\/p>/g, '$1');
    return h;
  }

  /* ── Attachments Renderer ─────────────────────────────── */
  function renderAttachments(att, editable) {
    if(!att || att.length === 0) return '';
    const items = att.map(a => {
      const isImg = /\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff)$/i.test(a.name);
      const isVid = /\.(mp4|webm|mov|avi)$/i.test(a.name);
      const isPdf = /\.pdf$/i.test(a.name);
      const isMd  = /\.(md|txt)$/i.test(a.name);
      const sizeStr = a.size > 1024*1024 ? (a.size/(1024*1024)).toFixed(1)+'MB' : a.size > 1024 ? Math.round(a.size/1024)+'KB' : a.size+'B';
      const rmBtn = editable ? `<button class="dia-att-rm" onclick="event.stopPropagation();ZoneApp._diaRmAttach('${a.fileId}')" title="Remove">✕</button>` : '';

      if(isImg) {
        return `<div class="dia-att-card dia-att-img" onclick="ZoneApp._diaLightbox('${esc(a.url)}','${esc(a.name)}')">
          ${rmBtn}
          <img src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy">
          <div class="dia-att-info"><span class="dia-att-name">${esc(a.name)}</span><span class="dia-att-size">${sizeStr}</span></div>
        </div>`;
      }
      if(isVid) {
        return `<div class="dia-att-card dia-att-vid">
          ${rmBtn}
          <video controls preload="metadata" src="${esc(a.url)}"></video>
          <div class="dia-att-info"><span class="dia-att-name">${esc(a.name)}</span><span class="dia-att-size">${sizeStr}</span></div>
        </div>`;
      }
      if(isPdf) {
        return `<div class="dia-att-card dia-att-doc" onclick="window.open('${esc(a.url)}','_blank')">
          ${rmBtn}
          <div class="dia-att-icon">📄</div>
          <div class="dia-att-info"><span class="dia-att-name">${esc(a.name)}</span><span class="dia-att-size">${sizeStr}</span></div>
        </div>`;
      }
      if(isMd) {
        return `<div class="dia-att-card dia-att-doc" onclick="ZoneApp._diaPreviewMd('${esc(a.url)}','${esc(a.name)}')">
          ${rmBtn}
          <div class="dia-att-icon">📝</div>
          <div class="dia-att-info"><span class="dia-att-name">${esc(a.name)}</span><span class="dia-att-size">${sizeStr}</span></div>
        </div>`;
      }
      // Generic file
      return `<div class="dia-att-card dia-att-doc" onclick="window.open('${esc(a.url)}','_blank')">
        ${rmBtn}
        <div class="dia-att-icon">📎</div>
        <div class="dia-att-info"><span class="dia-att-name">${esc(a.name)}</span><span class="dia-att-size">${sizeStr}</span></div>
      </div>`;
    }).join('');

    return `<div class="dia-atts-section">
      <div class="dia-atts-hdr"><span class="dia-atts-lbl">📎 ATTACHMENTS</span><span class="dia-atts-cnt">${att.length}</span></div>
      <div class="dia-atts-grid">${items}</div>
    </div>`;
  }

  /* ── Lightbox ─────────────────────────────────────────── */
  function openLightbox(url, name) {
    closeAnyModal();
    const o = document.createElement('div');
    o.className = 'dia-modal-bg dia-lightbox-bg'; o.id = 'diaLightbox';
    o.innerHTML = `<div class="dia-lightbox-inner" onclick="event.stopPropagation()">
      <button class="dia-lightbox-close" onclick="ZoneApp._diaCloseLb()">✕</button>
      <img src="${esc(url)}" alt="${esc(name||'')}" class="dia-lightbox-img">
      <div class="dia-lightbox-name">${esc(name||'')}</div>
    </div>`;
    document.body.appendChild(o);
    o.addEventListener('click', e => { if(e.target===o) closeAnyModal(); });
  }

  /* ── MD Preview Modal ─────────────────────────────────── */
  async function previewMd(url, name) {
    closeAnyModal();
    try {
      const r = await fetch(url);
      const text = await r.text();
      const o = document.createElement('div');
      o.className = 'dia-modal-bg'; o.id = 'diaMdPreview';
      o.innerHTML = `<div class="dia-modal" style="max-width:640px">
        <div class="dia-modal-hdr"><h3>📝 ${esc(name)}</h3><button class="dia-x" onclick="ZoneApp._diaCloseMd()">✕</button></div>
        <div class="dia-modal-body">
          <div class="dia-md-preview-content">${renderMd(text)}</div>
        </div>
        <div class="dia-modal-foot">
          <button class="dia-ctl" onclick="ZoneApp._diaCloseMd()">Close</button>
          <a class="dia-ctl primary" href="${esc(url)}" target="_blank" download>Open Raw</a>
        </div></div>`;
      document.body.appendChild(o);
      o.addEventListener('click', e => { if(e.target===o) closeAnyModal(); });
    } catch(err) {
      toast('Failed to load markdown', 'error');
    }
  }

  /* ── Delete Modal ─────────────────────────────────────── */
  function openDelModal(entry) {
    closeDelModal();
    const o = document.createElement('div');
    o.className = 'dia-modal-bg'; o.id = 'diaDelModal';
    o.innerHTML = `<div class="dia-modal">
      <div class="dia-modal-hdr"><h3>🗑 Delete</h3><button class="dia-x" onclick="ZoneApp._diaCloseDel()">✕</button></div>
      <div class="dia-modal-body">
        <p>Delete "<strong>${esc(entry.title||'Untitled')}</strong>" (${entry.date})?</p>
        <p style="margin-top:4px;font-size:10px;color:var(--text-muted)">This cannot be undone. Attachments will also be deleted.</p>
      </div>
      <div class="dia-modal-foot">
        <button class="dia-ctl" onclick="ZoneApp._diaCloseDel()">Cancel</button>
        <button class="dia-ctl danger" onclick="ZoneApp._diaConfirmDel()">Delete</button>
      </div></div>`;
    document.body.appendChild(o);
    o.addEventListener('click',e=>{ if(e.target===o) closeDelModal(); });
  }
  function closeDelModal(){ const m=document.getElementById('diaDelModal'); if(m) m.remove(); }

  /* ── Export Modal ─────────────────────────────────────── */
  function openExportModal() {
    closeAnyModal();
    const o = document.createElement('div');
    o.className = 'dia-modal-bg'; o.id = 'diaExportModal';
    o.innerHTML = `<div class="dia-modal">
      <div class="dia-modal-hdr"><h3>⬇ Export Diary</h3><button class="dia-x" onclick="ZoneApp._diaCloseExport()">✕</button></div>
      <div class="dia-modal-body">
        <div class="dia-export-row">
          <div class="dia-export-opt selected" data-scope="all" onclick="ZoneApp._diaExportScope('all',this)">
            <span class="dia-export-opt-ico">📚</span>
            <span class="dia-export-opt-lbl">All Entries</span>
            <span class="dia-export-opt-sub">${entries().length} entries</span>
          </div>
          <div class="dia-export-opt" data-scope="day" onclick="ZoneApp._diaExportScope('day',this)">
            <span class="dia-export-opt-ico">📅</span>
            <span class="dia-export-opt-lbl">Specific Day</span>
            <span class="dia-export-opt-sub">Choose a date</span>
          </div>
          <div class="dia-export-opt" data-scope="range" onclick="ZoneApp._diaExportScope('range',this)">
            <span class="dia-export-opt-ico">📆</span>
            <span class="dia-export-opt-lbl">Date Range</span>
            <span class="dia-export-opt-sub">From → To</span>
          </div>
        </div>
        <div id="diaExportDay" class="dia-date-range" style="display:none">
          <label>DATE</label>
          <input type="date" id="diaExportDayDate" value="${todayKey()}">
        </div>
        <div id="diaExportRange" class="dia-date-range" style="display:none;flex-direction:column;gap:6px">
          <div style="display:flex;gap:8px;align-items:center;width:100%">
            <label>FROM</label>
            <input type="date" id="diaExportFrom" value="${todayKey()}" style="flex:1">
          </div>
          <div style="display:flex;gap:8px;align-items:center;width:100%">
            <label>TO&nbsp;</label>
            <input type="date" id="diaExportTo" value="${todayKey()}" style="flex:1">
          </div>
        </div>
      </div>
      <div class="dia-modal-foot">
        <button class="dia-ctl" onclick="ZoneApp._diaCloseExport()">Cancel</button>
        <button class="dia-ctl primary" onclick="ZoneApp._diaDoExport()">⬇ Download JSON</button>
      </div></div>`;
    document.body.appendChild(o);
    o.addEventListener('click',e=>{ if(e.target===o) closeAnyModal(); });
  }

  let _exportScope = 'all';
  function setExportScope(scope, el) {
    _exportScope = scope;
    document.querySelectorAll('.dia-export-opt').forEach(x=>x.classList.remove('selected'));
    el.classList.add('selected');
    const dayEl = document.getElementById('diaExportDay');
    const rangeEl = document.getElementById('diaExportRange');
    if(dayEl) dayEl.style.display = scope==='day' ? 'flex' : 'none';
    if(rangeEl) rangeEl.style.display = scope==='range' ? 'flex' : 'none';
  }

  function doExport() {
    let filtered = entries();
    if(_exportScope === 'day') {
      const d = document.getElementById('diaExportDayDate')?.value;
      if(d) filtered = entries().filter(e=>e.date===d);
    } else if(_exportScope === 'range') {
      const from = document.getElementById('diaExportFrom')?.value;
      const to = document.getElementById('diaExportTo')?.value;
      if(from && to) filtered = entries().filter(e=>e.date>=from && e.date<=to);
    }
    const payload = {
      version: 1,
      app: 'Zone Study OS — Diary',
      exported: new Date().toISOString(),
      count: filtered.length,
      entries: filtered
    };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0,10);
    a.href = url;
    a.download = `zone-diary-${_exportScope==='all'?'all':_exportScope==='day'?document.getElementById('diaExportDayDate')?.value||dateStr:'range'}-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
    closeAnyModal();
    toast(`Exported ${filtered.length} entries`,'success');
  }

  /* ── Import Modal ─────────────────────────────────────── */
  function openImportModal() {
    closeAnyModal();
    const o = document.createElement('div');
    o.className = 'dia-modal-bg'; o.id = 'diaImportModal';
    o.innerHTML = `<div class="dia-modal">
      <div class="dia-modal-hdr"><h3>⬆ Import Diary</h3><button class="dia-x" onclick="ZoneApp._diaCloseImport()">✕</button></div>
      <div class="dia-modal-body">
        <div class="dia-import-zone" onclick="document.getElementById('diaImportFile').click()" id="diaDropZone">
          <span class="dia-import-zone-ico">📄</span>
          <span class="dia-import-zone-txt">Click to select JSON file</span>
          <span class="dia-import-zone-sub">Accepts Zone Diary export files (.json)</span>
        </div>
        <input type="file" id="diaImportFile" accept=".json" style="display:none" onchange="ZoneApp._diaFileSelected(this)">
        <div id="diaImportPreview" style="display:none;margin-top:10px">
          <div style="background:var(--bg-3);border:1px solid var(--line);border-radius:var(--r-sm);padding:10px;font-size:11px">
            <div style="color:var(--text-primary);font-weight:600" id="diaImportSummary"></div>
            <div style="color:var(--text-muted);font-size:10px;margin-top:4px" id="diaImportDetail"></div>
          </div>
          <div style="margin-top:10px">
            <label style="font-size:10px;color:var(--text-muted);display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" id="diaImportMerge" checked> Merge (skip duplicates by date+title) — safer
            </label>
            <label style="font-size:10px;color:var(--text-muted);display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:4px">
              <input type="checkbox" id="diaImportReplace"> Replace all existing entries (dangerous!)
            </label>
          </div>
        </div>
      </div>
      <div class="dia-modal-foot">
        <button class="dia-ctl" onclick="ZoneApp._diaCloseImport()">Cancel</button>
        <button class="dia-ctl primary" id="diaImportBtn" onclick="ZoneApp._diaDoImport()" disabled>⬆ Import</button>
      </div></div>`;
    document.body.appendChild(o);
    o.addEventListener('click',e=>{ if(e.target===o) closeAnyModal(); });
  }

  let _importData = null;
  function fileSelected(input) {
    const file = input.files?.[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
      try {
        const data = JSON.parse(ev.target.result);
        if(!data.entries || !Array.isArray(data.entries)) throw new Error('Invalid format');
        _importData = data;
        const preview = document.getElementById('diaImportPreview');
        const summary = document.getElementById('diaImportSummary');
        const detail = document.getElementById('diaImportDetail');
        const btn = document.getElementById('diaImportBtn');
        if(preview) preview.style.display = 'block';
        if(summary) summary.textContent = `Found ${data.entries.length} entries`;
        if(detail) detail.textContent = `From: ${data.entries[0]?.date||'?'} → ${data.entries[data.entries.length-1]?.date||'?'} | Exported: ${data.exported||'unknown'}`;
        if(btn) btn.disabled = false;
      } catch(err) {
        toast('Invalid JSON file','error');
        _importData = null;
      }
    };
    reader.readAsText(file);
  }

  function doImport() {
    if(!_importData) return;
    const merge = document.getElementById('diaImportMerge')?.checked;
    const replace = document.getElementById('diaImportReplace')?.checked;
    if(replace) {
      state().diary = _importData.entries;
      toast(`Replaced with ${_importData.entries.length} entries`,'success');
    } else if(merge) {
      const existing = new Set(entries().map(e=>e.date+'|'+(e.title||'').toLowerCase()));
      let added = 0;
      _importData.entries.forEach(e => {
        const key = e.date+'|'+(e.title||'').toLowerCase();
        if(!existing.has(key)) {
          if(!e.id) e.id = _uid();
          entries().push(e);
          existing.add(key);
          added++;
        }
      });
      toast(`Imported ${added} new entries (${_importData.entries.length - added} skipped as duplicates)`,'success');
    }
    _importData = null;
    saveDiary();
    closeAnyModal();
    renderDiaryTab();
  }

  function closeAnyModal(){
    ['diaDelModal','diaExportModal','diaImportModal','diaLightbox','diaMdPreview'].forEach(id=>{
      const m=document.getElementById(id); if(m) m.remove();
    });
  }

  /* ── Calendar ─────────────────────────────────────────── */
  function calNav(dir) {
    _calM += dir;
    if(_calM>11){ _calM=0; _calY++; }
    if(_calM<0){ _calM=11; _calY--; }
    renderDiaryTab();
  }

  function calClick(day) {
    if(!day) return;
    const key = `${_calY}-${s(_calM+1)}-${s(day)}`;
    const dayEntries = entries().filter(e=>e.date===key);
    if(dayEntries.length > 0) {
      _viewDate = key;
      select(dayEntries[0].id);
    } else {
      _viewDate = null;
      create(key);
    }
  }

  function clearViewDate() {
    _viewDate = null;
    renderDiaryTab();
  }

  function s(n){ return String(n).padStart(2,'0'); }
  function _uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  function getEntryDates(){ const d=new Set(); entries().forEach(e=>{ if(e.date)d.add(e.date); }); return d; }

  /* ── Tags ─────────────────────────────────────────────── */
  function addTag() {
    const inp = document.getElementById('diaTagInp');
    if(!inp) return;
    const t = inp.value.trim().toLowerCase();
    if(!t || _tags.includes(t)){ inp.value=''; return; }
    _tags.push(t); inp.value='';
    renderDiaryTab();
    setTimeout(()=>{ const el=document.getElementById('diaTagInp'); if(el)el.focus(); },10);
  }
  function rmTag(t){ _tags=_tags.filter(x=>x!==t); renderDiaryTab(); }

  /* ── Mood ─────────────────────────────────────────────── */
  function setMood(m){ _mood = _mood===m ? null : m; renderDiaryTab(); }

  /* ── Prompts ──────────────────────────────────────────── */
  function insertPrompt(text) {
    const ta = document.getElementById('diaContent');
    if(!ta) return;
    const ex = ta.value.trim();
    const pfx = ex ? '\n\n' : '';
    ta.value = ex + pfx + text + '\n\n- ';
    ta.focus();
    ta.selectionStart = ta.selectionEnd = ta.value.length;
    updateWC();
  }

  /* ── Word count ───────────────────────────────────────── */
  function updateWC() {
    const ta = document.getElementById('diaContent');
    const el = document.getElementById('diaWC');
    if(!ta||!el) return;
    const t = ta.value;
    const w = t.trim() ? t.trim().split(/\s+/).length : 0;
    el.textContent = `${w} word${w!==1?'s':''} · ${t.length} char${t.length!==1?'s':''}`;
  }

  /* ── All unique tags ──────────────────────────────────── */
  function allTags(){ const t=new Set(); entries().forEach(e=>(e.tags||[]).forEach(x=>t.add(x))); return [...t].sort(); }

  /* ── Stats ────────────────────────────────────────────── */
  function stats() {
    const all = entries();
    const now = new Date();
    const wk = new Date(now); wk.setDate(wk.getDate()-7);
    const mo = new Date(now.getFullYear(), now.getMonth(), 1);
    let streak=0;
    const ds = new Set(all.map(e=>e.date));
    const d = new Date();
    if(!ds.has(todayKey())) d.setDate(d.getDate()-1);
    while(true){
      const k=`${d.getFullYear()}-${s(d.getMonth()+1)}-${s(d.getDate())}`;
      if(ds.has(k)){streak++;d.setDate(d.getDate()-1);} else break;
    }
    return {
      total: all.length,
      week: all.filter(e=>new Date(e.date+'T23:59:59')>=wk).length,
      month: all.filter(e=>new Date(e.date+'T23:59:59')>=mo).length,
      streak
    };
  }

  /* ── Mood history (7 days) ────────────────────────────── */
  function moodHistory() {
    const r=[]; const dn=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    for(let i=6;i>=0;i--){
      const d=new Date(); d.setDate(d.getDate()-i);
      const k=`${d.getFullYear()}-${s(d.getMonth()+1)}-${s(d.getDate())}`;
      const e=entries().find(x=>x.date===k);
      r.push({ day:dn[d.getDay()], mood:e?.mood||null, today:i===0 });
    }
    return r;
  }

  /* ── Format dates ─────────────────────────────────────── */
  function fmtD(ds){ if(!ds)return''; return new Date(ds+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
  function fmtDFull(ds){ if(!ds)return''; return new Date(ds+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}); }

  /* ── Render ───────────────────────────────────────────── */
  function renderDiaryTab() {
    const body = document.getElementById('tabBody');
    if(!body) return;
    const all = entries();
    const sel = _sel ? all.find(e=>e.id===_sel) : null;

    // Filter list
    let filtered = [...all];
    if(_viewDate) filtered=filtered.filter(e=>e.date===_viewDate);
    if(_search){ const q=_search.toLowerCase(); filtered=filtered.filter(e=>(e.title||'').toLowerCase().includes(q)||(e.content||'').toLowerCase().includes(q)||(e.tags||[]).some(t=>t.includes(q))); }
    if(_fltMood) filtered=filtered.filter(e=>e.mood===_fltMood);

    const st = stats();
    const mh = moodHistory();
    const calHtml = renderCal();
    const mNames=['January','February','March','April','May','June','July','August','September','October','November','December'];

    // Entry list
    const listHtml = filtered.length===0
      ? `<div class="dia-list-empty"><span class="dia-empty-ico">${all.length===0?'📔':'🔍'}</span><span class="dia-empty-txt">${all.length===0?'No entries yet':'No matches'}</span></div>`
      : filtered.map(e=>{
          const act = _sel===e.id;
          const me = e.mood ? MOODS[e.mood]?.e : '';
          const pv = (e.content||'').replace(/\n/g,' ').slice(0,70);
          const tg = (e.tags||[]).slice(0,3).map(t=>`<span class="dia-ecard-tag">#${esc(t)}</span>`).join('');
          const hasAtt = (e.attachments||[]).length > 0;
          return `<div class="dia-ecard ${act?'active':''}" onclick="ZoneApp._diaSelect('${e.id}')">
            <div class="dia-ecard-top">${me?`<span class="dia-ecard-mood">${me}</span>`:''}<span class="dia-ecard-date">${fmtD(e.date)}</span>${hasAtt?`<span class="dia-ecard-att">📎</span>`:''}</div>
            <div class="dia-ecard-title">${esc(e.title||'Untitled')}</div>
            ${pv?`<div class="dia-ecard-preview">${esc(pv)}</div>`:''}
            ${tg?`<div class="dia-ecard-tags">${tg}</div>`:''}
          </div>`;
        }).join('');

    // Editor / View
    const edHtml = sel ? (_viewMode ? renderView(sel) : renderEditor(sel)) : renderEmpty();

    // Mood week
    const mhtml = mh.map(m=>{
      const em = m.mood ? MOODS[m.mood]?.e : null;
      return `<div class="dia-mood-day"><span class="dia-mood-day-lbl">${m.today?'Now':m.day}</span>${em?`<span class="dia-mood-day-emo">${em}</span>`:`<span class="dia-mood-day-none">·</span>`}</div>`;
    }).join('');

    body.innerHTML = `<div class="dia-wrap">
      <!-- LEFT: List -->
      <div class="dia-entry-list">
        <div class="dia-list-hdr">
          <span class="dia-list-lbl">ENTRIES</span>
          <span class="dia-list-cnt">${_viewDate ? filtered.length + ' / ' + all.length : all.length}</span>
        </div>
        ${_viewDate ? `<div class="dia-date-filter-bar"><span class="dia-date-filter-label">📅 ${_viewDate}</span><button class="dia-date-filter-clear" onclick="ZoneApp._diaClearViewDate()">✕ Show All</button></div>` : ''}
        <div class="dia-list-search">
          <input class="dia-search-inp" placeholder="Search..." value="${esc(_search)}" oninput="ZoneApp._diaSearch(this.value)">
        </div>
        <div class="dia-list-filters">
          <button class="dia-flt-btn ${_fltMood===''?'active':''}" onclick="ZoneApp._diaFltMood('')">ALL</button>
          ${Object.entries(MOODS).map(([k,v])=>`<button class="dia-flt-btn ${_fltMood===k?'active':''}" onclick="ZoneApp._diaFltMood('${k}')">${v.e}</button>`).join('')}
        </div>
        <div class="dia-list-body">${listHtml}</div>
      </div>

      <!-- CENTER: Editor / View -->
      <div class="dia-editor">${edHtml}</div>

      <!-- RIGHT: Sidebar -->
      <div class="dia-sidebar">
        <button class="dia-new-btn" onclick="ZoneApp._diaNew()">+ New Entry</button>
        <div class="dia-actions-row">
          <button class="dia-act-btn" onclick="ZoneApp._diaOpenExport()">⬇ Export</button>
          <button class="dia-act-btn" onclick="ZoneApp._diaOpenImport()">⬆ Import</button>
        </div>
        <div class="dia-cal-card">
          <div class="dia-cal-hdr">
            <button class="dia-cal-nav" onclick="ZoneApp._diaCalNav(-1)">◀</button>
            <span class="dia-cal-month">${mNames[_calM]} ${_calY}</span>
            <button class="dia-cal-nav" onclick="ZoneApp._diaCalNav(1)">▶</button>
          </div>
          <div class="dia-cal-wk"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
          <div class="dia-cal-grid">${calHtml}</div>
        </div>
        <div class="dia-scard">
          <div class="dia-scard-title">MOOD WEEK</div>
          <div class="dia-mood-week">${mhtml}</div>
        </div>
        <div class="dia-scard">
          <div class="dia-scard-title">STATS</div>
          <div class="dia-srow"><span>Total</span><span>${st.total}</span></div>
          <div class="dia-srow"><span>This Week</span><span>${st.week}</span></div>
          <div class="dia-srow"><span>This Month</span><span>${st.month}</span></div>
          <div class="dia-srow"><span>Streak</span><span>${st.streak}d</span></div>
        </div>
      </div>
    </div>`;

    // Bind word count
    if(sel && !_viewMode){ const ta=document.getElementById('diaContent'); if(ta){ ta.addEventListener('input',updateWC); updateWC(); } }

    // Bind drag-drop in editor
    if(sel && !_viewMode) {
      const dropZone = document.getElementById('diaAttachDrop');
      if(dropZone) {
        dropZone.addEventListener('dragover', handleFileDragOver);
        dropZone.addEventListener('dragleave', handleFileDragLeave);
        dropZone.addEventListener('drop', handleFileDrop);
      }
    }
  }

  /* ── Editor (edit mode) ───────────────────────────────── */
  function renderEditor(e) {
    const moods = Object.entries(MOODS).map(([k,v])=>
      `<button class="dia-mood-btn ${_mood===k?'active':''}" onclick="ZoneApp._diaSetMood('${k}')" title="${v.l}">${v.e}</button>`
    ).join('');
    const tags = _tags.map(t=>
      `<span class="dia-tag">#${esc(t)} <button class="dia-tag-x" onclick="ZoneApp._diaRmTag('${esc(t)}')">✕</button></span>`
    ).join('');
    const created = e.created ? new Date(e.created).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '';
    const updated = e.updated ? new Date(e.updated).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '';
    const attHtml = renderAttachments(e.attachments, true);

    return `
      <div class="dia-ed-top">
        <div style="display:flex;align-items:center;gap:8px">
          <input type="date" id="diaDate" class="dia-ed-date" value="${esc(e.date)}">
          <span class="dia-ed-time">${created?'Created '+created:''}${updated?' · Updated '+updated:''}</span>
        </div>
        <div class="dia-ed-acts">
          <button class="dia-ctl" onclick="ZoneApp._diaToggleView()" title="View Mode">👁 View</button>
          <button class="dia-ctl danger" onclick="ZoneApp._diaDel('${e.id}')">🗑</button>
          <button class="dia-ctl primary" onclick="ZoneApp._diaSave()">💾 Save</button>
        </div>
      </div>
      <div class="dia-mood-row">
        <span class="dia-mood-lbl">MOOD</span>
        <div class="dia-mood-opts">${moods}</div>
      </div>
      <input type="text" id="diaTitle" class="dia-title-inp" placeholder="Entry title..."
        value="${esc(e.title||'')}" onkeydown="if(event.key==='Enter')ZoneApp._diaSave()">
      <div class="dia-tags-row">
        ${tags}
        <input type="text" id="diaTagInp" class="dia-tag-inp" placeholder="+ tag"
          onkeydown="if(event.key==='Enter'){ZoneApp._diaAddTag();event.preventDefault();}">
      </div>
      <textarea id="diaContent" class="dia-content-inp" placeholder="Write your diary entry here... Supports **markdown**...">${esc(e.content||'')}</textarea>
      <div class="dia-meta-bar">
        <span class="dia-wc" id="diaWC">0 words · 0 chars</span>
      </div>
      <!-- Attachments -->
      <div class="dia-attach-section">
        <input type="file" id="diaAttachInp" multiple accept="${ATTACH_EXTENSIONS.map(x=>'.'+x).join(',')}" style="display:none" onchange="ZoneApp._diaFileInput(this)">
        <div id="diaAttachDrop" class="dia-attach-drop ${_dragOver?'dragover':''}">
          <div class="dia-attach-drop-inner" onclick="ZoneApp._diaTriggerFile()">
            <span class="dia-attach-drop-icon">📎</span>
            <span class="dia-attach-drop-txt">Drop files here or click to upload</span>
            <span class="dia-attach-drop-sub">Images, Videos (≤100MB), PDF, Markdown</span>
          </div>
        </div>
        ${attHtml}
      </div>
      <div class="dia-prompts">
        <span class="dia-prompts-lbl">💡 PROMPTS</span>
        <div class="dia-prompts-row">
          ${PROMPTS.map(p=>`<button class="dia-prompt-btn" onclick="ZoneApp._diaPrompt('${esc(p)}')">${esc(p)}</button>`).join('')}
        </div>
      </div>`;
  }

  /* ── View Mode (read-only) ────────────────────────────── */
  function renderView(e) {
    const me = e.mood ? MOODS[e.mood]?.e : '';
    const moodLabel = e.mood ? MOODS[e.mood]?.l : '';
    const tags = (e.tags||[]).map(t=>`<span class="dia-view-tag">#${esc(t)}</span>`).join('');
    const created = e.created ? new Date(e.created).toLocaleString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    const updated = e.updated ? new Date(e.updated).toLocaleString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    const contentHtml = e.content ? renderMd(e.content) : '<div class="dia-view-nocontent">No content</div>';
    const attHtml = renderAttachments(e.attachments, false);
    const wc = e.content ? e.content.trim().split(/\s+/).length : 0;

    return `
      <div class="dia-ed-top">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="dia-ed-date dia-view-date">${fmtDFull(e.date)}</span>
        </div>
        <div class="dia-ed-acts">
          <button class="dia-ctl" onclick="ZoneApp._diaToggleView()" title="Edit Mode">✏️ Edit</button>
          <button class="dia-ctl danger" onclick="ZoneApp._diaDel('${e.id}')">🗑</button>
        </div>
      </div>
      <div class="dia-view-body">
        <div class="dia-view-head">
          ${me ? `<span class="dia-view-mood">${me} ${moodLabel}</span>` : ''}
          <h1 class="dia-view-title">${esc(e.title||'Untitled')}</h1>
          <div class="dia-view-meta">
            <span>📅 ${created}</span>
            ${updated !== created ? `<span> · Updated ${updated}</span>` : ''}
            <span> · ${wc} word${wc!==1?'s':''}</span>
          </div>
          ${tags ? `<div class="dia-view-tags">${tags}</div>` : ''}
        </div>
        <div class="dia-view-content">${contentHtml}</div>
        ${attHtml}
      </div>`;
  }

  function renderEmpty() {
    return `<div class="dia-empty-editor">
      <div class="dia-empty-ico-big">📝</div>
      <div class="dia-empty-title">Write Something</div>
      <div class="dia-empty-sub">Select an entry or create a new one</div>
    </div>`;
  }

  function renderCal() {
    const ed = getEntryDates();
    const today = todayKey();
    const fd = new Date(_calY,_calM,1).getDay();
    const dim = new Date(_calY,_calM+1,0).getDate();
    const pd = new Date(_calY,_calM,0).getDate();
    let h = '';
    for(let i=fd-1;i>=0;i--) h+=`<div class="dia-cal-day other">${pd-i}</div>`;
    for(let d=1;d<=dim;d++){
      const k=`${_calY}-${s(_calM+1)}-${s(d)}`;
      const cls=['dia-cal-day'];
      if(k===today) cls.push('today');
      if(ed.has(k)) cls.push('has-entry');
      if(k===_viewDate) cls.push('selected');
      h+=`<div class="${cls.join(' ')}" onclick="ZoneApp._diaCalClick(${d})">${d}</div>`;
    }
    const tot=fd+dim; const rem=(7-tot%7)%7;
    for(let i=1;i<=rem;i++) h+=`<div class="dia-cal-day other">${i}</div>`;
    return h;
  }

  /* ── Exports to ZoneApp ───────────────────────────────── */
  ZoneApp.renderDiaryTab    = renderDiaryTab;
  ZoneApp._diaNew           = function(){ create(); };
  ZoneApp._diaSave          = save;
  ZoneApp._diaSelect        = select;
  ZoneApp._diaDel           = remove;
  ZoneApp._diaConfirmDel    = confirmDel;
  ZoneApp._diaCloseDel      = closeDelModal;
  ZoneApp._diaSetMood       = setMood;
  ZoneApp._diaAddTag        = addTag;
  ZoneApp._diaRmTag         = rmTag;
  ZoneApp._diaPrompt        = insertPrompt;
  ZoneApp._diaCalNav        = calNav;
  ZoneApp._diaCalClick      = calClick;
  ZoneApp._diaSearch        = function(v){ _search=v; renderDiaryTab(); };
  ZoneApp._diaFltMood       = function(v){ _fltMood=v; renderDiaryTab(); };
  ZoneApp._diaClearViewDate = clearViewDate;
  ZoneApp._diaOpenExport    = openExportModal;
  ZoneApp._diaOpenImport    = openImportModal;
  ZoneApp._diaExportScope   = setExportScope;
  ZoneApp._diaDoExport      = doExport;
  ZoneApp._diaFileSelected  = fileSelected;
  ZoneApp._diaDoImport      = doImport;
  ZoneApp._diaCloseExport   = closeAnyModal;
  ZoneApp._diaCloseImport   = closeAnyModal;
  // View mode
  ZoneApp._diaToggleView    = toggleViewMode;
  // Attachments
  ZoneApp._diaTriggerFile   = triggerFileInput;
  ZoneApp._diaFileInput     = onFileInputChange;
  ZoneApp._diaRmAttach      = removeAttachment;
  // Lightbox + MD preview
  ZoneApp._diaLightbox      = openLightbox;
  ZoneApp._diaPreviewMd     = previewMd;
  ZoneApp._diaCloseLb       = closeAnyModal;
  ZoneApp._diaCloseMd       = closeAnyModal;

})();
