// mO.ai TUI カラーパレット
// 世界観: 石(モアイ像)に黒曜石(モデル)をはめると動き出す。
// 石は無彩色、黒曜石だけが色を持つ — 色の使い分け自体がメタファーになっている。

export const color = {
  // モアイ像＝石。彩度ゼロ。
  stone: '#9a9488',
  stoneDim: '#5c584f',
  stoneBright: '#d6cfc0',

  // 黒曜石＝モデル。火山ガラスの紫の照り。
  obsidian: '#b388ff',
  obsidianDim: '#6b4fa0',

  // 起動中の灯り。
  ember: '#ffb454',
  live: '#7ee787',

  // 系統別のしるし
  subscription: '#7ee787',
  apikey: '#79c0ff',
  local: '#ffa657',

  danger: '#ff7b72',
  muted: '#6e7681',
};

// 黒曜石の状態記号
export const glyph = {
  obsidian: '◆',
  socket: '◇',
  empty: '·',
  running: '●',
  idle: '○',
  left: '◂',
  right: '▸',
  cursor: '▸',
};

// 3系統の表示名（[[project_moai_tui]] のマルチバックエンド構想）
export const backendLabel = {
  subscription: 'サブスク',
  apikey: 'APIキー',
  local: 'ローカル',
};
