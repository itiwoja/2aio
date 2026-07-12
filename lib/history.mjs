// 変更履歴: 自動適用するが、適用前を必ずバックアップし、log.json に記録。rollback 可能。
import fs from 'node:fs';
import path from 'node:path';

const dirOf = (root) => path.join(root, 'history');
const logOf = (root) => path.join(dirOf(root), 'log.json');
const bakDir = (root) => path.join(dirOf(root), 'backups');
const ensure = (p) => fs.mkdirSync(p, { recursive: true });
let seq = 0;
const newId = () => Date.now().toString(36) + '-' + (seq++).toString(36);

export function readLog(root) { try { return JSON.parse(fs.readFileSync(logOf(root), 'utf8')); } catch { return []; } }
function writeLog(root, arr) { ensure(dirOf(root)); fs.writeFileSync(logOf(root), JSON.stringify(arr, null, 2)); }

// 適用＋履歴記録（適用前を backup）
export function applyWithHistory(root, targetPath, content, meta = {}) {
  ensure(bakDir(root)); ensure(path.dirname(targetPath));
  const before = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  const id = newId();
  const backup = path.join('history', 'backups', id + '.bak').replace(/\\/g, '/');
  fs.writeFileSync(path.join(root, backup), before);
  fs.writeFileSync(targetPath, content ?? '');
  const rec = { id, time: new Date().toISOString(), kind: 'apply', targetPath, backup, bytesBefore: before.length, bytesAfter: (content || '').length, ...meta };
  const log = readLog(root); log.unshift(rec); writeLog(root, log);
  return rec;
}

// 履歴IDの状態に巻き戻す（巻き戻し自体も履歴に残す＝再巻き戻し可）
export function rollback(root, id) {
  const log = readLog(root);
  const rec = log.find(r => r.id === id);
  if (!rec) return { ok: false, err: '履歴が見つからない' };
  const bakPath = path.join(root, rec.backup);
  if (!fs.existsSync(bakPath)) return { ok: false, err: 'バックアップが見つからない' };
  const restore = fs.readFileSync(bakPath, 'utf8');
  const cur = fs.existsSync(rec.targetPath) ? fs.readFileSync(rec.targetPath, 'utf8') : '';
  ensure(bakDir(root));
  const id2 = newId();
  const backup2 = path.join('history', 'backups', id2 + '.bak').replace(/\\/g, '/');
  fs.writeFileSync(path.join(root, backup2), cur);
  fs.writeFileSync(rec.targetPath, restore);
  const rec2 = { id: id2, time: new Date().toISOString(), kind: 'rollback', targetPath: rec.targetPath, backup: backup2, bytesBefore: cur.length, bytesAfter: restore.length, reason: '元に戻す → ' + (rec.targetDisplay || rec.targetPath), targetDisplay: rec.targetDisplay, of: id };
  log.unshift(rec2); writeLog(root, log);
  return { ok: true, rec: rec2 };
}

// 差分表示用: 適用前(backup) と 現在(target) を返す
export function historyItem(root, id) {
  const rec = readLog(root).find(r => r.id === id);
  if (!rec) return null;
  const before = fs.existsSync(path.join(root, rec.backup)) ? fs.readFileSync(path.join(root, rec.backup), 'utf8') : '';
  const current = fs.existsSync(rec.targetPath) ? fs.readFileSync(rec.targetPath, 'utf8') : '';
  return { rec, before, current };
}
