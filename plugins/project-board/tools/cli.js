// CLI（tools/*.js）で共有する data.json の読み書き。save は検証に通ったときだけ書く。
import { readFileSync, writeFileSync, renameSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { validate } from "../src/core/schema.js";

// 読んだ時点のファイルの印（更新日時とサイズ）。save が、読んでから書くまでの間に他が書き換えていないかを確かめる
const seen = new Map();
const stamp = (p) => { const s = statSync(p); return `${s.mtimeMs}:${s.size}`; };

/** 読んだ時点の印を覚える。印は、中身より先に取る（読む間に書き換わっても、あとの save が競合として気づく） */
export function readJson(p) {
  let sig = null;
  try { sig = stamp(p); } catch { /* 読めないときは、次の readFileSync が例外を投げる */ }
  const data = JSON.parse(readFileSync(p, "utf8"));
  if (sig) seen.set(resolve(p), sig);
  return data;
}
export const out = (v) => console.log(JSON.stringify(v, null, 2));

/** 置き換え（rename）を最大 3 回試す。ウイルス対策ソフトなどがファイルを開いている間の、一時的な失敗に備える。3 回とも失敗したら、最後の例外を投げる */
export function renameWithRetry(from, to, rename = renameSync, sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)) {
  for (let n = 1; ; n++) {
    try { return rename(from, to); } catch (e) { if (n === 3) throw e; sleep(100); }
  }
}

/**
 * 検証に通ったときだけ書く。通らなければ例外（errors を連結した文言）で、何も書かない。
 * 書き込みの途中で止まっても元のファイルが壊れないよう、同じフォルダの一時ファイルに書いてから置き換える。
 * readJson で読んだあとに他（ブラウザ・別のコマンド）がファイルを書き換えていたら、上書きせず例外にする（もう一度読み直して実行する）。
 * 置き換えに 3 回失敗したときは、直接上書きせず例外にする（上書きの途中で止まると、ファイルが壊れるため）。rename は、テストで置き換えを失敗させるための差し込み口。
 */
export function save(path, data, rename = renameSync) {
  const { errors } = validate(data);
  if (errors.length) throw new Error(errors.join(" / "));
  const key = resolve(path), read = seen.get(key);
  const assertFresh = () => { if (read && read !== stamp(path)) throw new Error("他で更新されました。読み直して、もう一度実行してください"); };
  assertFresh();
  const text = JSON.stringify(data, null, 2) + "\n";
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, text);
    try { renameWithRetry(tmp, path, rename); } catch (e) { throw new Error(`${path} を置き換えられませんでした（${e.message}）。ウイルス対策ソフトや同期ソフトなど、ほかのプログラムが data.json を開いていないか確かめて、もう一度実行してください`); }
  } finally {
    try { rmSync(tmp, { force: true }); } catch { /* 消せなくても、データは書けている */ }
  }
  seen.set(key, stamp(path));
}
