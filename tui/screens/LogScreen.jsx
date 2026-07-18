import React from 'react';
import { Box, Text } from 'ink';
import { color, glyph } from '../theme.js';
import { runLog, running, session } from '../data/mock.js';

const LEVEL = {
  ok: { mark: '✔', color: color.live },
  run: { mark: '▶', color: color.ember },
  warn: { mark: '▲', color: '#e3b341' },
  err: { mark: '✖', color: color.danger },
};

export default function LogScreen() {
  const runners = Object.entries(running);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={color.muted}>同時実行 </Text>
        <Text color={color.stoneBright}>
          {session.concurrency} / {session.maxConcurrency}
        </Text>
        <Text color={color.stoneDim}>{'  │  '}</Text>
        <Text color={color.muted}>起動中の像 </Text>
        {runners.map(([id], i) => (
          <Text key={id} color={color.ember}>
            {i > 0 ? ', ' : ''}
            {glyph.running} {id.replace('2aio-', '')}
          </Text>
        ))}
      </Box>

      <Text color={color.stoneDim}>{'─'.repeat(72)}</Text>

      <Box flexDirection="column" marginTop={1}>
        {runLog.map((entry, i) => {
          const lv = LEVEL[entry.level] || LEVEL.ok;
          return (
            <Box key={i}>
              <Box width={10}>
                <Text color={color.stoneDim}>{entry.at}</Text>
              </Box>
              <Box width={3}>
                <Text color={lv.color}>{lv.mark}</Text>
              </Box>
              <Box width={13}>
                <Text color={color.obsidianDim}>{entry.agent}</Text>
              </Box>
              <Text color={color.stone}>{entry.text}</Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color={color.stoneDim}>{'─'.repeat(72)}</Text>
      </Box>
      <Box>
        <Text color={color.muted}>ダミーログ — 実行系は未接続</Text>
      </Box>
    </Box>
  );
}
