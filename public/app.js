const state = {
  payload: {
    state: null,
    schedule: [],
    serverTime: Date.now(),
  },
};

const socket = io();

const elements = {
  socketStatus: document.querySelector('#socket-status'),
  displayedTime: document.querySelector('#displayed-time'),
  offsetSeconds: document.querySelector('#offset-seconds'),
  currentSchedule: document.querySelector('#current-schedule'),
  scheduleCount: document.querySelector('#schedule-count'),
  currentEvent: document.querySelector('#current-event'),
  scheduleList: document.querySelector('#schedule-list'),
  timerList: document.querySelector('#timer-list'),
};

function formatClock(value) {
  return new Date(value).toLocaleTimeString('ja-JP', {
    hour12: false,
  });
}

function formatSeconds(totalSeconds) {
  const sign = totalSeconds < 0 ? '-' : '';
  const abs = Math.abs(totalSeconds);
  const hours = String(Math.floor(abs / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
  const seconds = String(abs % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}:${seconds}`;
}

function formatTimerStatus(status) {
  if (status === 'running') {
    return '動作中';
  }

  if (status === 'paused') {
    return '一時停止';
  }

  return '停止中';
}

function getDisplayedNow() {
  const currentState = state.payload.state;
  if (!currentState) {
    return Date.now();
  }

  return Date.now() + currentState.globalOffsetSeconds * 1000;
}

function renderOverview() {
  const currentState = state.payload.state;
  if (!currentState) {
    return;
  }

  elements.offsetSeconds.textContent = `${currentState.globalOffsetSeconds}s`;
  elements.scheduleCount.textContent = String(state.payload.schedule.length);

  const currentItem = state.payload.schedule.find(
    (item) => item.id === currentState.currentScheduleId
  );
  elements.currentSchedule.textContent = currentItem
    ? `${currentItem.title} / ${currentItem.section}`
    : '待機中';
}

function renderCurrentEvent() {
  const currentState = state.payload.state;
  const displayedNow = getDisplayedNow();
  const currentItem = state.payload.schedule.find(
    (item) => item.id === currentState?.currentScheduleId
  );

  if (!currentItem) {
    elements.currentEvent.innerHTML = `
      <p class="empty-state">進行中のイベントはありません。</p>
    `;
    return;
  }

  const start = new Date(currentItem.start).getTime();
  const elapsed = Math.max(0, Math.floor((displayedNow - start) / 1000));
  const remaining = Math.max(0, currentItem.duration - elapsed);
  const progress = Math.min(100, Math.max(0, (elapsed / currentItem.duration) * 100));

  elements.currentEvent.innerHTML = `
    <div class="current-event-head">
      <div>
        <p class="current-event-section">${currentItem.section} / ${currentItem.type}</p>
        <h3>${currentItem.title}</h3>
        <p class="current-event-subtitle">${currentItem.subTitle || 'サブタイトルなし'}</p>
      </div>
      <div class="current-event-clock">
        <span>開始 ${formatClock(start)}</span>
        <strong>${formatSeconds(remaining)}</strong>
      </div>
    </div>
    <div class="progress-meta">
      <span>経過 ${formatSeconds(elapsed)}</span>
      <span>進行率 ${Math.round(progress)}%</span>
    </div>
    <div class="progress-bar" aria-hidden="true">
      <span style="width: ${progress}%"></span>
    </div>
  `;
}

function renderSchedule() {
  const currentState = state.payload.state;
  const displayedNow = getDisplayedNow();

  elements.scheduleList.innerHTML = state.payload.schedule
    .map((item) => {
      const start = new Date(item.start).getTime();
      const end = start + item.duration * 1000;
      const isCurrent = currentState?.currentScheduleId === item.id;
      const delta = Math.floor((displayedNow - start) / 1000);
      const status = displayedNow < start
        ? `開始まで ${formatSeconds(Math.abs(delta))}`
        : displayedNow < end
          ? `進行中 +${formatSeconds(delta)}`
          : `終了 ${formatSeconds(displayedNow - end)} 前`;

      return `
        <article class="schedule-item ${isCurrent ? 'is-current' : ''}">
          <div>
            <h3>${item.title}</h3>
            <p>${item.subTitle || 'サブタイトルなし'}</p>
            <span class="schedule-meta">${item.section} / ${item.type}</span>
          </div>
          <div class="schedule-side">
            <strong>${formatClock(start)}</strong>
            <span class="schedule-meta">${Math.round(item.duration / 60)}分</span>
            <span class="schedule-meta">${status}</span>
            <button class="resync-button" data-resync="${item.id}">Resync</button>
          </div>
        </article>
      `;
    })
    .join('');
}

function getLiveTimerValue(timer) {
  if (timer.status !== 'running') {
    return timer.value;
  }

  const elapsed = Math.max(0, Math.floor((Date.now() - timer.lastUpdate) / 1000));
  return timer.mode === 'up'
    ? timer.value + elapsed
    : Math.max(0, timer.value - elapsed);
}

function renderTimers() {
  const timers = state.payload.state?.timers ?? [];
  elements.timerList.innerHTML = timers
    .map((timer) => `
      <article class="timer-card">
        <span class="timer-meta">${timer.mode === 'up' ? 'カウントアップ' : 'カウントダウン'} / ${formatTimerStatus(timer.status)}</span>
        <h3>${timer.label}</h3>
        <p class="timer-value">${formatSeconds(getLiveTimerValue(timer))}</p>
        <p>初期値: ${formatSeconds(timer.initialValue)}</p>
        <div class="timer-actions">
          <button data-timer="${timer.id}" data-action="start">Start</button>
          <button data-timer="${timer.id}" data-action="pause">Pause</button>
          <button data-timer="${timer.id}" data-action="reset">Reset</button>
        </div>
      </article>
    `)
    .join('');
}

function renderClock() {
  elements.displayedTime.textContent = formatClock(getDisplayedNow());
}

function renderAll() {
  renderClock();
  renderOverview();
  renderCurrentEvent();
  renderSchedule();
  renderTimers();
}

async function bootstrap() {
  const response = await fetch('/api/bootstrap');
  state.payload = await response.json();
  renderAll();
}

socket.on('connect', () => {
  elements.socketStatus.textContent = 'Connected';
});

socket.on('disconnect', () => {
  elements.socketStatus.textContent = 'Disconnected';
});

socket.on('sync_state', (payload) => {
  state.payload = payload;
  renderAll();
});

document.addEventListener('click', async (event) => {
  const offsetButton = event.target.closest('[data-offset]');
  if (offsetButton) {
    await fetch('/api/offset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: Number(offsetButton.dataset.offset) }),
    });
    return;
  }

  const resyncButton = event.target.closest('[data-resync]');
  if (resyncButton) {
    await fetch('/api/resync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: resyncButton.dataset.resync }),
    });
    return;
  }

  const timerButton = event.target.closest('[data-timer]');
  if (timerButton) {
    await fetch(`/api/timer/${timerButton.dataset.timer}/${timerButton.dataset.action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  }
});

setInterval(() => {
  if (!state.payload.state) {
    return;
  }

  renderClock();
  renderCurrentEvent();
  renderSchedule();
  renderTimers();
}, 1000);

bootstrap();
