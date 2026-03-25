const state = {
  payload: {
    state: null,
    schedule: [],
    serverTime: Date.now(),
  },
  ui: {
    previewIndex: null,
  },
};

const socket = io();

const elements = {
  socketStatus: document.querySelector('#socket-status'),
  displayedTime: document.querySelector('#displayed-time'),
  browserTime: document.querySelector('#browser-time'),
  offsetSeconds: document.querySelector('#offset-seconds'),
  offsetStatus: document.querySelector('#offset-status'),
  progressDiff: document.querySelector('#progress-diff'),
  resetOffset: document.querySelector('#reset-offset'),
  currentEvent: document.querySelector('#current-event'),
  scheduleList: document.querySelector('#schedule-list'),
  timerList: document.querySelector('#timer-list'),
  eventProgressDonut: document.querySelector('#event-progress-donut'),
  eventProgressValue: document.querySelector('#event-progress-value'),
  eventProgressLabel: document.querySelector('#event-progress-label'),
  finalEndDonut: document.querySelector('#final-end-donut'),
  finalEndValue: document.querySelector('#final-end-value'),
  finalEndLabel: document.querySelector('#final-end-label'),
};

function getDashboardConfig() {
  return state.payload.state?.dashboardConfig ?? {
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

function formatClock(value) {
  return new Date(value).toLocaleTimeString('ja-JP', { hour12: false });
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
  if (status === 'running') return '\u9032\u884C\u4E2D';
  if (status === 'paused') return '\u4E00\u6642\u505C\u6B62';
  return '\u505C\u6B62\u4E2D';
}

function formatOffsetLabel(seconds) {
  if (seconds === 0) return '\u5B9A\u523B';
  const absSeconds = Math.abs(seconds);
  const minutes = Math.floor(absSeconds / 60);
  const remainSeconds = absSeconds % 60;
  const minuteText = minutes > 0 ? `${minutes}\u5206` : '';
  const secondText = remainSeconds > 0 ? `${remainSeconds}\u79D2` : '';
  const deltaText = `${minuteText}${secondText}` || '0\u79D2';
  return seconds > 0 ? `${deltaText}\u9045\u308C` : `${deltaText}\u5DFB\u304D`;
}

function setDonutValue(element, percent) {
  const safePercent = Math.max(0, Math.min(100, percent));
  element.style.setProperty('--value', `${safePercent}%`);
}

function getDisplayedNow() {
  const currentState = state.payload.state;
  if (!currentState) return Date.now();
  return Date.now() + currentState.globalOffsetSeconds * 1000;
}

function getScheduleBounds() {
  if (state.payload.schedule.length === 0) return null;
  const firstStart = new Date(state.payload.schedule[0].start).getTime();
  const lastItem = state.payload.schedule[state.payload.schedule.length - 1];
  const lastEnd = new Date(lastItem.start).getTime() + lastItem.duration * 1000;
  return { firstStart, lastEnd };
}

function getCurrentIndex() {
  const displayedNow = getDisplayedNow();
  const liveIndex = state.payload.schedule.findIndex((item) => {
    const start = new Date(item.start).getTime();
    const end = start + item.duration * 1000;
    return displayedNow >= start && displayedNow < end;
  });

  if (liveIndex >= 0) {
    return liveIndex;
  }

  const currentId = state.payload.state?.currentScheduleId;
  return state.payload.schedule.findIndex((item) => item.id === currentId);
}

function getActiveIndex() {
  if (state.ui.previewIndex == null) return getCurrentIndex();
  return Math.max(0, Math.min(state.ui.previewIndex, state.payload.schedule.length - 1));
}

function renderOverview() {
  const currentState = state.payload.state;
  if (!currentState) return;

  elements.offsetSeconds.textContent = `${currentState.globalOffsetSeconds}s`;
  const offsetLabel = formatOffsetLabel(currentState.globalOffsetSeconds);
  elements.offsetStatus.textContent = offsetLabel;
  elements.progressDiff.textContent = offsetLabel;
}

function renderHeaderStats() {
  const bounds = getScheduleBounds();
  if (!bounds) {
    elements.eventProgressValue.textContent = '0%';
    elements.eventProgressLabel.textContent = '0 / 0';
    elements.finalEndValue.textContent = '--:--:--';
    elements.finalEndLabel.textContent = '--:--:--';
    setDonutValue(elements.eventProgressDonut, 0);
    setDonutValue(elements.finalEndDonut, 0);
    return;
  }

  const displayedNow = getDisplayedNow();
  const totalDuration = Math.max(1, bounds.lastEnd - bounds.firstStart);
  const elapsed = Math.min(Math.max(displayedNow - bounds.firstStart, 0), totalDuration);
  const consumedPercent = (elapsed / totalDuration) * 100;
  const completedCount = state.payload.schedule.filter((item) => {
    const itemEnd = new Date(item.start).getTime() + item.duration * 1000;
    return displayedNow >= itemEnd;
  }).length;
  const remainingSeconds = Math.max(0, Math.floor((bounds.lastEnd - displayedNow) / 1000));

  elements.eventProgressValue.textContent = `${Math.round(consumedPercent)}%`;
  elements.eventProgressLabel.textContent = `${completedCount} / ${state.payload.schedule.length}`;
  setDonutValue(elements.eventProgressDonut, consumedPercent);
  elements.finalEndValue.textContent = formatSeconds(remainingSeconds);
  elements.finalEndLabel.textContent = formatClock(bounds.lastEnd);
  setDonutValue(elements.finalEndDonut, 100 - consumedPercent);
}

function renderCurrentEvent() {
  const displayedNow = getDisplayedNow();
  const actualCurrentIndex = getCurrentIndex();
  const activeIndex = getActiveIndex();
  const currentItem = activeIndex >= 0 ? state.payload.schedule[activeIndex] : null;
  const nextRealItem = state.payload.schedule.find((item) => new Date(item.start).getTime() > displayedNow);

  if (!currentItem) {
    elements.currentEvent.innerHTML = `
      <div class="current-event-fallback">
        <p class="empty-state">\u73FE\u5728\u9032\u884C\u4E2D\u306E\u30A4\u30D9\u30F3\u30C8\u306F\u3042\u308A\u307E\u305B\u3093\u3002</p>
        <div class="next-event-card">
          <span>\u6B21\u306E\u958B\u59CB</span>
          <strong>${nextRealItem ? nextRealItem.title : '\u4E88\u5B9A\u306A\u3057'}</strong>
          <p>${nextRealItem ? `\u958B\u59CB\u307E\u3067 ${formatSeconds(Math.floor((new Date(nextRealItem.start).getTime() - displayedNow) / 1000))}` : '\u30B9\u30B1\u30B8\u30E5\u30FC\u30EB\u306B\u6B21\u306E\u4E88\u5B9A\u304C\u3042\u308A\u307E\u305B\u3093\u3002'}</p>
        </div>
      </div>
    `;
    return;
  }

  const start = new Date(currentItem.start).getTime();
  const end = start + currentItem.duration * 1000;
  const isPreviewing = state.ui.previewIndex != null && activeIndex !== actualCurrentIndex;
  const elapsed = isPreviewing ? 0 : Math.max(0, Math.floor((displayedNow - start) / 1000));
  const remaining = isPreviewing ? currentItem.duration : Math.max(0, Math.floor((end - displayedNow) / 1000));
  const progress = isPreviewing ? 0 : Math.min(100, Math.max(0, (elapsed / currentItem.duration) * 100));
  const previousItem = activeIndex > 0 ? state.payload.schedule[activeIndex - 1] : null;
  const nextItem = state.payload.schedule[activeIndex + 1] ?? null;
  const nextCountdown = nextItem
    ? Math.max(0, Math.floor((new Date(nextItem.start).getTime() - displayedNow) / 1000))
    : null;

  elements.currentEvent.innerHTML = `
    <div class="current-event-head">
      <div>
        <p class="current-event-section">${currentItem.section}</p>
        <h3>${currentItem.title}</h3>
        <p class="current-event-subtitle">${currentItem.subTitle || '\u30B5\u30D6\u30BF\u30A4\u30C8\u30EB\u306A\u3057'}</p>
      </div>
      <div class="current-event-clock">
        <span>${formatClock(start)} - ${formatClock(end)}</span>
        <strong>${formatSeconds(remaining)}</strong>
      </div>
    </div>
    <div class="progress-meta">
      <span>${isPreviewing ? '\u30D7\u30EC\u30D3\u30E5\u30FC\u8868\u793A' : `\u7D4C\u904E ${formatSeconds(elapsed)}`}</span>
      <span>${isPreviewing ? '\u30AA\u30D5\u30BB\u30C3\u30C8\u53CD\u6620\u306A\u3057' : `\u9032\u884C\u7387 ${Math.round(progress)}%`}</span>
    </div>
    <div class="progress-bar" aria-hidden="true">
      <span style="width: ${progress}%"></span>
    </div>
    <div class="next-event-card">
      <span>\u6B21\u306E\u958B\u59CB</span>
      <strong>${nextItem ? nextItem.title : '\u6B21\u306E\u4E88\u5B9A\u306A\u3057'}</strong>
      <p>${nextItem ? `${formatClock(new Date(nextItem.start).getTime())} \u958B\u59CB / \u3042\u3068 ${formatSeconds(nextCountdown)}` : '\u3053\u306E\u5F8C\u306E\u4E88\u5B9A\u306F\u767B\u9332\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002'}</p>
    </div>
    <div class="event-shift-actions">
      <button class="ghost-button" data-preview-action="previous" ${previousItem ? '' : 'disabled'}>\u623B\u3059</button>
      <button class="ghost-button" data-preview-action="next" ${nextItem ? '' : 'disabled'}>\u6B21\u3078</button>
      <button class="force-button" data-force-id="${previousItem ? previousItem.id : ''}" ${previousItem ? '' : 'disabled'}>\u623B\u3059\uff08\u5F37\u5236\uff09</button>
      <button class="force-button" data-force-id="${nextItem ? nextItem.id : ''}" ${nextItem ? '' : 'disabled'}>\u6B21\u3078\uff08\u5F37\u5236\uff09</button>
    </div>
  `;
}

function renderSchedule() {
  const displayedNow = getDisplayedNow();
  const activeIndex = getActiveIndex();
  const dashboardConfig = getDashboardConfig();

  elements.scheduleList.innerHTML = state.payload.schedule
    .map((item, index) => {
      const start = new Date(item.start).getTime();
      const end = start + item.duration * 1000;
      const isCurrent = activeIndex === index;
      const isDone = displayedNow >= end;
      const isUpcoming = displayedNow < start;
      const status = isUpcoming
        ? `\u958B\u59CB\u307E\u3067 ${formatSeconds(Math.floor((start - displayedNow) / 1000))}`
        : isDone
          ? '\u5B8C\u4E86\u6E08\u307F'
          : '\u9032\u884C\u4E2D';
      const typeColor = dashboardConfig.eventTypeColors[item.type] || dashboardConfig.eventTypeColors.normal;

      return `
        <article class="schedule-item ${isCurrent ? 'is-current' : ''}" style="--type-color: ${typeColor}">
          <div class="schedule-main">
            <div class="schedule-title-row">
              <span class="schedule-type-accent" aria-hidden="true"></span>
              <h3>${item.title}</h3>
            </div>
            <p class="schedule-subtitle">${item.subTitle || '\u30B5\u30D6\u30BF\u30A4\u30C8\u30EB\u306A\u3057'}</p>
            <span class="schedule-meta">${item.section} / ${item.type}</span>
          </div>
          <div class="schedule-side">
            <strong>${formatClock(start)}-${formatClock(end)}</strong>
            <span class="schedule-meta">(${formatSeconds(item.duration)})</span>
            <span class="schedule-badge ${isCurrent ? 'is-live' : isDone ? 'is-done' : 'is-upcoming'}">${status}</span>
            ${dashboardConfig.showPerEventSyncButtons ? `<button class="force-button schedule-sync-button" data-resync="${item.id}">\u3053\u3053\u306B\u540C\u671F</button>` : ''}
          </div>
        </article>
      `;
    })
    .join('');
}

function getLiveTimerValue(timer) {
  if (timer.status !== 'running') return timer.value;
  const elapsed = Math.max(0, Math.floor((Date.now() - timer.lastUpdate) / 1000));
  return timer.mode === 'up' ? timer.value + elapsed : Math.max(0, timer.value - elapsed);
}

function renderTimers() {
  const timers = state.payload.state?.timers ?? [];
  elements.timerList.innerHTML = timers
    .map((timer, index) => `
      <article class="timer-card timer-card-animated" style="--enter-delay: ${index * 80}ms">
        <span class="timer-meta">${timer.mode === 'up' ? '\u30AB\u30A6\u30F3\u30C8\u30A2\u30C3\u30D7' : '\u30AB\u30A6\u30F3\u30C8\u30C0\u30A6\u30F3'} / ${formatTimerStatus(timer.status)}</span>
        <h3>${timer.label}</h3>
        <p class="timer-value">${formatSeconds(getLiveTimerValue(timer))}</p>
        <p class="timer-initial">\u521D\u671F\u5024: ${formatSeconds(timer.initialValue)}</p>
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
  elements.browserTime.textContent = formatClock(Date.now());
}

function renderAll() {
  renderClock();
  renderOverview();
  renderHeaderStats();
  renderCurrentEvent();
  renderSchedule();
  renderTimers();
}

async function bootstrap() {
  const response = await fetch('/api/bootstrap');
  state.payload = await response.json();
  state.ui.previewIndex = null;
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
  if (state.ui.previewIndex != null && state.ui.previewIndex >= payload.schedule.length) {
    state.ui.previewIndex = null;
  }
  renderAll();
});

document.addEventListener('click', async (event) => {
  const offsetButton = event.target.closest('[data-offset]');
  if (offsetButton) {
    state.ui.previewIndex = null;
    await fetch('/api/offset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: Number(offsetButton.dataset.offset) }),
    });
    return;
  }

  if (event.target.closest('#reset-offset')) {
    const currentOffset = state.payload.state?.globalOffsetSeconds ?? 0;
    if (currentOffset === 0) {
      return;
    }

    if (!window.confirm('\u30B0\u30ED\u30FC\u30D0\u30EB\u30AA\u30D5\u30BB\u30C3\u30C8\u3092 0 \u79D2\u306B\u623B\u3057\u307E\u3059\u304B\uff1f')) {
      return;
    }

    state.ui.previewIndex = null;
    await fetch('/api/offset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: -currentOffset }),
    });
    return;
  }

  const timerButton = event.target.closest('[data-timer]');
  if (timerButton) {
    state.ui.previewIndex = null;
    await fetch(`/api/timer/${timerButton.dataset.timer}/${timerButton.dataset.action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    return;
  }

  const previewButton = event.target.closest('[data-preview-action]');
  if (previewButton) {
    const activeIndex = getActiveIndex();
    if (activeIndex < 0) return;
    const delta = previewButton.dataset.previewAction === 'previous' ? -1 : 1;
    state.ui.previewIndex = Math.max(0, Math.min(activeIndex + delta, state.payload.schedule.length - 1));
    renderAll();
    return;
  }

  const forceButton = event.target.closest('[data-force-id]');
  if (forceButton && forceButton.dataset.forceId) {
    state.ui.previewIndex = null;
    await fetch('/api/resync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: forceButton.dataset.forceId }),
    });
    return;
  }

  const resyncButton = event.target.closest('[data-resync]');
  if (resyncButton) {
    state.ui.previewIndex = null;
    await fetch('/api/resync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: resyncButton.dataset.resync }),
    });
  }
});

setInterval(() => {
  if (!state.payload.state) return;
  renderClock();
  renderHeaderStats();
  renderCurrentEvent();
  renderSchedule();
  renderTimers();
}, 1000);

bootstrap();
