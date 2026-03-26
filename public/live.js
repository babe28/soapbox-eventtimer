const liveState = {
  payload: {
    state: null,
    schedule: [],
    serverTime: Date.now(),
  },
};

const liveSocket = io();

const liveElements = {
  root: document.querySelector('#live-view'),
  browserTime: document.querySelector('#live-browser-time'),
  title: document.querySelector('#live-title'),
  subtitle: document.querySelector('#live-subtitle'),
  remaining: document.querySelector('#live-remaining'),
  progressLabel: document.querySelector('#live-progress-label'),
  progressValue: document.querySelector('#live-progress-value'),
  progressBar: document.querySelector('#live-progress-bar'),
  message: document.querySelector('#live-message'),
  messageLine1: document.querySelector('#live-message-line1'),
  messageLine2: document.querySelector('#live-message-line2'),
};

function formatSeconds(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = String(Math.floor(safeSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((safeSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(safeSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function formatBrowserDateTime(value) {
  const date = new Date(value);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const weekday = weekdays[date.getDay()];
  const time = date.toLocaleTimeString('ja-JP', { hour12: false });
  return `${year}/${month}/${day}(${weekday}) ${time}`;
}

function getDisplayedNow() {
  const currentState = liveState.payload.state;
  if (!currentState) return Date.now();
  return Date.now() + currentState.globalOffsetSeconds * 1000;
}

function getCurrentItem() {
  const displayedNow = getDisplayedNow();
  return liveState.payload.schedule.find((item) => {
    const start = new Date(item.start).getTime();
    const end = start + item.duration * 1000;
    return displayedNow >= start && displayedNow < end;
  }) ?? null;
}

function getLiveViewState() {
  return liveState.payload.state?.liveView ?? {
    text: '',
    line1: '',
    line2: '',
    blinkUntil: 0,
    redUntil: 0,
  };
}

function getProgressStage(progress) {
  if (progress >= 75) return 'stage-4';
  if (progress >= 50) return 'stage-3';
  if (progress >= 25) return 'stage-2';
  return 'stage-1';
}

function renderMessage() {
  const message = getLiveViewState();
  const line1 = String(message.line1 || '').trim();
  const line2 = String(message.line2 || '').trim();
  const hasMessage = line1 || line2;
  const now = Date.now();
  const isBlinking = Number(message.blinkUntil || 0) > now;

  liveElements.message.hidden = !hasMessage;
  liveElements.message.classList.toggle('is-blinking', isBlinking && hasMessage);
  liveElements.root.classList.toggle('is-blinking', isBlinking);
  liveElements.root.classList.toggle('is-red-alert', Number(message.redUntil || 0) > now);
  liveElements.messageLine1.textContent = line1 || '\u00A0';
  liveElements.messageLine2.textContent = line2 || '\u00A0';
}

function renderLiveView() {
  if (liveElements.browserTime) {
    liveElements.browserTime.textContent = formatBrowserDateTime(Date.now());
  }

  const currentItem = getCurrentItem();

  if (!currentItem) {
    liveElements.title.textContent = 'イベント待機中';
    liveElements.subtitle.textContent = '現在進行中のプログラムはありません';
    liveElements.remaining.textContent = '--:--:--';
    liveElements.progressLabel.textContent = '進行状況';
    liveElements.progressValue.textContent = '0%';
    liveElements.progressBar.style.width = '0%';
    liveElements.progressBar.className = 'stage-1';
    renderMessage();
    return;
  }

  const displayedNow = getDisplayedNow();
  const start = new Date(currentItem.start).getTime();
  const end = start + currentItem.duration * 1000;
  const elapsed = Math.max(0, Math.floor((displayedNow - start) / 1000));
  const remaining = Math.max(0, Math.floor((end - displayedNow) / 1000));
  const progress = currentItem.duration > 0
    ? Math.min(100, Math.max(0, (elapsed / currentItem.duration) * 100))
    : 0;

  liveElements.title.textContent = currentItem.title;
  liveElements.subtitle.textContent = currentItem.subTitle ? ` / ${currentItem.subTitle}` : '';
  liveElements.remaining.textContent = formatSeconds(remaining);
  liveElements.progressLabel.textContent = '進行状況';
  liveElements.progressValue.textContent = `${Math.round(progress)}%`;
  liveElements.progressBar.style.width = `${progress}%`;
  liveElements.progressBar.className = getProgressStage(progress);
  renderMessage();
}

async function bootstrapLiveView() {
  const response = await fetch('/api/bootstrap');
  liveState.payload = await response.json();
  renderLiveView();
}

liveSocket.on('sync_state', (payload) => {
  liveState.payload = payload;
  renderLiveView();
});

setInterval(() => {
  if (!liveState.payload.state) return;
  renderLiveView();
}, 1000);

bootstrapLiveView();
