import React from 'react';
import { Box, Text } from 'ink';
import { color, glyph, backendLabel } from '../theme.js';
import { session, statusLabel } from '../data/mock.js';

const pct = (n) => Math.round((n / session.tokenLimit) * 100);

export function Header({ screen }) {
  const used = pct(session.tokensUsed);
  const bars = 12;
  const filled = Math.round((used / 100) * bars);

  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Box>
        <Text color={color.obsidian} bold>
          mO
        </Text>
        <Text color={color.stoneDim}>.ai</Text>
        <Text color={color.stoneDim}>{'  │  '}</Text>
        <Text color={color.stoneBright}>{screen}</Text>
      </Box>
      <Box>
        <Text color={color.muted}>{session.plan}  </Text>
        <Text color={color.obsidianDim}>{'█'.repeat(filled)}</Text>
        <Text color={color.stoneDim}>{'░'.repeat(bars - filled)}</Text>
        <Text color={color.muted}> {used}%</Text>
      </Box>
    </Box>
  );
}

export function StatusBar({ hints }) {
  return (
    <Box paddingX={1} gap={2}>
      {hints.map(([key, label]) => (
        <Box key={key}>
          <Text color={color.obsidian} bold>
            {key}
          </Text>
          <Text color={color.muted}> {label}</Text>
        </Box>
      ))}
    </Box>
  );
}

export function Rule({ width = 60 }) {
  return <Text color={color.stoneDim}>{'─'.repeat(width)}</Text>;
}

// 黒曜石の系統ラベル（サブスク / APIキー / ローカル）
export function BackendTag({ backend }) {
  return <Text color={color[backend]}>{backendLabel[backend]}</Text>;
}

// 黒曜石が使える状態かどうか
export function StatusDot({ status }) {
  const map = {
    ready: [color.live, glyph.running],
    quota: [color.ember, glyph.running],
    auth: [color.muted, glyph.idle],
    offline: [color.stoneDim, glyph.idle],
  };
  const [c, ch] = map[status] || map.offline;
  return (
    <Text color={c}>
      {ch} {statusLabel[status]}
    </Text>
  );
}
