const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3333;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const SCHEDULE_PATH = path.join(DATA_DIR, 'schedule.json');
const LOG_PATH = path.join(DATA_DIR, 'progress-log.json');
const SAVED_SCHEDULES_DIR = path.join(DATA_DIR, 'schedules');

function createDefaultDashboardConfig() {
  return {
    showPerEventSyncButtons: false,
    eventTypeColors: {
      normal: '#1d6b48',
      break: '#b07300',
      buffer: '#3d6ea8',
      special: '#b14d1d',
      race: '#7d245c',
    },
  };
}

const createDefaultState = () => ({
  globalOffsetSeconds: 0,
  isPaused: false,
  dashboardConfig: createDefaultDashboardConfig(),
  timers: [
    {
      id: 1,
      label: '進行タイマー',
      mode: 'down',
      status: 'stopped',
      value: 180,
      initialValue: 180,
      lastUpdate: Date.now(),
    },
    {
      id: 2,
      label: '転換バッファ',
      mode: 'down',
      status: 'stopped',
      value: 600,
      initialValue: 600,
      lastUpdate: Date.now(),
    },
  ],
  currentScheduleId: null,
});

function createScheduleItem(id, title, subTitle, startTime, duration, section, type) {
  return {
    id,
    title,
    subTitle,
    start: startTime.toISOString(),
    duration,
    section,
    type,
  };
}

const createDefaultSchedule = () => {
  const base = new Date();
  base.setSeconds(0, 0);
  base.setMinutes(Math.floor(base.getMinutes() / 5) * 5);
  base.setTime(base.getTime() - 5 * 60 * 1000);

  return [
    createScheduleItem('evt_001', 'オープニング', 'MC オープン', new Date(base), 300, 'メインステージ', 'normal'),
    createScheduleItem('evt_002', 'ゲストトーク', 'インタビューセッション', new Date(base.getTime() + 5 * 60 * 1000), 900, 'メインステージ', 'normal'),
    createScheduleItem('evt_003', 'レース1', '予選ヒート', new Date(base.getTime() + 20 * 60 * 1000), 300, 'コースA', 'race'),
    createScheduleItem('evt_004', '休憩', 'スポンサー紹介', new Date(base.getTime() + 25 * 60 * 1000), 300, 'メインステージ', 'break'),
    createScheduleItem('evt_005', 'パネルセッション', 'コミュニティアップデート', new Date(base.getTime() + 30 * 60 * 1000), 900, 'サブステージ', 'special'),
    createScheduleItem('evt_006', 'クロージング', 'まとめとご案内', new Date(base.getTime() + 45 * 60 * 1000), 300, 'メインステージ', 'normal'),
  ];
};

let state = createDefaultState();
let schedule = createDefaultSchedule();
let progressLog = [];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const clone = (value) => JSON.parse(JSON.stringify(value));

async function ensureJsonFile(filePath, factory) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(factory(), null, 2));
  }
}

async function loadJson(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

async function saveJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

function normalizeScheduleFileName(value) {
  return String(value || '')
    .trim()
    .replace(/\.json$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function getSavedSchedulePath(name) {
  return path.join(SAVED_SCHEDULES_DIR, `${name}.json`);
}

async function listSavedSchedules() {
  await fs.mkdir(SAVED_SCHEDULES_DIR, { recursive: true });
  const entries = await fs.readdir(SAVED_SCHEDULES_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => entry.name);

  const schedules = await Promise.all(files.map(async (fileName) => {
    const filePath = path.join(SAVED_SCHEDULES_DIR, fileName);
    const stats = await fs.stat(filePath);
    return {
      name: path.basename(fileName, '.json'),
      fileName,
      updatedAt: stats.mtime.toISOString(),
    };
  }));

  schedules.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return schedules;
}

async function saveNamedSchedule(name, sourceSchedule) {
  const normalizedName = normalizeScheduleFileName(name);
  if (!normalizedName) {
    return null;
  }

  const nextSchedule = loadSchedule(sourceSchedule);
  await fs.mkdir(SAVED_SCHEDULES_DIR, { recursive: true });
  await saveJson(getSavedSchedulePath(normalizedName), nextSchedule);
  return normalizedName;
}

async function loadNamedSchedule(name) {
  const normalizedName = normalizeScheduleFileName(name);
  if (!normalizedName) {
    return null;
  }

  try {
    const loaded = await loadJson(getSavedSchedulePath(normalizedName));
    return {
      name: normalizedName,
      schedule: loadSchedule(loaded),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function normalizeDashboardConfig(source) {
  const fallback = createDefaultDashboardConfig();
  const colors = source?.eventTypeColors ?? {};

  return {
    showPerEventSyncButtons: Boolean(source?.showPerEventSyncButtons),
    eventTypeColors: {
      normal: String(colors.normal || fallback.eventTypeColors.normal),
      break: String(colors.break || fallback.eventTypeColors.break),
      buffer: String(colors.buffer || fallback.eventTypeColors.buffer),
      special: String(colors.special || fallback.eventTypeColors.special),
      race: String(colors.race || fallback.eventTypeColors.race),
    },
  };
}

function updateCurrentScheduleId(referenceTime = Date.now()) {
  const displayedNow = referenceTime + state.globalOffsetSeconds * 1000;
  const currentItem = schedule.find((item) => {
    const start = new Date(item.start).getTime();
    const end = start + item.duration * 1000;
    return displayedNow >= start && displayedNow < end;
  });

  state.currentScheduleId = currentItem ? currentItem.id : null;
}

function advanceTimers(referenceTime = Date.now()) {
  state.timers = state.timers.map((timer) => {
    if (timer.status !== 'running') {
      return timer;
    }

    const elapsedSeconds = Math.max(0, Math.floor((referenceTime - timer.lastUpdate) / 1000));
    if (elapsedSeconds === 0) {
      return timer;
    }

    const nextValue = timer.mode === 'up'
      ? timer.value + elapsedSeconds
      : Math.max(0, timer.value - elapsedSeconds);

    return {
      ...timer,
      value: nextValue,
      status: timer.mode === 'down' && nextValue === 0 ? 'stopped' : timer.status,
      lastUpdate: referenceTime,
    };
  });
}

function getPayload(referenceTime = Date.now()) {
  advanceTimers(referenceTime);
  updateCurrentScheduleId(referenceTime);

  return {
    state: clone(state),
    schedule: clone(schedule),
    progressLog: clone(progressLog),
    serverTime: referenceTime,
  };
}

async function persistState() {
  await saveJson(STATE_PATH, state);
}

async function persistSchedule() {
  await saveJson(SCHEDULE_PATH, schedule);
}

async function persistProgressLog() {
  await saveJson(LOG_PATH, progressLog);
}

async function syncAll() {
  const payload = getPayload();
  await persistState();
  io.emit('sync_state', payload);
}

async function appendProgressLog(entry) {
  progressLog.push({
    id: `log_${Date.now()}`,
    timestamp: new Date().toISOString(),
    ...entry,
  });

  if (progressLog.length > 500) {
    progressLog = progressLog.slice(-500);
  }

  await persistProgressLog();
}

function findTimer(timerId) {
  return state.timers.find((timer) => String(timer.id) === String(timerId));
}

function normalizeScheduleItem(item, index) {
  const parsedStart = item?.start ? new Date(item.start) : new Date();
  const start = Number.isNaN(parsedStart.getTime())
    ? new Date().toISOString()
    : parsedStart.toISOString();
  const numericDuration = Number(item?.duration ?? 300);
  const validTypes = ['normal', 'break', 'buffer', 'special', 'race'];

  return {
    id: String(item?.id || `evt_${String(index + 1).padStart(3, '0')}`),
    title: String(item?.title || `イベント ${index + 1}`),
    subTitle: String(item?.subTitle || ''),
    start,
    duration: Number.isFinite(numericDuration) && numericDuration > 0 ? Math.round(numericDuration) : 300,
    section: String(item?.section || 'メインステージ'),
    type: validTypes.includes(item?.type) ? item.type : 'normal',
  };
}

function applyTimerAction(timer, action, value) {
  if (!timer) return false;

  advanceTimers();

  if (action === 'start') {
    timer.status = 'running';
  }

  if (action === 'pause' && timer.status !== 'stopped') {
    timer.status = timer.status === 'paused' ? 'running' : 'paused';
  }

  if (action === 'reset') {
    timer.status = 'stopped';
    timer.value = Number(value ?? timer.initialValue);
  }

  timer.lastUpdate = Date.now();
  return true;
}

function getScheduleIndexByCurrent(referenceTime = Date.now()) {
  const displayedNow = referenceTime + state.globalOffsetSeconds * 1000;
  return schedule.findIndex((item) => {
    const start = new Date(item.start).getTime();
    const end = start + item.duration * 1000;
    return displayedNow >= start && displayedNow < end;
  });
}

function shiftSchedule(action, referenceTime = Date.now()) {
  if (schedule.length === 0) return false;

  const currentIndex = getScheduleIndexByCurrent(referenceTime);
  const displayedNow = referenceTime + state.globalOffsetSeconds * 1000;

  if (action === 'hold') {
    const item = currentIndex >= 0 ? schedule[currentIndex] : schedule[0];
    const start = new Date(item.start).getTime();
    const safeTime = Math.min(displayedNow, start + item.duration * 1000 - 1000);
    state.globalOffsetSeconds = Math.floor((safeTime - referenceTime) / 1000);
    return true;
  }

  if (action === 'next') {
    const baseIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
    const nextItem = schedule[Math.min(baseIndex, schedule.length - 1)];
    if (!nextItem) return false;
    state.globalOffsetSeconds = Math.floor((new Date(nextItem.start).getTime() - referenceTime) / 1000);
    return true;
  }

  if (action === 'previous') {
    const baseIndex = currentIndex > 0 ? currentIndex - 1 : 0;
    const previousItem = schedule[baseIndex];
    if (!previousItem) return false;
    state.globalOffsetSeconds = Math.floor((new Date(previousItem.start).getTime() - referenceTime + 1000) / 1000);
    return true;
  }

  return false;
}

function resyncToSchedule(scheduleId, referenceTime = Date.now()) {
  const item = schedule.find((entry) => entry.id === scheduleId);
  if (!item) return false;
  state.globalOffsetSeconds = Math.floor((new Date(item.start).getTime() - referenceTime + 1000) / 1000);
  return true;
}

async function initializeData() {
  await ensureJsonFile(STATE_PATH, createDefaultState);
  await ensureJsonFile(SCHEDULE_PATH, createDefaultSchedule);
  await ensureJsonFile(LOG_PATH, () => []);
  await fs.mkdir(SAVED_SCHEDULES_DIR, { recursive: true });

  state = loadState(await loadJson(STATE_PATH));
  schedule = loadSchedule(await loadJson(SCHEDULE_PATH));
  progressLog = loadProgressLog(await loadJson(LOG_PATH));
  updateCurrentScheduleId();
  await persistState();
  await persistSchedule();
  await persistProgressLog();
}

function loadState(source) {
  const fallback = createDefaultState();
  const loadedTimers = Array.isArray(source?.timers) ? source.timers : fallback.timers;

  return {
    globalOffsetSeconds: Number(source?.globalOffsetSeconds ?? fallback.globalOffsetSeconds),
    isPaused: Boolean(source?.isPaused ?? fallback.isPaused),
    currentScheduleId: source?.currentScheduleId ?? fallback.currentScheduleId,
    dashboardConfig: normalizeDashboardConfig(source?.dashboardConfig),
    timers: loadedTimers.map((timer, index) => {
      const fallbackTimer = fallback.timers[index] ?? fallback.timers[0];
      return {
        id: timer.id ?? fallbackTimer.id,
        label: timer.label ?? fallbackTimer.label,
        mode: timer.mode === 'up' ? 'up' : 'down',
        status: ['running', 'paused', 'stopped'].includes(timer.status) ? timer.status : 'stopped',
        value: Number(timer.value ?? fallbackTimer.value),
        initialValue: Number(timer.initialValue ?? fallbackTimer.initialValue),
        lastUpdate: Number(timer.lastUpdate ?? Date.now()),
      };
    }),
  };
}

function loadSchedule(source) {
  if (!Array.isArray(source) || source.length === 0) {
    return createDefaultSchedule();
  }

  return source.map((item, index) => normalizeScheduleItem(item, index));
}

function loadProgressLog(source) {
  if (!Array.isArray(source)) {
    return [];
  }

  return source.map((entry, index) => ({
    id: String(entry?.id || `log_${index + 1}`),
    timestamp: String(entry?.timestamp || new Date().toISOString()),
    action: String(entry?.action || 'unknown'),
    detail: String(entry?.detail || ''),
    beforeOffsetSeconds: Number(entry?.beforeOffsetSeconds ?? 0),
    afterOffsetSeconds: Number(entry?.afterOffsetSeconds ?? 0),
  }));
}

io.on('connection', (socket) => {
  socket.emit('sync_state', getPayload());
});

app.get('/api/bootstrap', (_req, res) => {
  res.json(getPayload());
});

app.get('/api/schedule', (_req, res) => {
  res.json({ schedule: clone(schedule) });
});

app.get('/api/saved-schedules', async (_req, res) => {
  const savedSchedules = await listSavedSchedules();
  res.json({ savedSchedules });
});

app.post('/api/saved-schedules', async (req, res) => {
  const savedName = await saveNamedSchedule(req.body?.name, req.body?.schedule ?? schedule);
  if (!savedName) {
    res.status(400).json({ success: false, message: 'A valid schedule name is required.' });
    return;
  }

  res.json({
    success: true,
    name: savedName,
    savedSchedules: await listSavedSchedules(),
  });
});

app.post('/api/saved-schedules/load', async (req, res) => {
  const loaded = await loadNamedSchedule(req.body?.name);
  if (!loaded) {
    res.status(404).json({ success: false, message: 'Saved schedule not found.' });
    return;
  }

  schedule = loaded.schedule;
  updateCurrentScheduleId();
  await persistSchedule();
  await persistState();
  io.emit('sync_state', getPayload());
  res.json({
    success: true,
    name: loaded.name,
    schedule: clone(schedule),
    savedSchedules: await listSavedSchedules(),
  });
});

app.put('/api/schedule', async (req, res) => {
  if (!Array.isArray(req.body?.schedule)) {
    res.status(400).json({ success: false, message: 'schedule must be an array.' });
    return;
  }

  schedule = req.body.schedule.map((item, index) => normalizeScheduleItem(item, index));
  updateCurrentScheduleId();
  await persistSchedule();
  await persistState();
  io.emit('sync_state', getPayload());
  res.json({ success: true, schedule: clone(schedule) });
});

app.put('/api/timers', async (req, res) => {
  if (!Array.isArray(req.body?.timers)) {
    res.status(400).json({ success: false, message: 'timers must be an array.' });
    return;
  }

  const updates = new Map(
    req.body.timers.map((timer) => [String(timer.id), Math.max(1, Math.round(Number(timer.initialValue || 0)))])
  );

  state.timers = state.timers.map((timer) => {
    const nextInitialValue = updates.get(String(timer.id));
    if (!nextInitialValue) return timer;

    return {
      ...timer,
      status: 'stopped',
      initialValue: nextInitialValue,
      value: nextInitialValue,
      lastUpdate: Date.now(),
    };
  });

  await syncAll();
  res.json({ success: true, state: clone(state) });
});

app.put('/api/dashboard-config', async (req, res) => {
  state.dashboardConfig = normalizeDashboardConfig(req.body);
  await syncAll();
  res.json({ success: true, dashboardConfig: clone(state.dashboardConfig) });
});

app.post('/api/offset', async (req, res) => {
  const beforeOffsetSeconds = state.globalOffsetSeconds;
  state.globalOffsetSeconds += Number(req.body?.value || 0);
  await appendProgressLog({
    action: 'offset',
    detail: `手動オフセット ${Number(req.body?.value || 0)}秒`,
    beforeOffsetSeconds,
    afterOffsetSeconds: state.globalOffsetSeconds,
  });
  await syncAll();
  res.json({ success: true, state: getPayload().state });
});

app.post('/api/resync', async (req, res) => {
  const beforeOffsetSeconds = state.globalOffsetSeconds;
  if (!resyncToSchedule(req.body?.id)) {
    res.status(404).json({ success: false, message: 'Schedule item not found.' });
    return;
  }

  const targetItem = schedule.find((entry) => entry.id === req.body?.id);
  await appendProgressLog({
    action: 'resync',
    detail: `イベント同期 ${targetItem ? targetItem.title : req.body?.id}`,
    beforeOffsetSeconds,
    afterOffsetSeconds: state.globalOffsetSeconds,
  });
  await syncAll();
  res.json({ success: true, state: getPayload().state });
});

app.post('/api/schedule/shift', async (req, res) => {
  const beforeOffsetSeconds = state.globalOffsetSeconds;
  if (!shiftSchedule(req.body?.action)) {
    res.status(400).json({ success: false, message: 'Invalid schedule shift action.' });
    return;
  }

  await appendProgressLog({
    action: 'shift',
    detail: `強制移動 ${String(req.body?.action || '')}`,
    beforeOffsetSeconds,
    afterOffsetSeconds: state.globalOffsetSeconds,
  });
  await syncAll();
  res.json({ success: true, state: getPayload().state });
});

app.delete('/api/progress-log', async (_req, res) => {
  progressLog = [];
  await persistProgressLog();
  io.emit('sync_state', getPayload());
  res.json({ success: true });
});

app.post('/api/timer/:id/:action', async (req, res) => {
  const timer = findTimer(req.params.id);
  if (!timer) {
    res.status(404).json({ success: false, message: 'Timer not found.' });
    return;
  }

  applyTimerAction(timer, req.params.action, req.body?.value);
  await syncAll();
  res.json({ success: true, timer });
});

app.post('/api/reset', async (_req, res) => {
  state = createDefaultState();
  schedule = createDefaultSchedule();
  progressLog = [];
  await persistState();
  await persistSchedule();
  await persistProgressLog();
  io.emit('sync_state', getPayload());
  res.json({ success: true });
});

initializeData()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize app data.', error);
    process.exitCode = 1;
  });
