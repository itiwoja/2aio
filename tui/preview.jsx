// 全ページを一度に描き出す静的プレビュー。キー入力を受け付けないので、パイプ・レビュー用。
// 対話で触るなら `npm start`。
import React from 'react';
import { render, Box, Text } from 'ink';
import { StatusBar } from './components/Chrome.jsx';
import PageNav from './components/PageNav.jsx';
import MoaiScreen from './screens/MoaiScreen.jsx';
import AgentsScreen from './screens/AgentsScreen.jsx';
import ObsidianScreen from './screens/ObsidianScreen.jsx';
import LogScreen from './screens/LogScreen.jsx';
import SettingsScreen from './screens/SettingsScreen.jsx';
import { color } from './theme.js';
import { agents, pages, fitted } from './data/mock.js';

const HINTS = [
  ['←/→', '項目移動'],
  ['↑/↓', 'ページ移動'],
  ['TAB', '詳細'],
  ['r', '更新'],
  ['q', '終了'],
];

const iEngineer = agents.findIndex((a) => a.id === '2aio-engineer');

function Frame({ page, children }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color.stoneDim}
      width={78}
      marginBottom={1}
    >
      <Box flexDirection="column" paddingY={1}>
        {children}
      </Box>
      <Box marginBottom={1}>
        <PageNav page={page} />
      </Box>
      <Box
        borderStyle="single"
        borderColor={color.stoneDim}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      />
      <StatusBar hints={HINTS} />
    </Box>
  );
}

function Caption({ children }) {
  return (
    <Box marginBottom={1}>
      <Text color={color.obsidian} bold>
        {'▌ '}
      </Text>
      <Text color={color.stoneBright} bold>
        {children}
      </Text>
    </Box>
  );
}

function Preview() {
  const eng = agents[iEngineer];
  return (
    <Box flexDirection="column">
      <Caption>3 / 5 — moai（起動中）</Caption>
      <Frame page={pages.indexOf('moai')}>
        <MoaiScreen index={iEngineer} state="running" />
      </Frame>

      <Caption>3 / 5 — moai（待機・ゲート待ち）</Caption>
      <Frame page={pages.indexOf('moai')}>
        <MoaiScreen index={agents.findIndex((a) => a.id === '2aio-qa')} state="fitted" />
      </Frame>

      <Caption>3 / 5 — moai（黒曜石なし）</Caption>
      <Frame page={pages.indexOf('moai')}>
        <MoaiScreen
          index={agents.findIndex((a) => a.id === '2aio-migration-runner')}
          state="empty"
        />
      </Frame>

      <Caption>1 / 5 — dashboard</Caption>
      <Frame page={pages.indexOf('dashboard')}>
        <AgentsScreen index={iEngineer} />
      </Frame>

      <Caption>2 / 5 — system</Caption>
      <Frame page={pages.indexOf('system')}>
        <ObsidianScreen agentIndex={iEngineer} cursor={1} fittedId={fitted[eng.id]} />
      </Frame>

      <Caption>4 / 5 — logs</Caption>
      <Frame page={pages.indexOf('logs')}>
        <LogScreen />
      </Frame>

      <Caption>5 / 5 — settings</Caption>
      <Frame page={pages.indexOf('settings')}>
        <SettingsScreen cursor={0} />
      </Frame>
    </Box>
  );
}

render(<Preview />);
