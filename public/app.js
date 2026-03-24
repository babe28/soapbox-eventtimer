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
  offsetSeconds: document.querySelector('#offset-seconds'),
  offsetStatus: document.querySelector('#offset-status'),
  currentSchedule: document.querySelector('#current-schedule'),
  scheduleCount: document.querySelector('#schedule-count'),
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
  if (status === 'running') return '動作中';
  if (status === 'paused') return '一時停止';
  return '停止中';
}

function formatOffsetLabel(seconds) {
  if (seconds === 0) return '定刻';

  const absSeconds = Math.abs(seconds);
  const minutes = Math.floor(absSeconds / 60);
  const remainSeconds = absSeconds % 60;
  const minuteText = minutes > 0 ? `${minutes}分` : '';
  const secondText = remainSeconds > 0 ? `${remainSeconds}秒` : '';
  const deltaText = `${minuteText}${secondText}` || '0秒';
  return seconds > 0 ? `${deltaText}巻き` : `${deltaText}押し`;
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
  const currentId = state.payload.state?.currentScheduleId;
  return state.payload.schedule.findIndex((item) => item.id === currentId);
}

function getActiveIndex() {
  if (state.ui.previewIndex == null) {
    return getCurrentIndex();
  }

  return Math.max(0, Math.min(state.ui.previewIndex, state.payload.schedule.length - 1));
}

function renderOverview() {
  const currentState = state.payload.state;
  if (!currentState) return;

  elements.offsetSeconds.textContent = `${currentState.globalOffsetSeconds}s`;
  elements.offsetStatus.textContent = formatOffsetLabel(currentState.globalOffsetSeconds);
  elements.scheduleCount.textContent = String(state.payload.schedule.length);

  const activeIndex = getActiveIndex();
  const activeItem = activeIndex >= 0 ? state.payload.schedule[activeIndex] : null;
  elements.currentSchedule.textContent = activeItem
    ? `${activeItem.title} / ${activeItem.section}`
    : '待機中';
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
        <p class="empty-state">進行中のイベントはありません。</p>
        <div class="next-event-card">
          <span>次の予定</span>
          <strong>${nextRealItem ? nextRealItem.title : '予定なし'}</strong>
          <p>${nextRealItem ? `開始まで ${formatSeconds(Math.floor((new Date(nextRealItem.start).getTime() - displayedNow) / 1000))}` : 'スケジュールに次の予定がありません。'}</p>
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
  const progress = isPreviewing
    ? 0
    : Math.min(100, Math.max(0, (elapsed / currentItem.duration) * 100));
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
        <p class="current-event-subtitle">${currentItem.subTitle || 'サブタイトルなし'}</p>
      </div>
      <div class="current-event-clock">
        <span>${formatClock(start)} - ${formatClock(end)}</span>
        <strong>${formatSeconds(remaining)}</strong>
      </div>
    </div>
    <div class="progress-meta">
      <span>${isPreviewing ? 'プレビュー表示' : `経過 ${formatSeconds(elapsed)}`}</span>
      <span>${isPreviewing ? 'オフセット変更なし' : `進行率 ${Math.round(progress)}%`}</span>
    </div>
    <div class="progress-bar" aria-hidden="true">
      <span style="width: ${progress}%"></span>
    </div>
    <div class="next-event-card">
      <span>次の予定</span>
      <strong>${nextItem ? nextItem.title : '次の予定なし'}</strong>
      <p>${nextItem ? `${formatClock(new Date(nextItem.start).getTime())} 開始 / あと ${formatSeconds(nextCountdown)}` : 'この後の予定は登録されていません。'}</p>
    </div>
    <div class="event-shift-actions">
      <button class="ghost-button" data-preview-action="previous" ${previousItem ? '' : 'disabled'}>戻す</button>
      <button class="ghost-button" data-preview-action="next" ${nextItem ? '' : 'disabled'}>次へ</button>
      <button class="force-button" data-schedule-action="previous" ${previousItem ? '' : 'disabled'}>戻す（強制）</button>
      <button class="force-button" data-schedule-action="next" ${nextItem ? '' : 'disabled'}>次へ（強制）</button>
    </div>
  `;
}

function renderSchedule() {
  const displayedNow = getDisplayedNow();
  const activeIndex = getActiveIndex();

  elements.scheduleList.innerHTML = state.payload.schedule
    .map((item, index) => {
      const start = new Date(item.start).getTime();
      const end = start + item.duration * 1000;
      const isCurrent = activeIndex === index;
      const isDone = displayedNow >= end;
      const isUpcoming = displayedNow < start;
      const status = isUpcoming
        ? `開始まで ${formatSeconds(Math.floor((start - displayedNow) / 1000))}`
        : isDone
          ? '終了済み'
          : '進行中';

      return `
        <article class="schedule-item ${isCurrent ? 'is-current' : ''}">
          <div class="schedule-main">
            <h3>${item.title}</h3>
            <p class="schedule-subtitle">${item.subTitle || 'サブタイトルなし'}</p>
            <span class="schedule-meta">${item.section}</span>
          </div>
          <div class="schedule-side">
            <strong>${formatClock(start)}-${formatClock(end)}</strong>
            <span class="schedule-meta">(${formatSeconds(item.duration)})</span>
            <span class="schedule-badge ${isCurrent ? 'is-live' : isDone ? 'is-done' : 'is-upcoming'}">${status}</span>
          </div>
        </article>
      `;
    })
    .join('');
}

function getLiveTimerValue(timer) {
  if (timer.status !== 'running') return timer.value;

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

  const scheduleButton = event.target.closest('[data-schedule-action]');
  if (scheduleButton) {
    state.ui.previewIndex = null;
    await fetch('/api/schedule/shift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: scheduleButton.dataset.scheduleAction }),
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
