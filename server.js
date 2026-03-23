const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// --- 状態管理 ---
let state = {
  globalOffset: 0, // 秒単位
  isPaused: false,
  timers: [
    { id: 1, label: "タイマー1", mode: "down", status: "stopped", value: 180, lastUpdate: Date.now() },
    { id: 2, label: "タイマー2", mode: "down", status: "stopped", value: 600, lastUpdate: Date.now() }
  ]
};

let schedule = []; // 本来は JSON から読み込み

// --- ロジック ---

// 全クライアントに現在の状態を同期
const sync = () => io.emit('sync_state', { state, schedule, serverTime: Date.now() });

// --- WebSocket 通信 ---
io.on('connection', (socket) => {
  console.log('Client connected');
  socket.emit('sync_state', { state, schedule, serverTime: Date.now() });

  // オフセット更新 (+60, -30 など)
  socket.on('update_offset', (delta) => {
    state.globalOffset += delta;
    sync();
  });

  // 再同期（現在の項目、または直近の項目を「今」開始させる）
  socket.on('resync', (itemId) => {
    const item = schedule.find(i => i.id === itemId);
    if (item) {
      const originalStart = new Date(item.start).getTime();
      state.globalOffset = Math.floor((Date.now() - originalStart) / 1000);
      sync();
    }
  });

  // 独立タイマー操作
  socket.on('control_timer', ({ id, action, value }) => {
    const timer = state.timers.find(t => t.id === id);
    if (!timer) return;

    if (action === 'start') timer.status = 'running';
    if (action === 'pause') timer.status = 'paused';
    if (action === 'reset') {
      timer.status = 'stopped';
      timer.value = value || 180;
    }
    timer.lastUpdate = Date.now();
    sync();
  });
});

// --- HTTP API (Companion用) ---
app.post('/api/offset', (req, res) => {
  state.globalOffset += parseInt(req.body.value || 0);
  sync();
  res.json({ success: true, newOffset: state.globalOffset });
});

// サーバー起動
const PORT = 3333;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});