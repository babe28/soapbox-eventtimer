const DASHBOARD_TYPES = ['normal', 'break', 'buffer', 'special', 'race'];

const editorState = {
  schedule: [],
  selectedId: null,
  dirty: false,
  rawState: null,
  savedSchedules: [],
  draggingId: null,
  theme: 'light',
};

const editorElements = {
  entryCount: document.querySelector('#entry-count'),
  editorStatus: document.querySelector('#editor-status'),
  editorList: document.querySelector('#editor-list'),
  entryForm: document.querySelector('#entry-form'),
  timerForm: document.querySelector('#timer-form'),
  dashboardForm: document.querySelector('#dashboard-form'),
  eventTypeColors: document.querySelector('#event-type-colors'),
  liveViewLink: document.querySelector('#live-view-link'),
  liveViewUrl: document.querySelector('#live-view-url'),
  liveViewQr: document.querySelector('#live-view-qr'),
  addEntry: document.querySelector('#add-entry'),
  duplicateEntry: document.querySelector('#duplicate-entry'),
  deleteEntry: document.querySelector('#delete-entry'),
  sortEntries: document.querySelector('#sort-entries'),
  saveSchedule: document.querySelector('#save-schedule'),
  saveTimers: document.querySelector('#save-timers'),
  saveDashboard: document.querySelector('#save-dashboard'),
  saveNote: document.querySelector('#save-note'),
  savedScheduleName: document.querySelector('#saved-schedule-name'),
  saveNamedSchedule: document.querySelector('#save-named-schedule'),
  savedScheduleSelect: document.querySelector('#saved-schedule-select'),
  loadNamedSchedule: document.querySelector('#load-named-schedule'),
  schedulePreview: document.querySelector('#schedule-preview'),
  progressLog: document.querySelector('#progress-log'),
  stateJson: document.querySelector('#state-json'),
  scheduleJson: document.querySelector('#schedule-json'),
  resetApp: document.querySelector('#reset-app'),
  clearProgressLog: document.querySelector('#clear-progress-log'),
  themeToggle: document.querySelector('#theme-toggle'),
};

function applyTheme(theme) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  editorState.theme = nextTheme;
  document.documentElement.dataset.theme = nextTheme;
  if (editorElements.themeToggle) {
    editorElements.themeToggle.textContent = nextTheme === 'dark' ? 'Day Mode' : 'Night Mode';
    editorElements.themeToggle.setAttribute('aria-pressed', String(nextTheme === 'dark'));
  }
  window.localStorage.setItem('soapbox-theme', nextTheme);
}

function initializeTheme() {
  const savedTheme = window.localStorage.getItem('soapbox-theme');
  const preferredDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(savedTheme || (preferredDark ? 'dark' : 'light'));
}

function toDatetimeLocal(value) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function fromDatetimeLocal(value) {
  return new Date(value).toISOString();
}

function generateEntryId() {
  const ids = new Set(editorState.schedule.map((item) => item.id));
  let index = editorState.schedule.length + 1;
  while (ids.has(`evt_${String(index).padStart(3, '0')}`)) {
    index += 1;
  }
  return `evt_${String(index).padStart(3, '0')}`;
}

function markDirty(isDirty) {
  editorState.dirty = isDirty;
  editorElements.editorStatus.textContent = isDirty ? '編集中' : '準備完了';
  editorElements.saveNote.textContent = isDirty
    ? '未保存の変更があります。'
    : 'schedule.json に保存済みです。';
}

function setStatus(text) {
  editorElements.editorStatus.textContent = text;
}

function renderSavedScheduleControls() {
  const options = editorState.savedSchedules
    .map((item) => {
      const updated = new Date(item.updatedAt).toLocaleString('ja-JP', { hour12: false });
      return `<option value="${item.name}">${item.name} (${updated})</option>`;
    })
    .join('');

  editorElements.savedScheduleSelect.innerHTML = options || '<option value="">保存済みスケジュールなし</option>';
  editorElements.savedScheduleSelect.disabled = editorState.savedSchedules.length === 0;
  editorElements.loadNamedSchedule.disabled = editorState.savedSchedules.length === 0;
}

function getSelectedEntry() {
  return editorState.schedule.find((item) => item.id === editorState.selectedId) || null;
}

function getEntryIndexById(id) {
  return editorState.schedule.findIndex((item) => item.id === id);
}

function insertEntryAt(entry, index) {
  const safeIndex = Math.max(0, Math.min(index, editorState.schedule.length));
  editorState.schedule.splice(safeIndex, 0, entry);
}

function moveEntry(draggingId, targetId) {
  if (!draggingId || !targetId || draggingId === targetId) return false;

  const fromIndex = getEntryIndexById(draggingId);
  const targetIndex = getEntryIndexById(targetId);
  if (fromIndex < 0 || targetIndex < 0) return false;

  const [movedEntry] = editorState.schedule.splice(fromIndex, 1);
  editorState.schedule.splice(targetIndex, 0, movedEntry);
  return true;
}

function clearDragState() {
  editorState.draggingId = null;
  editorElements.editorList
    .querySelectorAll('.editor-card')
    .forEach((card) => card.classList.remove('is-dragging', 'drag-over'));
}

function getDashboardConfig() {
  return editorState.rawState?.dashboardConfig ?? {
    showPerEventSyncButtons: false,
    liveViewMessage: {
      text: '',
      line1: '',
      line2: '',
      blink: false,
    },
    eventTypeColors: {},
  };
}

function getLiveViewUrl() {
  return new URL('/live.html', window.location.origin).toString();
}

function renderLiveViewAccess() {
  const liveViewUrl = getLiveViewUrl();
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=0&data=${encodeURIComponent(liveViewUrl)}`;

  editorElements.liveViewLink.href = liveViewUrl;
  editorElements.liveViewUrl.textContent = liveViewUrl;
  editorElements.liveViewQr.src = qrUrl;
}

function renderList() {
  editorElements.entryCount.textContent = String(editorState.schedule.length);
  editorElements.editorList.innerHTML = editorState.schedule
    .map((item) => `
      <article
        class="editor-card ${item.id === editorState.selectedId ? 'is-current' : ''}"
        data-entry-id="${item.id}"
        draggable="true"
      >
        <div>
          <h3>${item.title}</h3>
          <p>${item.subTitle || 'サブタイトルなし'}</p>
          <span class="schedule-meta">${item.section} / ${item.type}</span>
        </div>
        <div class="schedule-side">
          <strong>${new Date(item.start).toLocaleString('ja-JP', { hour12: false })}</strong>
          <span class="schedule-meta">${item.duration}秒</span>
        </div>
      </article>
    `)
    .join('');
}

function renderForm() {
  const entry = getSelectedEntry();
  if (!entry) {
    editorElements.entryForm.reset();
    return;
  }

  editorElements.entryForm.elements.id.value = entry.id;
  editorElements.entryForm.elements.title.value = entry.title;
  editorElements.entryForm.elements.subTitle.value = entry.subTitle;
  editorElements.entryForm.elements.start.value = toDatetimeLocal(entry.start);
  editorElements.entryForm.elements.duration.value = entry.duration;
  editorElements.entryForm.elements.section.value = entry.section;
  editorElements.entryForm.elements.type.value = entry.type;
}

function renderTimerForm() {
  const timers = editorState.rawState?.timers ?? [];
  editorElements.timerForm.innerHTML = timers
    .map((timer) => `
      <article class="timer-config-card">
        <div>
          <p class="panel-kicker">Timer ${timer.id}</p>
          <h3>${timer.label}</h3>
        </div>
        <label>
          <span>初期値（秒）</span>
          <input type="number" min="1" step="1" name="timer-${timer.id}" value="${timer.initialValue}" />
        </label>
      </article>
    `)
    .join('');
}

function renderDashboardForm() {
  const dashboardConfig = getDashboardConfig();
  const liveViewMessage = dashboardConfig.liveViewMessage ?? {};
  editorElements.dashboardForm.elements.showPerEventSyncButtons.checked = Boolean(
    dashboardConfig.showPerEventSyncButtons
  );
  editorElements.dashboardForm.elements.liveViewMessageLine1.value = liveViewMessage.line1 ?? '';
  editorElements.dashboardForm.elements.liveViewMessageLine2.value = liveViewMessage.line2 ?? '';

  editorElements.eventTypeColors.innerHTML = DASHBOARD_TYPES
    .map((type) => `
      <label class="color-config-card">
        <span>${type}</span>
        <input type="color" name="color-${type}" value="${dashboardConfig.eventTypeColors[type] || '#1d6b48'}" />
      </label>
    `)
    .join('');
}

function renderPreview() {
  editorElements.schedulePreview.textContent = JSON.stringify(editorState.schedule, null, 2);
}

function renderRawJson() {
  editorElements.stateJson.textContent = JSON.stringify(editorState.rawState, null, 2);
  editorElements.scheduleJson.textContent = JSON.stringify(editorState.schedule, null, 2);
}

function renderProgressLog() {
  const logs = editorState.rawState?.progressLog ?? [];
  if (logs.length === 0) {
    editorElements.progressLog.textContent = 'ログはまだありません。';
    return;
  }

  editorElements.progressLog.textContent = logs
    .slice()
    .reverse()
    .map((entry) => {
      const time = new Date(entry.timestamp).toLocaleString('ja-JP', { hour12: false });
      return `${time} | ${entry.action} | ${entry.detail} | ${entry.beforeOffsetSeconds}s -> ${entry.afterOffsetSeconds}s`;
    })
    .join('\n');
}

function renderAll() {
  renderList();
  renderForm();
  renderTimerForm();
  renderDashboardForm();
  renderLiveViewAccess();
  renderSavedScheduleControls();
  renderPreview();
  renderProgressLog();
  renderRawJson();
}

function selectEntry(id) {
  editorState.selectedId = id;
  renderAll();
}

async function loadSchedule() {
  const [scheduleResponse, bootstrapResponse, savedScheduleResponse] = await Promise.all([
    fetch('/api/schedule'),
    fetch('/api/bootstrap'),
    fetch('/api/saved-schedules'),
  ]);
  const scheduleData = await scheduleResponse.json();
  const bootstrapData = await bootstrapResponse.json();
  const savedScheduleData = await savedScheduleResponse.json();
  editorState.schedule = scheduleData.schedule;
  editorState.rawState = {
    ...bootstrapData.state,
    progressLog: bootstrapData.progressLog ?? [],
  };
  editorState.savedSchedules = savedScheduleData.savedSchedules ?? [];
  editorState.selectedId = scheduleData.schedule[0]?.id ?? null;
  markDirty(false);
  renderAll();
}

editorElements.editorList.addEventListener('click', (event) => {
  const card = event.target.closest('[data-entry-id]');
  if (card) {
    selectEntry(card.dataset.entryId);
  }
});

document.addEventListener('click', (event) => {
  if (event.target.closest('#theme-toggle')) {
    applyTheme(editorState.theme === 'dark' ? 'light' : 'dark');
  }
});

editorElements.editorList.addEventListener('dragstart', (event) => {
  const card = event.target.closest('[data-entry-id]');
  if (!card) return;

  editorState.draggingId = card.dataset.entryId;
  card.classList.add('is-dragging');
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', editorState.draggingId);
  }
});

editorElements.editorList.addEventListener('dragover', (event) => {
  const card = event.target.closest('[data-entry-id]');
  if (!card || card.dataset.entryId === editorState.draggingId) return;

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }

  editorElements.editorList
    .querySelectorAll('.editor-card.drag-over')
    .forEach((node) => node.classList.remove('drag-over'));
  card.classList.add('drag-over');
});

editorElements.editorList.addEventListener('dragleave', (event) => {
  const card = event.target.closest('[data-entry-id]');
  if (card) {
    card.classList.remove('drag-over');
  }
});

editorElements.editorList.addEventListener('drop', (event) => {
  const card = event.target.closest('[data-entry-id]');
  if (!card) return;

  event.preventDefault();
  const moved = moveEntry(editorState.draggingId, card.dataset.entryId);
  clearDragState();
  if (!moved) return;

  markDirty(true);
  renderAll();
  setStatus('スケジュール順を更新しました');
});

editorElements.editorList.addEventListener('dragend', () => {
  clearDragState();
});

editorElements.addEntry.addEventListener('click', () => {
  const start = new Date();
  start.setMinutes(start.getMinutes() + 5);
  start.setSeconds(0, 0);

  const entry = {
    id: generateEntryId(),
    title: '新規イベント',
    subTitle: '',
    start: start.toISOString(),
    duration: 300,
    section: 'メインステージ',
    type: 'normal',
  };

  const selectedIndex = getEntryIndexById(editorState.selectedId);
  insertEntryAt(entry, selectedIndex >= 0 ? selectedIndex + 1 : editorState.schedule.length);
  selectEntry(entry.id);
  markDirty(true);
});

editorElements.entryForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const entry = getSelectedEntry();
  if (!entry) return;

  const form = editorElements.entryForm.elements;
  const nextId = form.id.value.trim();
  const hasConflict = editorState.schedule.some(
    (item) => item.id === nextId && item.id !== entry.id
  );

  if (hasConflict) {
    setStatus('ID が重複しています');
    return;
  }

  entry.id = nextId;
  entry.title = form.title.value.trim();
  entry.subTitle = form.subTitle.value.trim();
  entry.start = fromDatetimeLocal(form.start.value);
  entry.duration = Number(form.duration.value);
  entry.section = form.section.value.trim();
  entry.type = form.type.value;
  editorState.selectedId = entry.id;
  markDirty(true);
  renderAll();
});

editorElements.duplicateEntry.addEventListener('click', () => {
  const entry = getSelectedEntry();
  if (!entry) return;

  const copy = {
    ...entry,
    id: generateEntryId(),
    title: `${entry.title} 複製`,
  };

  const sourceIndex = getEntryIndexById(entry.id);
  insertEntryAt(copy, sourceIndex >= 0 ? sourceIndex + 1 : editorState.schedule.length);
  selectEntry(copy.id);
  markDirty(true);
});

editorElements.deleteEntry.addEventListener('click', () => {
  const entry = getSelectedEntry();
  if (!entry) return;

  editorState.schedule = editorState.schedule.filter((item) => item.id !== entry.id);
  editorState.selectedId = editorState.schedule[0]?.id ?? null;
  markDirty(true);
  renderAll();
});

editorElements.sortEntries.addEventListener('click', () => {
  editorState.schedule.sort((a, b) => new Date(a.start) - new Date(b.start));
  markDirty(true);
  renderAll();
});

editorElements.saveSchedule.addEventListener('click', async () => {
  const response = await fetch('/api/schedule', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schedule: editorState.schedule }),
  });

  if (!response.ok) {
    setStatus('保存に失敗しました');
    return;
  }

  await loadSchedule();
});

editorElements.saveNamedSchedule.addEventListener('click', async () => {
  const requestedName = editorElements.savedScheduleName.value.trim();
  if (!requestedName) {
    setStatus('保存名を入力してください');
    editorElements.savedScheduleName.focus();
    return;
  }

  const response = await fetch('/api/saved-schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: requestedName,
      schedule: editorState.schedule,
    }),
  });

  if (!response.ok) {
    setStatus('名前付き保存に失敗しました');
    return;
  }

  const result = await response.json();
  editorElements.savedScheduleName.value = result.name;
  await loadSchedule();
  setStatus(`"${result.name}" を保存しました`);
});

editorElements.loadNamedSchedule.addEventListener('click', async () => {
  const selectedName = editorElements.savedScheduleSelect.value;
  if (!selectedName) {
    setStatus('読み込むスケジュールを選んでください');
    return;
  }

  const response = await fetch('/api/saved-schedules/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: selectedName }),
  });

  if (!response.ok) {
    setStatus('スケジュールの読み込みに失敗しました');
    return;
  }

  await loadSchedule();
  setStatus(`"${selectedName}" を読み込みました`);
});

editorElements.saveTimers.addEventListener('click', async () => {
  const timers = (editorState.rawState?.timers ?? []).map((timer) => ({
    id: timer.id,
    initialValue: Number(editorElements.timerForm.elements[`timer-${timer.id}`].value),
  }));

  const response = await fetch('/api/timers', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timers }),
  });

  if (!response.ok) {
    setStatus('タイマー設定の保存に失敗しました');
    return;
  }

  setStatus('タイマー設定を保存しました');
  await loadSchedule();
});

editorElements.saveDashboard.addEventListener('click', async () => {
  const line1 = editorElements.dashboardForm.elements.liveViewMessageLine1.value.trim();
  const line2 = editorElements.dashboardForm.elements.liveViewMessageLine2.value.trim();
  const eventTypeColors = Object.fromEntries(
    DASHBOARD_TYPES.map((type) => [
      type,
      editorElements.dashboardForm.elements[`color-${type}`].value,
    ])
  );

  const response = await fetch('/api/dashboard-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      showPerEventSyncButtons: editorElements.dashboardForm.elements.showPerEventSyncButtons.checked,
      liveViewMessage: {
        text: [line1, line2].filter(Boolean).join('\n'),
        line1,
        line2,
        blink: Boolean(getDashboardConfig().liveViewMessage?.blink),
      },
      eventTypeColors,
    }),
  });

  if (!response.ok) {
    setStatus('ダッシュボード設定の保存に失敗しました');
    return;
  }

  setStatus('ダッシュボード設定を保存しました');
  await loadSchedule();
});

editorElements.resetApp.addEventListener('click', async () => {
  const confirmed = window.confirm(
    '進行状態、タイマー、スケジュール表示位置を初期値に戻します。続けますか？'
  );
  if (!confirmed) return;

  await fetch('/api/reset', { method: 'POST' });
  await loadSchedule();
  setStatus('状態を初期値に戻しました');
});

editorElements.clearProgressLog.addEventListener('click', async () => {
  await fetch('/api/progress-log', { method: 'DELETE' });
  setStatus('進行ログをクリアしました');
  await loadSchedule();
});

loadSchedule();
initializeTheme();
