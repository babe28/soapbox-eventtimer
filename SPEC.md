# Event Dashboard System Specification (v1.0)

## 1. プロジェクト概要
ローカルLAN内で動作する、イベント進行管理用のリアルタイム・ダッシュボード。
「自動進行」をベースとし、最小限の操作で「押し・巻き（進行補正）」を全端末に即時反映させる。

### ターゲット環境
- **Server:** Node.js (Express), Raspberry Pi または Windows PC
- **Network:** ローカルLAN内（オフライン運用可）
- **Clients:** ブラウザ（Chrome/Safari等）、Bitfocus Companion

---

## 2. コア・ロジック：時刻管理
本システムは「スケジュール自体の書き換え」を行わず、**「Offset（ズレ）」の概念**で全ての表示を制御する。

- **Master Schedule:** 事前登録された絶対的な開始・終了時刻。
- **Global Offset (`globalOffsetSeconds`):** 予定に対する進み・遅れの秒数（初期値: 0）。
- **Displayed Time (表示時刻):** `Master Schedule Time + Global Offset`
- **Resync (再同期):** 特定の項目が「今始まった」瞬間にボタンを押すと、`現在時刻 - その項目の本来の開始時刻` を計算し、`globalOffsetSeconds` を自動更新する。

---

## 3. 技術スタック
- **Backend:** Node.js (Express)
- **Real-time:** Socket.io (Stateの全クライアント同期)
- **Frontend:** Vanilla JS / Vue.js / React (Tailwind CSS推奨)
- **Storage:** JSONファイル（`data/schedule.json`, `data/state.json`）
- **External:** HTTP API (Companion用)

---

## 4. データ構造

### Global State (サーバー保持)
```json
{
  "globalOffsetSeconds": 0,
  "isPaused": false,
  "timers": [
    {
      "id": 1,
      "label": "タイマー1",
      "mode": "down",
      "status": "stopped", // running | paused | stopped
      "value": 180,       // 現在の秒数
      "initialValue": 180,
      "lastUpdate": 1711100000000 // サーバー時刻(ms)
    }
  ],
  "currentScheduleId": null
}

Schedule Item
JSON
{
  "id": "evt_001",
  "title": "オープニング",
  "subTitle": "主催者挨拶",
  "start": "2026-03-22T09:00:00", // ISO8601 (日付固定)
  "duration": 300,               // 秒単位
  "section": "Stage",
  "type": "normal"
}
5. 通信仕様
WebSocket (Socket.io)
sync_state: 接続時・状態変更時にサーバーから全クライアントへ全Stateを送信。

update_offset: クライアントからオフセットの増減（±30, ±60, ±300等）を通知。

resync: 特定IDの開始を「今」に合わせる命令。

control_timer: 独立タイマーの Start / Pause / Reset 命令。

HTTP API (POST)
/api/offset: { "value": number } (秒単位の増減)

/api/resync: { "id": string }

/api/timer/:id/:action: タイマー制御

6. 画面構成要求
画面AA：全画面表示（メイン）
視認性: 黒背景、高コントラスト、モダンなデザイン。

ヘッダー: イベント名、現在時刻（秒まで）。

中央: 進行中の予定（タイトル・補足・時間）、進行バー(%)、次の予定までの残りカウントダウン。

右側: 俯瞰スケジュール（リスト表示。設定により表示件数を可変に）。

下部: 独立タイマー2本。

画面B/BB：管理・操作（PC/Mobile共通）
操作系: +30s, +1m, +5m, -30s, -1m, 再同期, Pause/Resume ボタン。

タイマー操作: 各タイマーの Start / Stop / Reset。

画面C：設定
CSVインポート / エクスポート機能。

スケジュール項目の手動編集。

各画面へのリンク（QRコード表示）。

7. 実装上の注意
日付跨ぎ: 非対応（同一日内のみ）。

時刻同期: sync_state 送信時に serverTime: Date.now() を付与し、クライアント側でローカル時計との差分を考慮すること。

独立タイマー: 1秒程度のズレは許容するが、基本はサーバーの lastUpdate を基準にクライアント側でカウントを回す「マスター・スレーブ方式」とする。