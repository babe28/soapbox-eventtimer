const liveState = {
  payload: {
    state: null,
    schedule: [],
    serverTime: Date.now(),
  },
  ui: {
    messageSignature: '',
  },
};

const liveSocket = io();

const liveElements = {
  root: document.querySelector('#live-view'),
  fullscreenToggle: document.querySelector('#live-fullscreen-toggle'),
  pauseStatus: document.querySelector('#live-pause-status'),
  offsetStatus: document.querySelector('#live-offset-status'),
  browserTime: document.querySelector('#live-browser-time'),
  title: document.querySelector('#live-title'),
  subtitle: document.querySelector('#live-subtitle'),
  remaining: document.querySelector('#live-remaining'),
  progressValue: document.querySelector('#live-progress-value'),
  progressBar: document.querySelector('#live-progress-bar'),
  message: document.querySelector('#live-message'),
  messageLine1: document.querySelector('#live-message-line1'),
  messageLine2: document.querySelector('#live-message-line2'),
};

function getFullscreenElement() {
  return document.fullscreenElement
    || document.webkitFullscreenElement
    || document.msFullscreenElement
    || null;
}

function isFullscreenSupported() {
  return Boolean(
    document.documentElement.requestFullscreen
      || document.documentElement.webkitRequestFullscreen
      || document.documentElement.msRequestFullscreen
  );
}

function updateFullscreenButton() {
  if (!liveElements.fullscreenToggle) return;

  if (!isFullscreenSupported()) {
    liveElements.fullscreenToggle.disabled = true;
    liveElements.fullscreenToggle.textContent = '全画面非対応';
    return;
  }

  const isFullscreen = Boolean(getFullscreenElement());
  liveElements.fullscreenToggle.disabled = false;
  liveElements.fullscreenToggle.textContent = isFullscreen ? '全画面終了' : '全画面表示';
  liveElements.fullscreenToggle.classList.toggle('is-active', isFullscreen);
}

async function toggleFullscreen() {
  const fullscreenElement = getFullscreenElement();
  if (fullscreenElement) {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
    return;
  }

  const target = document.documentElement;
  if (target.requestFullscreen) {
    await target.requestFullscreen();
  } else if (target.webkitRequestFullscreen) {
    target.webkitRequestFullscreen();
  } else if (target.msRequestFullscreen) {
    target.msRequestFullscreen();
  }
}

function formatSeconds(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = String(Math.floor(safeSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((safeSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(safeSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function formatRemainingJapaneseHtml(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}<small>時間</small>${minutes}<small>分</small>${seconds}<small>秒</small>`;
  }
  return `${minutes}<small>分</small>${seconds}<small>秒</small>`;
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

function getDisplayedNow() {
  const currentState = liveState.payload.state;
  if (!currentState) return Date.now();
  if (currentState.isPaused && Number.isFinite(Number(currentState.pausedDisplayedTime))) {
    return Number(currentState.pausedDisplayedTime);
  }
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
  const isRed = Number(message.redUntil || 0) > now;
  const signature = JSON.stringify({
    line1,
    line2,
    hasMessage,
    isBlinking,
    isRed,
  });

  if (liveState.ui.messageSignature === signature) {
    return;
  }

  liveState.ui.messageSignature = signature;

  liveElements.message.hidden = !hasMessage;
  liveElements.message.classList.toggle('is-blinking', isBlinking && hasMessage);
  liveElements.root.classList.toggle('is-blinking', isBlinking);
  liveElements.root.classList.toggle('is-red-alert', isRed);
  liveElements.messageLine1.textContent = line1 || '\u00A0';
  liveElements.messageLine2.textContent = line2 || '\u00A0';
}

function renderBrowserTime() {
  const isPaused = Boolean(liveState.payload.state?.isPaused);

  if (liveElements.offsetStatus) {
    const offsetSeconds = Number(liveState.payload.state?.globalOffsetSeconds ?? 0);
    liveElements.offsetStatus.textContent = formatOffsetLabel(offsetSeconds);
    liveElements.offsetStatus.classList.toggle('is-ahead', offsetSeconds > 0);
    liveElements.offsetStatus.classList.toggle('is-behind', offsetSeconds < 0);
    liveElements.offsetStatus.classList.toggle('is-on-time', offsetSeconds === 0);
  }

  if (liveElements.pauseStatus) {
    liveElements.pauseStatus.hidden = !isPaused;
  }

  liveElements.root.classList.toggle('is-paused', isPaused);

  if (liveElements.browserTime) {
    liveElements.browserTime.textContent = formatBrowserDateTime(Date.now());
  }
}

function renderLiveView() {
  renderBrowserTime();
  const currentItem = getCurrentItem();

  if (!currentItem) {
    liveElements.title.textContent = 'イベント待機中';
    liveElements.subtitle.textContent = '現在進行中のプログラムはありません';
    liveElements.remaining.innerHTML = '--<small>分</small>--<small>秒</small>';
    liveElements.progressValue.textContent = '0%';
    liveElements.progressBar.style.width = '0%';
    liveElements.progressBar.className = 'stage-1';
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
  liveElements.remaining.innerHTML = formatRemainingJapaneseHtml(remaining);
  liveElements.progressValue.textContent = `${Math.round(progress)}%`;
  liveElements.progressBar.style.width = `${progress}%`;
  liveElements.progressBar.className = getProgressStage(progress);
}

async function bootstrapLiveView() {
  const response = await fetch('/api/bootstrap');
  liveState.payload = await response.json();
  liveState.ui.messageSignature = '';
  updateFullscreenButton();
  renderMessage();
  renderLiveView();
}

liveSocket.on('sync_state', (payload) => {
  liveState.payload = payload;
  liveState.ui.messageSignature = '';
  renderMessage();
  renderLiveView();
});

setInterval(() => {
  if (!liveState.payload.state) return;
  renderMessage();
  renderLiveView();
}, 1000);

liveElements.fullscreenToggle?.addEventListener('click', async () => {
  try {
    await toggleFullscreen();
  } catch (_error) {
    // Ignore user-agent-specific fullscreen failures and keep the button usable.
  } finally {
    updateFullscreenButton();
  }
});

document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
document.addEventListener('msfullscreenchange', updateFullscreenButton);

bootstrapLiveView();
