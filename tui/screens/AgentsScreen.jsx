import React from 'react';
import { Box, Text } from 'ink';
import { color, glyph } from '../theme.js';
import { agents, obsidians, fitted, running } from '../data/mock.js';

// レーン＝石切場の区画。カラムを跨いで ↑↓ で連続移動できるよう、
// agents の並び順そのものがカラムの並び順になっている。
const COLUMNS = [
  { group: 'board', label: '取締役会' },
  { group: 'impl', label: '実装' },
  { group: 'review', label: '監査' },
  { group: 'research', label: 'リサーチ' },
];

const byId = Object.fromEntries(obsidians.map((o) => [o.id, o]));

function AgentRow({ agent, selected }) {
  const fit = fitted[agent.id];
  const isRunning = Boolean(running[agent.id]);
  const mark = !fit ? glyph.empty : isRunning ? glyph.running : glyph.obsidian;
  const markColor = !fit ? color.stoneDim : isRunning ? color.ember : color.obsidian;

  return (
    <Box>
      <Text color={selected ? color.obsidian : color.stoneDim}>
        {selected ? glyph.cursor : ' '}{' '}
      </Text>
      <Text color={markColor}>{mark} </Text>
      <Text
        color={selected ? color.stoneBright : fit ? color.stone : color.stoneDim}
        bold={selected}
      >
        {agent.short}
      </Text>
    </Box>
  );
}

export default function AgentsScreen({ index }) {
  const nFitted = Object.keys(fitted).length;
  const nRunning = Object.keys(running).length;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={2}>
        {COLUMNS.map((col) => (
          <Box key={col.group} flexDirection="column" width={17}>
            <Text color={color.stoneBright} bold>
              {col.label}
            </Text>
            <Text color={color.stoneDim}>{'─'.repeat(15)}</Text>
            {agents
              .filter((a) => a.group === col.group)
              .map((a) => (
                <AgentRow key={a.id} agent={a} selected={agents.indexOf(a) === index} />
              ))}
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color={color.stoneDim}>{'─'.repeat(72)}</Text>
      </Box>

      <Box marginTop={1} gap={3}>
        <Box>
          <Text color={color.obsidian}>{glyph.obsidian} </Text>
          <Text color={color.muted}>
            装着 {nFitted} / {agents.length}
          </Text>
        </Box>
        <Box>
          <Text color={color.ember}>{glyph.running} </Text>
          <Text color={color.muted}>起動中 {nRunning}</Text>
        </Box>
        <Box>
          <Text color={color.stoneDim}>{glyph.empty} </Text>
          <Text color={color.muted}>未装着 {agents.length - nFitted}</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={color.muted}>選択中 </Text>
        <Text color={color.stoneBright}>{agents[index].id}</Text>
        <Text color={color.muted}>
          {'  '}
          {fitted[agents[index].id]
            ? `${glyph.obsidian} ${byId[fitted[agents[index].id]].label}`
            : '未装着'}
        </Text>
      </Box>
    </Box>
  );
}
