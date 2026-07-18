import React from 'react';
import { Box, Text } from 'ink';
import Moai from '../components/Moai.jsx';
import { color, glyph, backendLabel } from '../theme.js';
import {
  agents,
  obsidians,
  groupLabel,
  fitted,
  quota,
  tasks,
  callsFor,
  gateFor,
  historyFor,
} from '../data/mock.js';

// neofetch 風: 左に像、右にそのエージェントの実像。
// マシンの情報（ホスト名/シェル/カーネル/IP）は出さない。エージェントは機械ではないので、
// 実データに繋ぐ段になって埋められない項目を最初から置かない。
const LABEL_W = 12;

const byId = Object.fromEntries(obsidians.map((o) => [o.id, o]));

function Field({ label, children }) {
  return (
    <Box>
      <Box width={LABEL_W}>
        <Text color={color.muted}>{label}</Text>
      </Box>
      {children}
    </Box>
  );
}

function Section({ title, children }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={color.muted}>{title}</Text>
      {children}
    </Box>
  );
}

function Bar({ pct, tint, width = 10 }) {
  const n = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return (
    <Text>
      <Text color={tint}>{'█'.repeat(n)}</Text>
      <Text color={color.stoneDim}>{'░'.repeat(width - n)}</Text>
    </Text>
  );
}

// クォータは像ではなく黒曜石＝プロバイダのアカウントに付く。
// 同じ窓を食い合う像が何体いるかを併記しないと、並列実行数の判断ができない。
function Quota({ obsidian }) {
  if (!obsidian) return <Text color={color.stoneDim}>—</Text>;
  const q = quota[obsidian.provider];
  if (!q) return <Text color={color.stoneDim}>—</Text>;
  if (q.kind !== 'window') {
    return <Text color={color.muted}>{q.note}</Text>;
  }
  const tint = q.pct < 20 ? color.danger : q.pct < 40 ? color.ember : color.live;
  return (
    <Box>
      <Bar pct={q.pct} tint={tint} />
      <Text color={tint}> 残り {q.pct}%</Text>
    </Box>
  );
}

function QuotaNote({ obsidian }) {
  if (!obsidian) return null;
  const q = quota[obsidian.provider];
  if (!q || q.kind !== 'window') return null;
  const sharing = Object.values(fitted).filter(
    (id) => byId[id]?.provider === obsidian.provider
  ).length;
  return (
    <Field label="">
      <Text color={color.muted}>
        {q.label} · 共有 {sharing}体 · 対話込み
      </Text>
    </Field>
  );
}

function StateTag({ state }) {
  if (state === 'running')
    return (
      <Text color={color.ember} bold>
        {glyph.running} 起動中
      </Text>
    );
  if (state === 'fitted') return <Text color={color.live}>{glyph.idle} 待機</Text>;
  return <Text color={color.stoneDim}>{glyph.empty} 黒曜石なし</Text>;
}

function Task({ task }) {
  return (
    <Box flexDirection="column">
      <Field label={task.id}>
        <Text color={color.stoneBright}>{task.title}</Text>
      </Field>
      <Field label="進捗">
        <Bar pct={(task.done / task.total) * 100} tint={color.obsidian} width={12} />
        <Text color={color.stone}>
          {'  '}
          {task.done} / {task.total}
        </Text>
      </Field>
      <Field label="経過">
        <Text color={color.stone}>{task.elapsed}</Text>
        {task.maxRetries > 0 && (
          <Text color={task.retries > 0 ? color.ember : color.muted}>
            {'   '}自己修正 {task.retries}/{task.maxRetries}
          </Text>
        )}
      </Field>
    </Box>
  );
}

// 走っていない像は「何を待っているか」を出す。ここは飾りではなく ARCHITECTURE のゲートそのもの。
function Gate({ agent, hasObsidian }) {
  const g = gateFor(agent);
  return (
    <Box flexDirection="column">
      <Field label="条件">
        <Text color={color.stoneBright}>{g.cond}</Text>
      </Field>
      <Field label="状況">
        <Text color={color.stone}>{g.now}</Text>
      </Field>
      {!hasObsidian && (
        <Field label="">
          <Text color={color.danger}>条件が揃っても動けない（黒曜石なし）</Text>
        </Field>
      )}
    </Box>
  );
}

const LEVEL = {
  ok: ['✔', color.live],
  run: ['▶', color.ember],
  warn: ['▲', '#e3b341'],
  err: ['✖', color.danger],
};

function History({ agent }) {
  const rows = historyFor(agent);
  if (rows.length === 0) return <Text color={color.stoneDim}>実行履歴なし</Text>;
  return (
    <Box flexDirection="column">
      {rows.map((r, i) => {
        const [mark, tint] = LEVEL[r.level] || LEVEL.ok;
        return (
          <Box key={i}>
            <Box width={7}>
              <Text color={color.stoneDim}>{r.at}</Text>
            </Box>
            <Box width={3}>
              <Text color={tint}>{mark}</Text>
            </Box>
            <Text color={color.stone}>{r.text}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

export default function MoaiScreen({ index, state }) {
  const agent = agents[index];
  const obsidian = byId[fitted[agent.id]] || null;
  const task = tasks[agent.id] || null;
  const calls = callsFor(agent);

  return (
    <Box paddingX={1}>
      <Moai state={state} />

      <Box flexDirection="column" marginLeft={3}>
        <Box>
          <Text color={color.stoneBright} bold>
            {agent.id}
          </Text>
          <Box marginLeft={2}>
            <StateTag state={state} />
          </Box>
        </Box>
        <Text color={color.muted}>
          {groupLabel[agent.group]}レーン / {agent.model}
          {agent.pinned ? ' 固定' : ' 継承'}
        </Text>

        <Box flexDirection="column" marginTop={1}>
          <Field label="黒曜石">
            {obsidian ? (
              <Text color={color.obsidian}>
                {glyph.obsidian} {obsidian.label}
              </Text>
            ) : (
              <Text color={color.stoneDim}>—— 未装着</Text>
            )}
          </Field>
          <Field label="系統">
            {obsidian ? (
              <Box>
                <Text color={color[obsidian.backend]}>{backendLabel[obsidian.backend]}</Text>
                <Text color={color.muted}> / {obsidian.provider}</Text>
              </Box>
            ) : (
              <Text color={color.stoneDim}>—</Text>
            )}
          </Field>
          <Field label="クォータ">
            <Quota obsidian={obsidian} />
          </Field>
          <QuotaNote obsidian={obsidian} />
        </Box>

        {task ? (
          <Section title="いまのタスク">
            <Task task={task} />
          </Section>
        ) : (
          <Section title="待っているもの">
            <Gate agent={agent} hasObsidian={Boolean(obsidian)} />
          </Section>
        )}

        <Section title="直近の実行">
          <History agent={agent} />
        </Section>

        <Section title="呼び出し">
          <Box>
            <Box width={18}>
              <Text color={color.stone}>← {calls.from.id}</Text>
            </Box>
            <Text color={color.muted}>{calls.from.via}</Text>
          </Box>
          <Box>
            <Box width={18}>
              <Text color={color.stone}>→ {calls.to.id}</Text>
            </Box>
            <Text color={color.muted}>{calls.to.why}</Text>
          </Box>
        </Section>
      </Box>
    </Box>
  );
}
