/* ═══════════════════════════════════════════════════════════
   Zone Todo List — per-zone, per-cycle task tracker
   Standalone module, hooks into ZoneApp via _ctx
   ═══════════════════════════════════════════════════════════ */
;(function () {
  'use strict';

  /* ── Helpers ──────────────────────────────────────────── */
  function ctx() { return ZoneApp._ctx; }
  function state() { return ctx().state; }
  function esc(s) { return ctx().esc(s); }
  function getZones() { return ctx().getZones(); }
  function todayKey() { return ctx().todayKey(); }
  function toast(msg, type) { ctx().toast(msg, type); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function todos() { return state().todos || (state().todos = []); }

  let filterDone = 0; // 0=all, 1=pending, 2=done
  let _lastDeletedTodo = null;

  /* ── CRUD ─────────────────────────────────────────────── */
  function addTodo(text, zoneIdx, cycle) {
    if (!text || !text.trim()) return;
    todos().push({
      id: uid(), text: text.trim(),
      zoneIdx: zoneIdx ?? -1, cycle: cycle ?? -1,
      done: false, created: todayKey()
    });
    saveTodos();
    renderTodoTab();
    toast('✓ Task added');
  }

  function toggleTodo(id) {
    const t = todos().find(x => x.id === id);
    if (!t) return;
    t.done = !t.done;
    saveTodos();
    renderTodoTab();
  }

  function deleteTodo(id) {
    const removed = todos().find(x => x.id === id);
    if (!removed) return;
    _lastDeletedTodo = { ...removed };
    state().todos = todos().filter(x => x.id !== id);
    saveTodos();
    renderTodoTab();
    showUndoToast(removed);
  }

  function showUndoToast(todo) {
    const existing = document.getElementById('undoToast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'undoToast';
    el.className = 'undo-toast';
    el.innerHTML = `<span>Task deleted</span><button onclick="ZoneApp._tlUndoDelete()">Undo</button>`;
    document.body.appendChild(el);
    clearTimeout(showUndoToast._timer);
    showUndoToast._timer = setTimeout(() => { if (el.parentNode) el.remove(); }, 5000);
  }

  function saveTodos() {
    try { ctx().storage().set('todos', todos()); } catch {}
    try { fetch('/api/user-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'todos', value: todos() }) }); } catch {}
  }

  /* ── Add Modal (floating) ─────────────────────────────── */
  function openAddModal() {
    const zones = getZones();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'tlAddModal';
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px">
        <div class="modal-header">
          <h3>+ New Task</h3>
          <button class="close-x" onclick="ZoneApp._tlCloseAddModal()">✕</button>
        </div>
        <div class="modal-body" style="gap:12px">
          <input type="text" id="tlAddText" placeholder="What needs to be done?" autofocus
            style="width:100%;background:var(--bg-3);border:1px solid var(--line);border-radius:8px;padding:10px 14px;color:var(--text-primary);font-size:13px;font-family:var(--font);outline:none"
            onkeydown="if(event.key==='Enter')ZoneApp._tlSubmitAdd()" />
          <div style="display:flex;gap:10px">
            <div style="flex:1">
              <span class="field-label">Zone</span>
              <select id="tlAddZone" onchange="ZoneApp._tlUpdateCycleOptions('tlAddCycle', this.value)" style="width:100%;background:var(--bg-3);border:1px solid var(--line);border-radius:8px;padding:9px 12px;color:var(--text-primary);font-size:12px;font-family:var(--mono);cursor:pointer;outline:none">
                <option value="-1">None</option>
                ${zones.map((z, i) => `<option value="${i}">Z${String(z.id ?? i + 1).padStart(2,'0')} ${esc(z.title)}</option>`).join('')}
              </select>
            </div>
            <div style="flex:1">
              <span class="field-label">Cycle</span>
              <select id="tlAddCycle" style="width:100%;background:var(--bg-3);border:1px solid var(--line);border-radius:8px;padding:9px 12px;color:var(--text-primary);font-size:12px;font-family:var(--mono);cursor:pointer;outline:none">
                <option value="-1">Any</option>
              </select>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="justify-content:flex-end;gap:8px">
          <button class="ctl" onclick="ZoneApp._tlCloseAddModal()" style="padding:8px 14px;font-size:11px">Cancel</button>
          <button class="ctl primary" onclick="ZoneApp._tlSubmitAdd()" style="padding:8px 18px;font-size:11px;font-weight:600">Add Task</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    setTimeout(() => { const el = document.getElementById('tlAddText'); if (el) el.focus(); }, 50);
    // Auto-populate cycles with max across all zones
    setTimeout(() => ZoneApp._tlUpdateCycleOptions('tlAddCycle', '-1'), 10);
  }

  /* ── Edit Modal ────────────────────────────────────────── */
  function openEditModal(id) {
    const t = todos().find(x => x.id === id);
    if (!t) return;
    const zones = getZones();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'tlEditModal';
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px">
        <div class="modal-header">
          <h3>✏️ Edit Task</h3>
          <button class="close-x" onclick="ZoneApp._tlCloseEditModal()">✕</button>
        </div>
        <div class="modal-body" style="gap:12px">
          <input type="text" id="tlEditText" value="${esc(t.text)}"
            style="width:100%;background:var(--bg-3);border:1px solid var(--line);border-radius:8px;padding:10px 14px;color:var(--text-primary);font-size:13px;font-family:var(--font);outline:none"
            onkeydown="if(event.key==='Enter')ZoneApp._tlSaveEdit('${t.id}')" />
          <div style="display:flex;gap:10px">
            <div style="flex:1">
              <span class="field-label">Zone</span>
              <select id="tlEditZone" onchange="ZoneApp._tlUpdateCycleOptions('tlEditCycle', this.value)" style="width:100%;background:var(--bg-3);border:1px solid var(--line);border-radius:8px;padding:9px 12px;color:var(--text-primary);font-size:12px;font-family:var(--mono);cursor:pointer;outline:none">
                <option value="-1" ${t.zoneIdx === -1 ? 'selected' : ''}>None</option>
                ${zones.map((z, i) => `<option value="${i}" ${t.zoneIdx === i ? 'selected' : ''}>Z${String(z.id ?? i + 1).padStart(2,'0')} ${esc(z.title)}</option>`).join('')}
              </select>
            </div>
            <div style="flex:1">
              <span class="field-label">Cycle</span>
              <select id="tlEditCycle" style="width:100%;background:var(--bg-3);border:1px solid var(--line);border-radius:8px;padding:9px 12px;color:var(--text-primary);font-size:12px;font-family:var(--mono);cursor:pointer;outline:none">
                <option value="-1" ${t.cycle === -1 ? 'selected' : ''}>Any</option>
              </select>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="justify-content:space-between">
          <button class="ctl danger" onclick="ZoneApp._tlDeleteConfirm('${t.id}')" style="padding:8px 12px;font-size:11px">🗑 Delete</button>
          <div style="display:flex;gap:8px">
            <button class="ctl" onclick="ZoneApp._tlCloseEditModal()" style="padding:8px 12px;font-size:11px">Cancel</button>
            <button class="ctl primary" onclick="ZoneApp._tlSaveEdit('${t.id}')" style="padding:8px 16px;font-size:11px;font-weight:600">Save</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    setTimeout(() => { const el = document.getElementById('tlEditText'); if (el) { el.focus(); el.select(); } }, 50);
    // Auto-populate cycles for selected zone
    setTimeout(() => ZoneApp._tlUpdateCycleOptions('tlEditCycle', document.getElementById('tlEditZone')?.value ?? '-1', t.cycle), 10);
  }

  /* ── Delete Confirm ────────────────────────────────────── */
  function openDeleteConfirm(id) {
    const t = todos().find(x => x.id === id);
    if (!t) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'tlDelModal';
    overlay.innerHTML = `
      <div class="modal" style="max-width:340px">
        <div class="modal-body" style="gap:10px;padding:20px">
          <p style="font-size:13px;color:var(--text-primary);margin:0;font-weight:600">Delete this task?</p>
          <p style="font-size:12px;color:var(--text-muted);margin:0">"${esc(t.text)}"</p>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
            <button class="ctl" onclick="ZoneApp._tlCloseDelModal()" style="padding:8px 14px;font-size:11px">Cancel</button>
            <button class="ctl danger" onclick="ZoneApp._tlDeleteConfirm('${t.id}')" style="padding:8px 14px;font-size:11px;font-weight:600">Delete</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  /* ── Complete Confirm ──────────────────────────────────── */
  function openCompleteConfirm(id) {
    const t = todos().find(x => x.id === id);
    if (!t) return;
    const markingDone = !t.done;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'tlCompleteModal';
    overlay.innerHTML = `
      <div class="modal" style="max-width:340px">
        <div class="modal-body" style="gap:10px;padding:20px">
          <p style="font-size:13px;color:var(--text-primary);margin:0;font-weight:600">${markingDone ? '✓ Mark as done?' : '↺ Mark as pending?'}</p>
          <p style="font-size:12px;color:var(--text-muted);margin:0">"${esc(t.text)}"</p>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
            <button class="ctl" onclick="ZoneApp._tlCloseCompleteModal()" style="padding:8px 14px;font-size:11px">Cancel</button>
            <button class="ctl primary" onclick="ZoneApp._tlConfirmComplete('${id}')" style="padding:8px 14px;font-size:11px;font-weight:600">${markingDone ? '✓ Done' : '↺ Pending'}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  /* ── Render ───────────────────────────────────────────── */
  function renderTodoTab() {
    const body = document.getElementById('tabBody');
    if (!body) return;
    const zones = getZones();
    const allTodos = todos();
    const isTimeTravel = state().selectedDate != null;
    const travelDate = state().selectedDate || todayKey();

    // Time travel: only show todos created on that date
    let dayTodos = isTimeTravel ? allTodos.filter(t => t.created === travelDate) : allTodos;

    let filtered = dayTodos;
    if (filterDone === 1) filtered = filtered.filter(t => !t.done);
    if (filterDone === 2) filtered = filtered.filter(t => t.done);

    const doneCount = dayTodos.filter(t => t.done).length;
    const pendingCount = dayTodos.length - doneCount;

    body.innerHTML = `
      <div class="tl-wrap">
        ${isTimeTravel ? `<div class="tl-time-travel-banner">⏳ Viewing tasks on <strong>${esc(travelDate)}</strong> <button class="ctl" onclick="ZoneApp.clearTimeTravel()" style="margin-left:10px;padding:4px 10px;font-size:10px">← Back to Today</button></div>` : ''}

        <div class="tl-header">
          <div class="tl-header-left">
            <h2>📋 Tasks</h2>
            <span class="tl-stats">
              <span class="tl-stat tl-stat-done">${doneCount} done</span>
              <span class="tl-stat tl-stat-pending">${pendingCount} pending</span>
            </span>
          </div>
        </div>

        <!-- Filters -->
        <div class="tl-filters">
          <button class="tl-filter-btn ${filterDone === 0 ? 'active' : ''}" onclick="ZoneApp._tlFilterDone(0)">ALL</button>
          <button class="tl-filter-btn ${filterDone === 1 ? 'active' : ''}" onclick="ZoneApp._tlFilterDone(1)">PENDING</button>
          <button class="tl-filter-btn ${filterDone === 2 ? 'active' : ''}" onclick="ZoneApp._tlFilterDone(2)">DONE</button>
        </div>

        ${doneCount > 0 ? `<button class="tl-clear-done" onclick="ZoneApp._tlClearDone()">✕ Clear ${doneCount} completed</button>` : ''}

        <!-- Todo List -->
        <div class="tl-list">
          ${filtered.length === 0 ? `
            <div class="tl-empty">
              <span class="tl-empty-icon">${dayTodos.length === 0 ? '📝' : '🔍'}</span>
              <span class="tl-empty-text">${dayTodos.length === 0 ? 'No tasks for this day' : 'No tasks match this filter'}</span>
            </div>
          ` : filtered.map(t => renderTodoItem(t, zones)).join('')}
        </div>
      </div>

      <!-- Floating + Button -->
      <button class="tl-fab" onclick="ZoneApp._tlOpenAdd()" title="Add task">+</button>`;
  }

  function renderTodoItem(t, zones) {
    const z = t.zoneIdx >= 0 ? zones[t.zoneIdx] : null;
    const meta = [];
    if (z) meta.push(`<span class="tl-badge" style="--badge-c:${z.color || 'var(--text-muted)'}">Z${String(z.id ?? t.zoneIdx + 1).padStart(2,'0')}</span>`);
    if (t.cycle >= 0) meta.push(`<span class="tl-badge tl-badge-cycle">C${t.cycle + 1}</span>`);

    return `<div class="tl-item ${t.done ? 'done' : ''}" data-id="${t.id}">
      <button class="tl-check" onclick="ZoneApp._tlToggle('${t.id}')" title="${t.done ? 'Mark pending' : 'Mark done'}">
        ${t.done ? '<span class="tl-check-icon">✓</span>' : ''}
      </button>
      <div class="tl-item-body" onclick="ZoneApp._tlOpenEdit('${t.id}')">
        <span class="tl-item-text ${t.done ? 'tl-item-done' : ''}">${esc(t.text)}</span>
        ${meta.length ? `<div class="tl-item-meta">${meta.join('')}</div>` : ''}
      </div>
      <div class="tl-actions">
        <button class="tl-action-btn" onclick="ZoneApp._tlOpenEdit('${t.id}')" title="Edit">✏️</button>
        <button class="tl-action-btn tl-del-btn" onclick="ZoneApp._tlOpenDelete('${t.id}')" title="Delete">✕</button>
      </div>
    </div>`;
  }

  /* ── Cycle/Zone Completion Checklist (Neon Glow) ────── */
  function openCycleChecklist(zoneIdx, cycle, zoneName) {
    const zones = getZones();
    const allTodos = todos();
    const travelDate = todayKey();
    const tasks = allTodos.filter(t =>
      t.zoneIdx === zoneIdx &&
      (t.cycle === cycle || t.cycle === -1) &&
      t.created === travelDate
    );
    _renderChecklistModal(tasks, zones, zoneIdx, cycle, zoneName, 'cycle');
  }

  function openZoneChecklist(zoneIdx, zoneName) {
    const zones = getZones();
    const allTodos = todos();
    const travelDate = todayKey();
    const tasks = allTodos.filter(t =>
      t.zoneIdx === zoneIdx &&
      t.created === travelDate
    );
    _renderChecklistModal(tasks, zones, zoneIdx, -1, zoneName, 'zone');
  }

  function _renderChecklistModal(tasks, zones, zoneIdx, cycle, zoneName, mode) {
    const old = document.getElementById('clChecklistModal');
    if (old) old.remove();

    const z = zones[zoneIdx];
    const doneCount = tasks.filter(t => t.done).length;
    const zoneLabel = z ? `Z${String(z.id ?? zoneIdx + 1).padStart(2, '0')} ${esc(zoneName || z.title)}` : esc(zoneName || 'Zone');
    const cycleLabel = mode === 'cycle' ? `Cycle ${cycle + 1}` : 'All Tasks';
    const title = mode === 'cycle' ? 'CYCLE CHECKLIST' : 'ZONE CHECKLIST';

    const overlay = document.createElement('div');
    overlay.className = 'cl-overlay';
    overlay.id = 'clChecklistModal';
    overlay.innerHTML = `
      <div class="cl-card">
        <div class="cl-header">
          <div class="cl-title-group">
            <span class="cl-title"><span class="cl-title-icon">⚡</span> ${title}</span>
            <div class="cl-subtitle">
              <span class="cl-zone-tag">${zoneLabel}</span>
              <span class="cl-cycle-tag">${cycleLabel}</span>
            </div>
          </div>
          <button class="cl-close" onclick="ZoneApp._clClose()">✕</button>
        </div>
        <div class="cl-tasks" id="clTaskList">
          ${tasks.length === 0 ? `
            <div class="cl-empty">
              <span class="cl-empty-icon">📝</span>
              <span class="cl-empty-text">No tasks assigned to this ${mode === 'cycle' ? 'cycle' : 'zone'}</span>
            </div>
          ` : tasks.map(t => `
            <div class="cl-task ${t.done ? 'done' : ''}" data-id="${t.id}" onclick="ZoneApp._clToggle('${t.id}')">
              <div class="cl-check"><span class="cl-check-icon">✓</span></div>
              <span class="cl-task-text">${esc(t.text)}</span>
            </div>
          `).join('')}
        </div>
        <div class="cl-footer">
          <span class="cl-progress">
            <span class="cl-done-count">${doneCount}</span>
            <span class="cl-total-count"> / ${tasks.length} tasks</span>
          </span>
          <button class="cl-done-btn" onclick="ZoneApp._clClose()">CONTINUE →</button>
        </div>
      </div>`;

    overlay.addEventListener('click', e => { if (e.target === overlay) ZoneApp._clClose(); });
    document.body.appendChild(overlay);
  }

  function _clToggle(id) {
    const t = todos().find(x => x.id === id);
    if (!t) return;
    t.done = !t.done;
    saveTodos();
    const el = document.querySelector(`.cl-task[data-id="${id}"]`);
    if (el) el.classList.toggle('done', t.done);
    const tasks = document.querySelectorAll('.cl-task');
    const doneC = document.querySelector('.cl-done-count');
    if (doneC) {
      let cnt = 0;
      tasks.forEach(t2 => { if (t2.classList.contains('done')) cnt++; });
      doneC.textContent = cnt;
    }
  }

  function _clClose() {
    const m = document.getElementById('clChecklistModal');
    if (m) m.remove();
    // After dismissing checklist, auto-start next focus ONLY if timer isn't already running
    // (autoStartBreaks OFF: overtime timer is running → don't start again)
    // (autoStartBreaks ON / break ended: timer stopped → start next focus)
    try {
      const s = ctx().state;
      if (s && s.settings && s.settings.flowMode) {
        const zs = s.byZone && s.byZone[s.currentZoneIdx];
        // Only auto-start if timer is NOT already running (overtime case)
        if (!zs || !zs.running) {
          ctx().timerStart();
        }
      }
    } catch (e) { /* flowMode auto-start guard */ }
  }

  /* ── Public API ───────────────────────────────────────── */
  ZoneApp._tlOpenAdd = function () { openAddModal(); };

  ZoneApp._tlSubmitAdd = function () {
    const text = document.getElementById('tlAddText')?.value;
    const zoneIdx = Number(document.getElementById('tlAddZone')?.value ?? -1);
    const cycle = Number(document.getElementById('tlAddCycle')?.value ?? -1);
    if (!text || !text.trim()) return;
    addTodo(text, zoneIdx, cycle);
    ZoneApp._tlCloseAddModal();
  };

  ZoneApp._tlToggle = function (id) { openCompleteConfirm(id); };
  ZoneApp._tlConfirmComplete = function (id) {
    toggleTodo(id);
    ZoneApp._tlCloseCompleteModal();
  };
  ZoneApp._tlOpenEdit = function (id) { openEditModal(id); };
  ZoneApp._tlOpenDelete = function (id) { openDeleteConfirm(id); };

  ZoneApp._tlSaveEdit = function (id) {
    const text = document.getElementById('tlEditText')?.value;
    const zoneIdx = Number(document.getElementById('tlEditZone')?.value ?? -1);
    const cycle = Number(document.getElementById('tlEditCycle')?.value ?? -1);
    if (!text || !text.trim()) { toast('⚠️ Cannot be empty', 'warn'); return; }
    const t = todos().find(x => x.id === id);
    if (t) { t.text = text.trim(); t.zoneIdx = zoneIdx; t.cycle = cycle; saveTodos(); renderTodoTab(); }
    ZoneApp._tlCloseEditModal();
  };

  ZoneApp._tlDeleteConfirm = function (id) {
    deleteTodo(id);
    ZoneApp._tlCloseDelModal();
    ZoneApp._tlCloseEditModal();
  };

  ZoneApp._tlCloseAddModal = function () { const m = document.getElementById('tlAddModal'); if (m) m.remove(); };
  ZoneApp._tlCloseEditModal = function () { const m = document.getElementById('tlEditModal'); if (m) m.remove(); };
  ZoneApp._tlCloseDelModal = function () { const m = document.getElementById('tlDelModal'); if (m) m.remove(); };
  ZoneApp._tlCloseCompleteModal = function () { const m = document.getElementById('tlCompleteModal'); if (m) m.remove(); };
  ZoneApp._tlFilterDone = function (v) { filterDone = v; renderTodoTab(); };

  ZoneApp._tlQuickAdd = function () {
    const input = document.getElementById('tlQuickInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    addTodo(text, -1, -1);
    input.value = '';
    input.focus();
  };

  ZoneApp._tlClearDone = function () {
    const done = todos().filter(t => t.done);
    if (done.length === 0) return;
    state().todos = todos().filter(t => !t.done);
    saveTodos();
    renderTodoTab();
    toast(`Cleared ${done.length} completed task${done.length > 1 ? 's' : ''}`, 'success');
  };

  ZoneApp._tlUndoDelete = function () {
    const el = document.getElementById('undoToast');
    if (el) el.remove();
    clearTimeout(showUndoToast._timer);
    if (_lastDeletedTodo) {
      todos().push(_lastDeletedTodo);
      _lastDeletedTodo = null;
      saveTodos();
      renderTodoTab();
    }
  };

  ZoneApp._tlUpdateCycleOptions = function (selectId, zoneVal, preSelect) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const zones = getZones();
    const zIdx = Number(zoneVal);
    const cycles = (zIdx >= 0 && zones[zIdx]) ? (zones[zIdx].totalCycles || 4) : Math.max(...zones.map(z => z.totalCycles || 4));
    let html = `<option value="-1" ${preSelect === -1 || preSelect === undefined ? 'selected' : ''}>Any</option>`;
    for (let i = 0; i < cycles; i++) {
      html += `<option value="${i}" ${preSelect === i ? 'selected' : ''}>Cycle ${i + 1}</option>`;
    }
    sel.innerHTML = html;
  };

  /* ── Checklist exports (called from app.js) ──────────── */
  ZoneApp.openCycleChecklist = openCycleChecklist;
  ZoneApp.openZoneChecklist = openZoneChecklist;
  ZoneApp._clToggle = _clToggle;
  ZoneApp._clClose = _clClose;

  ZoneApp.renderTodoTab = renderTodoTab;
})();
