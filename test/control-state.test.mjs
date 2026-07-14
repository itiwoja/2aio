// startJob から抽出した純関数の回帰固定。ジョブ終了時の状態遷移とワーカー引数順は
// 過去に実事故を起こした箇所（#15 承認待ち上書き / #23 idd-mvp レビュー待ち / 引数順の Input エラー）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

// control.mjs は import 時に副作用を持たない（main ガード）。純関数のみ取り出す。
process.env.AIO_CONTROL_ROOT = process.env.AIO_CONTROL_ROOT || process.cwd();
process.env.AIO_API_TOKEN = process.env.AIO_API_TOKEN || 'test-token';
const { resolveNextState, buildWorkerArgs } = await import('../control.mjs');

test('resolveNextState: waiting_approval は exit 0 でも上書きしない', () => {
  assert.equal(resolveNextState('waiting_approval', 0, 'build'), 'waiting_approval');
  assert.equal(resolveNextState('waiting_approval', 1, 'build'), 'waiting_approval');
});

test('resolveNextState: idd-mvp の正常終了は waiting_review（削軸レビュー待ち）', () => {
  assert.equal(resolveNextState('running', 0, 'idd-mvp'), 'waiting_review');
  // 失敗した idd-mvp は failed（レビュー待ちにしない）
  assert.equal(resolveNextState('running', 1, 'idd-mvp'), 'failed');
});

test('resolveNextState: 通常 kind は exit で done / failed', () => {
  assert.equal(resolveNextState('running', 0, 'build'), 'done');
  assert.equal(resolveNextState('running', 2, 'build'), 'failed');
  assert.equal(resolveNextState(undefined, 0, 'analyze'), 'done');
});

test('buildWorkerArgs: 既定は claude -p、プロンプトが先頭・allowedTools が末尾', () => {
  const { cmd, args } = buildWorkerArgs({
    workerCmd: '', claudeBin: 'claude', prompt: 'PROMPT',
    permissionMode: 'acceptEdits', allowedTools: 'Read,Write',
  });
  assert.equal(cmd, 'claude');
  assert.equal(args[0], '-p');
  assert.equal(args[1], 'PROMPT'); // プロンプトは位置引数として先頭側（Input must be provided バグ防止）
  const ap = args.indexOf('--allowedTools');
  assert.ok(ap > 0 && args[ap + 1] === 'Read,Write');
  assert.ok(args.indexOf('PROMPT') < ap, 'プロンプトは --allowedTools より前');
});

test('buildWorkerArgs: model 指定時は --model を付け、未指定なら付けない', () => {
  const base = { workerCmd: '', claudeBin: 'claude', prompt: 'P', permissionMode: 'acceptEdits', allowedTools: 'Read' };
  const withModel = buildWorkerArgs({ ...base, model: 'sonnet' });
  const mp = withModel.args.indexOf('--model');
  assert.ok(mp > 0 && withModel.args[mp + 1] === 'sonnet');
  assert.ok(withModel.args.indexOf('P') < mp, 'プロンプトは --model より前');
  const without = buildWorkerArgs(base);
  assert.equal(without.args.indexOf('--model'), -1);
});

test('buildWorkerArgs: WORKER_CMD 指定時はそれを分解しプロンプトを末尾に付ける', () => {
  const { cmd, args } = buildWorkerArgs({
    workerCmd: 'node -e run', claudeBin: 'claude', prompt: 'P',
    permissionMode: 'acceptEdits', allowedTools: 'Read',
  });
  assert.equal(cmd, 'node');
  assert.deepEqual(args, ['-e', 'run', 'P']);
});
