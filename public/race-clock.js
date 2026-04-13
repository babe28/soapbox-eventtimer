const raceClockState = {
  payload: {
    state: null,
    schedule: [],
    serverTime: Date.now(),
  },
  ui: {
    countdownSignature: '',
  },
};

const raceClockSocket = io();

const raceClockElements = {
  face: document.querySelector('#race-clock-face'),
  hourHand: document.querySelector('#race-clock-hour-hand'),
  minuteHand: document.querySelector('#race-clock-minute-hand'),
  secondHand: document.querySelector('#race-clock-second-hand'),
  pauseStatus: document.querySelector('#race-clock-pause-status'),
  remaining: document.querySelector('#race-clock-remaining'),
  nextTitle: document.querySelector('#race-clock-next-title'),
};

function createMarkers() {
  if (!raceClockElements.face) return;

  for (let index = 0; index < 60; index += 1) {
    const marker = document.createElement('span');
    marker.className = `race-clock-marker${index % 5 === 0 ? '' : ' is-minor'}`;
    marker.style.setProperty('--marker-index', String(index / 5));

    if (index % 5 !== 0) {
      marker.style.transform = `translate(-50%, calc(-1 * (var(--face-size) / 2) + var(--face-padding))) rotate(${index * 6}deg)`;
    }

    raceClockElements.face.append(marker);
  }
}

function getDisplayedNow() {
  const currentState = raceClockState.payload.state;
  if (!currentState) return Date.now();
  if (currentState.isPaused && Number.isFinite(Number(currentState.pausedDisplayedTime))) {
    return Number(currentState.pausedDisplayedTime);
  }
  return Date.now() + Number(currentState.globalOffsetSeconds || 0) * 1000;
}

function formatCountdown(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
}

function getNextRace(referenceTime) {
  return raceClockState.payload.schedule.find((item) => {
    if (item?.type !== 'race') return false;
    return new Date(item.start).getTime() > referenceTime;
  }) ?? null;
}

function renderCountdown() {
  const displayedNow = getDisplayedNow();
  const nextRace = getNextRace(displayedNow);

  if (!nextRace) {
    const signature = 'empty';
    if (raceClockState.ui.countdownSignature === signature) {
      return;
    }

    raceClockState.ui.countdownSignature = signature;
    raceClockElements.face?.classList.add('is-empty');
    raceClockElements.remaining.textContent = '予定されているレースはありません';
    raceClockElements.nextTitle.textContent = '';
    return;
  }

  const remainingSeconds = Math.max(0, Math.floor((new Date(nextRace.start).getTime() - displayedNow) / 1000));
  const signature = `${nextRace.id}:${remainingSeconds}`;

  if (raceClockState.ui.countdownSignature === signature) {
    return;
  }

  raceClockState.ui.countdownSignature = signature;
  raceClockElements.face?.classList.remove('is-empty');
  raceClockElements.remaining.textContent = formatCountdown(remainingSeconds);
  raceClockElements.nextTitle.textContent = nextRace.title || '';
}

function renderClock() {
  const now = new Date(getDisplayedNow());
  const seconds = now.getSeconds() + (now.getMilliseconds() / 1000);
  const minutes = now.getMinutes() + (seconds / 60);
  const hours = (now.getHours() % 12) + (minutes / 60);

  raceClockElements.hourHand.style.transform = `translateX(-50%) rotate(${hours * 30}deg)`;
  raceClockElements.minuteHand.style.transform = `translateX(-50%) rotate(${minutes * 6}deg)`;
  raceClockElements.secondHand.style.transform = `translateX(-50%) rotate(${seconds * 6}deg)`;
  const isPaused = Boolean(raceClockState.payload.state?.isPaused);
  raceClockElements.face?.classList.toggle('is-paused', isPaused);
  if (raceClockElements.pauseStatus) {
    raceClockElements.pauseStatus.hidden = !isPaused;
  }
}

function render() {
  renderClock();
  renderCountdown();
  requestAnimationFrame(render);
}

async function bootstrapRaceClock() {
  const response = await fetch('/api/bootstrap');
  raceClockState.payload = await response.json();
  renderCountdown();
}

raceClockSocket.on('sync_state', (payload) => {
  raceClockState.payload = payload;
  renderCountdown();
});

createMarkers();
bootstrapRaceClock();
render();
