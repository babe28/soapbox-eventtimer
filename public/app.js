const state = {
  payload: {
    state: null,
    schedule: [],
    serverTime: Date.now(),
  },
  ui: {
    previewIndex: null,
    theme: 'light',
    liveMessageDraft: '',
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
  themeToggle: document.querySelector('#theme-toggle'),
  liveMessageForm: document.querySelector('#live-message-form'),
  liveMessageInput: document.querySelector('#live-message-input'),
  liveMessageBlink: document.querySelector('#live-message-blink'),
  liveMessageRed: document.querySelector('#live-message-red'),
};

function applyTheme(theme) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  state.ui.theme = nextTheme;
  document.documentElement.dataset.theme = nextTheme;
  if (elements.themeToggle) {
    elements.themeToggle.textContent = nextTheme === 'dark' ? 'Day Mode' : 'Night Mode';
    elements.themeToggle.setAttribute('aria-pressed', String(nextTheme === 'dark'));
  }
  window.localStorage.setItem('soapbox-theme', nextTheme);
}

function initializeTheme() {
  const savedTheme = window.localStorage.getItem('soapbox-theme');
  const preferredDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(savedTheme || (preferredDark ? 'dark' : 'light'));
}

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

function getLiveViewState() {
  return state.payload.state?.liveView ?? {
    text: '',
    line1: '',
    line2: '',
    blinkUntil: 0,
    redUntil: 0,
  };
}

function normalizeLiveMessageText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .slice(0, 2)
    .map((line) => line.trim().slice(0, 13))
    .join('\n');
}

function syncLiveMessageEditor() {
  if (!elements.liveMessageInput || !elements.liveMessageBlink || !elements.liveMessageRed) return;

  const liveView = getLiveViewState();
  const nextText = liveView.text || [liveView.line1, liveView.line2].filter(Boolean).join('\n');
  const now = Date.now();
  const isBlinking = Number(liveView.blinkUntil || 0) > now;
  const isRed = Number(liveView.redUntil || 0) > now;

  if (document.activeElement !== elements.liveMessageInput) {
    elements.liveMessageInput.value = nextText;
    state.ui.liveMessageDraft = nextText;
  }

  elements.liveMessageBlink.classList.toggle('is-active', isBlinking);
  elements.liveMessageRed.classList.toggle('is-active', isRed);
  elements.liveMessageForm.classList.toggle('is-blinking', isBlinking);
  elements.liveMessageForm.classList.toggle('is-red', isRed);
}

async function saveLiveMessageText(text) {
  const normalizedText = normalizeLiveMessageText(
    text ?? elements.liveMessageInput?.value ?? getLiveViewState().text ?? ''
  );

  const response = await fetch('/api/live-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: normalizedText,
    }),
  });

  if (!response.ok) {
    return false;
  }

  const result = await response.json();
  if (state.payload.state) {
    state.payload.state.liveView = result.liveView;
  }
  syncLiveMessageEditor();
  return true;
}

async function triggerLiveMessageEffect(effect) {
  const response = await fetch('/api/live-message/effect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ effect }),
  });

  if (!response.ok) {
    return false;
  }

  const result = await response.json();
  if (state.payload.state) {
    state.payload.state.liveView = result.liveView;
  }
  syncLiveMessageEditor();
  return true;
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
  if (status === 'running') return '進行中';
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
  const displayedNow = getDisplayedNow();
  const liveIndex = state.payload.schedule.findIndex((item) => {
    const start = new Date(item.start).getTime();
    const end = start + item.duration * 1000;
    return displayedNow >= start && displayedNow < end;
  });

  if (liveIndex >= 0) return liveIndex;

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
        <p class="empty-state">現在進行中のイベントはありません。</p>
        <div class="next-event-card">
          <span>次の開始</span>
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
  const previousItem = activeIndex > 0 ? state.payload.schedule[activeIndex - 1] : null;
  const nextItem = state.payload.schedule[activeIndex + 1] ?? null;

  elements.currentEvent.innerHTML = `
    <div class="current-event-shell ${isPreviewing ? 'is-previewing' : ''}" data-current-start="${start}" data-current-end="${end}" data-current-duration="${currentItem.duration}">
      <div class="current-event-topline">
        <p class="current-event-section">${currentItem.section}</p>
        <span class="current-event-window">${formatClock(start)} - ${formatClock(end)}</span>
      </div>
      <div class="current-event-mainline">
        <div class="current-event-copy">
          <h3>${currentItem.title}</h3>
          <p class="current-event-subtitle">${currentItem.subTitle || 'サブタイトルなし'}</p>
        </div>
        <div class="current-event-countdown">
          <span class="current-event-countdown-label">${isPreviewing ? 'プレビュー' : '残り時間'}</span>
          <strong data-current-remaining>00:00:00</strong>
        </div>
      </div>
      <div class="progress-meta">
        <span data-current-left>${isPreviewing ? 'プレビュー表示' : ''}</span>
        <span data-current-right>${isPreviewing ? 'オフセット反映なし' : ''}</span>
      </div>
      <div class="progress-bar" aria-hidden="true">
        <span data-current-progress></span>
      </div>
      <div class="next-event-card">
        <span>次の開始</span>
        <strong>${nextItem ? nextItem.title : '次の予定なし'}</strong>
        <p data-next-countdown>${nextItem ? '' : 'この後の予定は登録されていません。'}</p>
      </div>
      <div class="event-shift-actions event-shift-grid">
        <button class="ghost-button shift-button shift-button-neutral" data-preview-action="previous" ${previousItem ? '' : 'disabled'}>戻す</button>
        <button class="ghost-button shift-button shift-button-neutral" data-preview-action="next" ${nextItem ? '' : 'disabled'}>次へ</button>
        <button class="force-button shift-button shift-button-prev" data-force-id="${previousItem ? previousItem.id : ''}" ${previousItem ? '' : 'disabled'}>戻す（強制）</button>
        <button class="force-button shift-button shift-button-next" data-force-id="${nextItem ? nextItem.id : ''}" ${nextItem ? '' : 'disabled'}>次へ（強制）</button>
      </div>
    </div>
  `;

  updateCurrentEventLive();
}

function updateCurrentEventLive() {
  const shell = elements.currentEvent.querySelector('[data-current-start]');
  if (!shell) return;

  const displayedNow = getDisplayedNow();
  const activeIndex = getActiveIndex();
  const actualCurrentIndex = getCurrentIndex();
  const isPreviewing = state.ui.previewIndex != null && activeIndex !== actualCurrentIndex;
  const duration = Number(shell.dataset.currentDuration || 0);
  const start = Number(shell.dataset.currentStart || 0);
  const end = Number(shell.dataset.currentEnd || 0);
  const nextItem = state.payload.schedule[activeIndex + 1] ?? null;

  const elapsed = isPreviewing ? 0 : Math.max(0, Math.floor((displayedNow - start) / 1000));
  const remaining = isPreviewing ? duration : Math.max(0, Math.floor((end - displayedNow) / 1000));
  const progress = isPreviewing || duration <= 0 ? 0 : Math.min(100, Math.max(0, (elapsed / duration) * 100));

  const remainingNode = shell.querySelector('[data-current-remaining]');
  const leftNode = shell.querySelector('[data-current-left]');
  const rightNode = shell.querySelector('[data-current-right]');
  const progressNode = shell.querySelector('[data-current-progress]');
  const nextCountdownNode = shell.querySelector('[data-next-countdown]');

  if (remainingNode) remainingNode.textContent = formatSeconds(remaining);
  if (leftNode) leftNode.textContent = isPreviewing ? 'プレビュー表示' : `経過 ${formatSeconds(elapsed)}`;
  if (rightNode) rightNode.textContent = isPreviewing ? 'オフセット反映なし' : `進行率 ${Math.round(progress)}%`;
  if (progressNode) progressNode.style.width = `${progress}%`;

  if (nextCountdownNode) {
    nextCountdownNode.textContent = nextItem
      ? `${formatClock(new Date(nextItem.start).getTime())} 開始 / あと ${formatSeconds(Math.max(0, Math.floor((new Date(nextItem.start).getTime() - displayedNow) / 1000)))}`
      : 'この後の予定は登録されていません。';
  }
}

function renderSchedule() {
  const activeIndex = getActiveIndex();
  const dashboardConfig = getDashboardConfig();

  elements.scheduleList.innerHTML = state.payload.schedule
    .map((item, index) => {
      const start = new Date(item.start).getTime();
      const end = start + item.duration * 1000;
      const isCurrent = activeIndex === index;
      const typeColor = dashboardConfig.eventTypeColors[item.type] || dashboardConfig.eventTypeColors.normal;

      return `
        <article class="schedule-item ${isCurrent ? 'is-current' : ''}" style="--type-color: ${typeColor}" data-schedule-item data-start="${start}" data-end="${end}" data-item-id="${item.id}">
          <div class="schedule-main">
            <div class="schedule-title-row">
              <span class="schedule-type-accent" aria-hidden="true"></span>
              <h3>${item.title}</h3>
            </div>
            <p class="schedule-subtitle">${item.subTitle || 'サブタイトルなし'}</p>
            <span class="schedule-meta">${item.section} / ${item.type}</span>
          </div>
          <div class="schedule-side">
            <strong>${formatClock(start)}-${formatClock(end)}</strong>
            <span class="schedule-meta">(${formatSeconds(item.duration)})</span>
            <span class="schedule-badge" data-schedule-badge></span>
            ${dashboardConfig.showPerEventSyncButtons ? `<button class="force-button schedule-sync-button" data-resync="${item.id}">ここに同期</button>` : ''}
          </div>
        </article>
      `;
    })
    .join('');

  updateScheduleLive();
}

function updateScheduleLive() {
  const displayedNow = getDisplayedNow();
  const activeIndex = getActiveIndex();

  elements.scheduleList.querySelectorAll('[data-schedule-item]').forEach((node, index) => {
    const start = Number(node.dataset.start || 0);
    const end = Number(node.dataset.end || 0);
    const badge = node.querySelector('[data-schedule-badge]');
    const isCurrent = index === activeIndex;
    const isDone = displayedNow >= end;
    const isUpcoming = displayedNow < start;

    node.classList.toggle('is-current', isCurrent);

    if (!badge) return;
    badge.className = `schedule-badge ${isCurrent ? 'is-live' : isDone ? 'is-done' : 'is-upcoming'}`;
    badge.textContent = isUpcoming
      ? `開始まで ${formatSeconds(Math.floor((start - displayedNow) / 1000))}`
      : isDone
        ? '完了済み'
        : '進行中';
  });
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
      <article class="timer-card timer-card-animated" style="--enter-delay: ${index * 80}ms" data-timer-card data-timer-id="${timer.id}">
        <span class="timer-meta">${timer.mode === 'up' ? 'カウントアップ' : 'カウントダウン'} / ${formatTimerStatus(timer.status)}</span>
        <h3>${timer.label}</h3>
        <p class="timer-value" data-timer-value>${formatSeconds(getLiveTimerValue(timer))}</p>
        <p class="timer-initial">初期値: ${formatSeconds(timer.initialValue)}</p>
        <div class="timer-actions">
          <button data-timer="${timer.id}" data-action="start">Start</button>
          <button data-timer="${timer.id}" data-action="pause">Pause</button>
          <button data-timer="${timer.id}" data-action="reset">Reset</button>
        </div>
      </article>
    `)
    .join('');
}

function updateTimerValues() {
  const timers = state.payload.state?.timers ?? [];
  const timersById = new Map(timers.map((timer) => [String(timer.id), timer]));

  elements.timerList.querySelectorAll('[data-timer-card]').forEach((node) => {
    const timer = timersById.get(String(node.dataset.timerId));
    const valueNode = node.querySelector('[data-timer-value]');
    if (!timer || !valueNode) return;
    valueNode.textContent = formatSeconds(getLiveTimerValue(timer));
  });
}

function renderClock() {
  elements.displayedTime.textContent = formatClock(getDisplayedNow());
  elements.browserTime.textContent = formatClock(Date.now());
}

function renderStatic() {
  renderOverview();
  renderHeaderStats();
  renderCurrentEvent();
  renderSchedule();
  renderTimers();
  syncLiveMessageEditor();
}

function updateLiveView() {
  renderClock();
  renderHeaderStats();
  updateCurrentEventLive();
  updateScheduleLive();
  updateTimerValues();
}

async function bootstrap() {
  const response = await fetch('/api/bootstrap');
  state.payload = await response.json();
  state.ui.previewIndex = null;
  renderStatic();
  updateLiveView();
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
  renderStatic();
  updateLiveView();
});

document.addEventListener('click', async (event) => {
  if (event.target.closest('#theme-toggle')) {
    applyTheme(state.ui.theme === 'dark' ? 'light' : 'dark');
    return;
  }

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
    if (currentOffset === 0) return;

    if (!window.confirm('グローバルオフセットを 0 秒に戻しますか？')) {
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
    renderStatic();
    updateLiveView();
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
    return;
  }

  if (event.target.closest('#live-message-blink')) {
    await triggerLiveMessageEffect('blink');
    return;
  }

  if (event.target.closest('#live-message-red')) {
    await triggerLiveMessageEffect('red');
  }
});

elements.liveMessageForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveLiveMessageText(elements.liveMessageInput?.value ?? '');
});

elements.liveMessageInput?.addEventListener('input', () => {
  state.ui.liveMessageDraft = elements.liveMessageInput.value;
});

setInterval(() => {
  if (!state.payload.state) return;
  updateLiveView();
}, 1000);

initializeTheme();
bootstrap();
