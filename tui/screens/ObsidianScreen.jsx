import React from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { StatusDot } from '../components/Chrome.jsx';
import { color, glyph, backendLabel } from '../theme.js';
import { agents, obsidians } from '../data/mock.js';

const RULE_WIDTH = 60;

// 3系統を1本のリストに並べつつ、系統の切れ目には見出しを挟む。
// 「APIキー型もローカルLLM型もサブスク型も同じ棚から選ぶ」という構想を、
// 別画面に分けずワンリストで見せている。
function withHeadings(list) {
  const rows = [];
  let last = null;
  for (const o of list) {
    if (o.backend !== last) {
      rows.push({ heading: o.backend });
      last = o.backend;
    }
    rows.push({ obsidian: o });
  }
  return rows;
}

export default function ObsidianScreen({ agentIndex, cursor, fittedId }) {
  const agent = agents[agentIndex];
  const rows = withHeadings(obsidians);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={color.muted}>はめる先 </Text>
        <Text color={color.stoneBright} bold>
          {agent.id}
        </Text>
        <Text color={color.muted}> の目に、黒曜石を選ぶ</Text>
      </Box>

      {rows.map((row, i) => {
        if (row.heading) {
          const label = backendLabel[row.heading];
          // 見出しは全角混じり。文字数ではなく表示幅で埋めないと罫線が揃わない。
          const fill = Math.max(0, RULE_WIDTH - 4 - stringWidth(label));
          return (
            <Box key={`h-${row.heading}`} marginTop={i === 0 ? 0 : 1}>
              <Text color={color[row.heading]} bold>
                ── {label}{' '}
              </Text>
              <Text color={color.stoneDim}>{'─'.repeat(fill)}</Text>
            </Box>
          );
        }

        const o = row.obsidian;
        const idx = obsidians.indexOf(o);
        const selected = idx === cursor;
        const isFitted = o.id === fittedId;
        const dim = o.status === 'auth' || o.status === 'offline';

        return (
          <Box key={o.id}>
            <Text color={selected ? color.obsidian : color.stoneDim}>
              {selected ? glyph.cursor : ' '}{' '}
            </Text>
            <Text color={isFitted ? color.obsidian : dim ? color.stoneDim : color.obsidianDim}>
              {isFitted ? glyph.obsidian : glyph.socket}{' '}
            </Text>
            <Box width={22}>
              <Text
                color={dim ? color.stoneDim : selected ? color.stoneBright : color.stone}
                bold={selected}
              >
                {o.label}
              </Text>
            </Box>
            <Box width={14}>
              <Text color={color.muted}>{o.provider}</Text>
            </Box>
            <Box width={14}>
              <StatusDot status={o.status} />
            </Box>
            {isFitted && <Text color={color.obsidian}>装着中</Text>}
          </Box>
        );
      })}

      <Box marginTop={1} paddingLeft={2}>
        <Text color={color.muted}>{obsidians[cursor].note}</Text>
      </Box>
    </Box>
  );
}
