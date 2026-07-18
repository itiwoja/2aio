import React, { useState } from 'react';
import { render, Box, useApp, useInput } from 'ink';
import { StatusBar } from './components/Chrome.jsx';
import PageNav from './components/PageNav.jsx';
import MoaiScreen from './screens/MoaiScreen.jsx';
import AgentsScreen from './screens/AgentsScreen.jsx';
import ObsidianScreen from './screens/ObsidianScreen.jsx';
import LogScreen from './screens/LogScreen.jsx';
import SettingsScreen from './screens/SettingsScreen.jsx';
import { color } from './theme.js';
import { agents, obsidians, pages, fitted as initialFitted, running } from './data/mock.js';

// 参照どおりのキー割り当て。←/→ は項目移動、↑/↓ はページ送り。
const HINTS = [
  ['←/→', '項目移動'],
  ['↑/↓', 'ページ移動'],
  ['TAB', '詳細'],
  ['r', '更新'],
  ['q', '終了'],
];

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function App() {
  const { exit } = useApp();
  const [page, setPage] = useState(pages.indexOf('moai'));
  const [index, setIndex] = useState(agents.findIndex((a) => a.id === '2aio-engineer'));
  const [cursor, setCursor] = useState(0);
  // 装着状態だけはローカルに持つ。実際のモデル切り替えには繋がっていない。
  const [fitted] = useState(initialFitted);

  const agent = agents[index];
  const fittedId = fitted[agent.id];
  const runInfo = running[agent.id] || null;
  const state = runInfo ? 'running' : fittedId ? 'fitted' : 'empty';
  const name = pages[page];

  useInput((input, key) => {
    if (input === 'q') return exit();
    if (key.upArrow) return setPage((p) => clamp(p - 1, 0, pages.length - 1));
    if (key.downArrow) return setPage((p) => clamp(p + 1, 0, pages.length - 1));

    // ←/→ の「項目」はページによって指すものが変わる
    if (name === 'system') {
      if (key.leftArrow) return setCursor((c) => clamp(c - 1, 0, obsidians.length - 1));
      if (key.rightArrow) return setCursor((c) => clamp(c + 1, 0, obsidians.length - 1));
      return;
    }
    if (name === 'settings') {
      if (key.leftArrow) return setCursor((c) => clamp(c - 1, 0, 5));
      if (key.rightArrow) return setCursor((c) => clamp(c + 1, 0, 5));
      return;
    }
    if (key.leftArrow) return setIndex((i) => clamp(i - 1, 0, agents.length - 1));
    if (key.rightArrow) return setIndex((i) => clamp(i + 1, 0, agents.length - 1));
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color.stoneDim} width={78}>
      <Box flexDirection="column" paddingY={1}>
        {name === 'moai' && <MoaiScreen index={index} state={state} />}
        {name === 'dashboard' && <AgentsScreen index={index} />}
        {name === 'system' && (
          <ObsidianScreen agentIndex={index} cursor={cursor} fittedId={fittedId} />
        )}
        {name === 'logs' && <LogScreen />}
        {name === 'settings' && <SettingsScreen cursor={cursor} />}
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

render(<App />);
