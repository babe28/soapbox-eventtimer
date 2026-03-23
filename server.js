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

const createDefaultState = () => ({
  globalOffsetSeconds: 0,
  isPaused: false,
  timers: [
    {
      id: 1,
      label: 'Main Timer',
      mode: 'down',
      status: 'stopped',
      value: 180,
      initialValue: 180,
      lastUpdate: Date.now(),
    },
    {
      id: 2,
      label: 'Stage Reset Buffer',
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
    createScheduleItem('evt_001', 'Opening', 'MC Intro', new Date(base), 300, 'Main Stage', 'normal'),
    createScheduleItem('evt_002', 'Guest Talk', 'Interview Segment', new Date(base.getTime() + 5 * 60 * 1000), 900, 'Main Stage', 'normal'),
    createScheduleItem('evt_003', 'Break', 'Sponsor Roll', new Date(base.getTime() + 20 * 60 * 1000), 300, 'Main Stage', 'break'),
    createScheduleItem('evt_004', 'Panel Session', 'Community Update', new Date(base.getTime() + 25 * 60 * 1000), 1200, 'Side Stage', 'normal'),
    createScheduleItem('evt_005', 'Closing', 'Wrap-up', new Date(base.getTime() + 45 * 60 * 1000), 300, 'Main Stage', 'normal'),
  ];
};

let state = createDefaultState();
let schedule = createDefaultSchedule();

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

    const elapsedSeconds = Math.max(
      0,
      Math.floor((referenceTime - timer.lastUpdate) / 1000)
    );

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
    serverTime: referenceTime,
  };
}

async function persistState() {
  await saveJson(STATE_PATH, state);
}

async function persistSchedule() {
  await saveJson(SCHEDULE_PATH, schedule);
}

async function syncAll() {
  const payload = getPayload();
  await persistState();
  io.emit('sync_state', payload);
}

function findTimer(timerId) {
  return state.timers.find((timer) => String(timer.id) === String(timerId));
}

function applyTimerAction(timer, action, value) {
  if (!timer) {
    return false;
  }

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

async function initializeData() {
  await ensureJsonFile(STATE_PATH, createDefaultState);
  await ensureJsonFile(SCHEDULE_PATH, createDefaultSchedule);

  state = loadState(await loadJson(STATE_PATH));
  schedule = loadSchedule(await loadJson(SCHEDULE_PATH));
  updateCurrentScheduleId();
  await persistState();
  await persistSchedule();
}

function loadState(source) {
  const fallback = createDefaultState();
  const loadedTimers = Array.isArray(source?.timers) ? source.timers : fallback.timers;

  return {
    globalOffsetSeconds: Number(source?.globalOffsetSeconds ?? fallback.globalOffsetSeconds),
    isPaused: Boolean(source?.isPaused ?? fallback.isPaused),
    currentScheduleId: source?.currentScheduleId ?? fallback.currentScheduleId,
    timers: loadedTimers.map((timer, index) => {
      const fallbackTimer = fallback.timers[index] ?? fallback.timers[0];
      return {
        id: timer.id ?? fallbackTimer.id,
        label: timer.label ?? fallbackTimer.label,
        mode: timer.mode === 'up' ? 'up' : 'down',
        status: ['running', 'paused', 'stopped'].includes(timer.status)
          ? timer.status
          : 'stopped',
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

  return source.map((item, index) => ({
    id: item.id ?? `evt_${String(index + 1).padStart(3, '0')}`,
    title: item.title ?? `Event ${index + 1}`,
    subTitle: item.subTitle ?? '',
    start: item.start ?? new Date().toISOString(),
    duration: Number(item.duration ?? 300),
    section: item.section ?? 'Main Stage',
    type: item.type ?? 'normal',
  }));
}

io.on('connection', (socket) => {
  socket.emit('sync_state', getPayload());

  socket.on('update_offset', async (deltaSeconds) => {
    state.globalOffsetSeconds += Number(deltaSeconds || 0);
    await syncAll();
  });

  socket.on('resync', async (itemId) => {
    const item = schedule.find((entry) => entry.id === itemId);
    if (!item) {
      return;
    }

    const originalStart = new Date(item.start).getTime();
    state.globalOffsetSeconds = Math.floor((Date.now() - originalStart) / 1000);
    await syncAll();
  });

  socket.on('control_timer', async ({ id, action, value }) => {
    const timer = findTimer(id);
    if (!applyTimerAction(timer, action, value)) {
      return;
    }
    await syncAll();
  });
});

app.get('/api/bootstrap', (_req, res) => {
  res.json(getPayload());
});

app.post('/api/offset', async (req, res) => {
  state.globalOffsetSeconds += Number(req.body?.value || 0);
  await syncAll();
  res.json({ success: true, state: getPayload().state });
});

app.post('/api/resync', async (req, res) => {
  const item = schedule.find((entry) => entry.id === req.body?.id);
  if (!item) {
    res.status(404).json({ success: false, message: 'Schedule item not found.' });
    return;
  }

  const originalStart = new Date(item.start).getTime();
  state.globalOffsetSeconds = Math.floor((Date.now() - originalStart) / 1000);
  await syncAll();
  res.json({ success: true, state: getPayload().state });
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
  await persistState();
  await persistSchedule();
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
