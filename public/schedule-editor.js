const editorState = {
  schedule: [],
  selectedId: null,
  dirty: false,
  rawState: null,
};

const editorElements = {
  entryCount: document.querySelector('#entry-count'),
  editorStatus: document.querySelector('#editor-status'),
  editorList: document.querySelector('#editor-list'),
  entryForm: document.querySelector('#entry-form'),
  addEntry: document.querySelector('#add-entry'),
  duplicateEntry: document.querySelector('#duplicate-entry'),
  deleteEntry: document.querySelector('#delete-entry'),
  sortEntries: document.querySelector('#sort-entries'),
  saveSchedule: document.querySelector('#save-schedule'),
  saveNote: document.querySelector('#save-note'),
  schedulePreview: document.querySelector('#schedule-preview'),
  stateJson: document.querySelector('#state-json'),
  scheduleJson: document.querySelector('#schedule-json'),
  resetApp: document.querySelector('#reset-app'),
};

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

function getSelectedEntry() {
  return editorState.schedule.find((item) => item.id === editorState.selectedId) || null;
}

function renderList() {
  editorElements.entryCount.textContent = String(editorState.schedule.length);
  editorElements.editorList.innerHTML = editorState.schedule
    .map((item) => `
      <article class="editor-card ${item.id === editorState.selectedId ? 'is-current' : ''}" data-entry-id="${item.id}">
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

function renderPreview() {
  editorElements.schedulePreview.textContent = JSON.stringify(editorState.schedule, null, 2);
}

function renderRawJson() {
  editorElements.stateJson.textContent = JSON.stringify(editorState.rawState, null, 2);
  editorElements.scheduleJson.textContent = JSON.stringify(editorState.schedule, null, 2);
}

function renderAll() {
  renderList();
  renderForm();
  renderPreview();
  renderRawJson();
}

function selectEntry(id) {
  editorState.selectedId = id;
  renderAll();
}

async function loadSchedule() {
  const [scheduleResponse, bootstrapResponse] = await Promise.all([
    fetch('/api/schedule'),
    fetch('/api/bootstrap'),
  ]);
  const scheduleData = await scheduleResponse.json();
  const bootstrapData = await bootstrapResponse.json();
  editorState.schedule = scheduleData.schedule;
  editorState.rawState = bootstrapData.state;
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

  editorState.schedule.push(entry);
  selectEntry(entry.id);
  markDirty(true);
});

editorElements.entryForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const entry = getSelectedEntry();
  if (!entry) {
    return;
  }

  const form = editorElements.entryForm.elements;
  const nextId = form.id.value.trim();
  const hasConflict = editorState.schedule.some(
    (item) => item.id === nextId && item.id !== entry.id
  );

  if (hasConflict) {
    editorElements.editorStatus.textContent = 'ID が重複しています';
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
  if (!entry) {
    return;
  }

  const copy = {
    ...entry,
    id: generateEntryId(),
    title: `${entry.title} 複製`,
  };

  editorState.schedule.push(copy);
  selectEntry(copy.id);
  markDirty(true);
});

editorElements.deleteEntry.addEventListener('click', () => {
  const entry = getSelectedEntry();
  if (!entry) {
    return;
  }

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
    editorElements.editorStatus.textContent = '保存に失敗しました';
    return;
  }

  const data = await response.json();
  editorState.schedule = data.schedule;
  if (!editorState.schedule.some((item) => item.id === editorState.selectedId)) {
    editorState.selectedId = editorState.schedule[0]?.id ?? null;
  }
  await loadSchedule();
});

editorElements.resetApp.addEventListener('click', async () => {
  await fetch('/api/reset', { method: 'POST' });
  await loadSchedule();
});

loadSchedule();
