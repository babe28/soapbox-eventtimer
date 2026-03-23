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
  scheduleList: document.querySelector('#schedule-list'),
  timerList: document.querySelector('#timer-list'),
  stateJson: document.querySelector('#state-json'),
  scheduleJson: document.querySelector('#schedule-json'),
  resetApp: document.querySelector('#reset-app'),
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
    : 'None';
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
        ? `Starts in ${formatSeconds(Math.abs(delta))}`
        : displayedNow < end
          ? `Running +${formatSeconds(delta)}`
          : `Ended ${formatSeconds(displayedNow - end)} ago`;

      return `
        <article class="schedule-item ${isCurrent ? 'is-current' : ''}">
          <div>
            <h3>${item.title}</h3>
            <p>${item.subTitle || 'No subtitle'}</p>
            <span class="schedule-meta">${item.section} / ${item.type}</span>
          </div>
          <div class="schedule-side">
            <strong>${formatClock(start)}</strong>
            <span class="schedule-meta">${Math.round(item.duration / 60)} min</span>
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
        <span class="timer-meta">${timer.mode.toUpperCase()} / ${timer.status}</span>
        <h3>${timer.label}</h3>
        <p class="timer-value">${formatSeconds(getLiveTimerValue(timer))}</p>
        <p>Initial: ${formatSeconds(timer.initialValue)}</p>
        <div class="timer-actions">
          <button data-timer="${timer.id}" data-action="start">Start</button>
          <button data-timer="${timer.id}" data-action="pause">Pause</button>
          <button data-timer="${timer.id}" data-action="reset">Reset</button>
        </div>
      </article>
    `)
    .join('');
}

function renderJson() {
  elements.stateJson.textContent = JSON.stringify(state.payload.state, null, 2);
  elements.scheduleJson.textContent = JSON.stringify(state.payload.schedule, null, 2);
}

function renderClock() {
  elements.displayedTime.textContent = formatClock(getDisplayedNow());
}

function renderAll() {
  renderClock();
  renderOverview();
  renderSchedule();
  renderTimers();
  renderJson();
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

elements.resetApp.addEventListener('click', async () => {
  await fetch('/api/reset', { method: 'POST' });
});

setInterval(() => {
  if (!state.payload.state) {
    return;
  }

  renderClock();
  renderSchedule();
  renderTimers();
}, 1000);

bootstrap();
