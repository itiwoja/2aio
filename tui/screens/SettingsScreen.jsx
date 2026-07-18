import React from 'react';
import { Box, Text } from 'ink';
import { color, glyph } from '../theme.js';
import { session } from '../data/mock.js';

// 側だけ。トグルは押しても何も起きない。
const ITEMS = [
  ['既定のモデル', 'claude-sonnet-5', '新しく黒曜石をはめる時の初期値'],
  ['同時実行数', String(session.maxConcurrency), 'サブスクのクォータを食い合うため既定は1'],
  ['クォータ警告', '残り 20% で通知', '5時間ウィンドウの残量がこれを切ったら'],
  ['ローカルLLM', 'localhost:11434', 'Ollama の宛先'],
  ['出力先', '2aio-output/', 'TWOAIO_OUTPUT_DIR で上書き可'],
  ['トースト通知', 'ON', 'done / failed / budget_stop'],
];

export default function SettingsScreen({ cursor = 0 }) {
  return (
    <Box flexDirection="column" paddingX={1}>
      {ITEMS.map(([label, value, note], i) => {
        const on = i === cursor;
        return (
          <Box key={label}>
            <Text color={on ? color.obsidian : color.stoneDim}>{on ? glyph.cursor : ' '} </Text>
            <Box width={16}>
              <Text color={on ? color.stoneBright : color.stone} bold={on}>
                {label}
              </Text>
            </Box>
            <Box width={22}>
              <Text color={color.obsidian}>{value}</Text>
            </Box>
            <Text color={color.muted}>{note}</Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text color={color.muted}>設定は保存されない — 側のみ</Text>
      </Box>
    </Box>
  );
}
