import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../plugins/project-board/src/ui/store.js";

// 偽のファイルハンドル（File System Access API の必要部分だけ）
function fakeHandle(initial) {
  const h = {
    name: "data.json", text: JSON.stringify(initial), modified: 1000, writes: 0, failWrite: null, perm: "granted", reqPerm: null,
    async getFile() { return { lastModified: h.modified, text: async () => h.text }; },
    async createWritable() {
      if (h.failWrite) throw h.failWrite;
      let buf = "";
      return { write: async (s) => { buf += s; }, close: async () => { h.text = buf; h.modified += 1; h.writes += 1; } };
    },
    async queryPermission() { return h.perm; },
    async requestPermission() { return h.reqPerm ?? h.perm; },
  };
  return h;
}
const memIdb = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); } }; };
const mk = (h, extra = {}) => createStore({ showOpenFilePicker: async () => [h], idb: memIdb(), ...extra });

// 記憶を共有する 2 つのストア（= ブラウザを開き直す前後）と、ファイル選択の回数
function twice(h) {
  const idb = memIdb(); let picked = 0;
  const deps = { showOpenFilePicker: async () => { picked++; return [h]; }, idb };
  return { first: createStore(deps), second: () => createStore(deps), picked: () => picked };
}

test("choose: 選んだファイルを読み込む", async () => {
  const h = fakeHandle({ tasks: [1, 2] });
  assert.deepEqual(await mk(h).choose(), { tasks: [1, 2] });
});

test("restore: 権限が許可済みなら、ファイル選択も確認も出さずに記憶したファイルを読む", async () => {
  const h = fakeHandle({ tasks: [1, 2] });
  const t = twice(h);
  await t.first.choose();
  h.reqPerm = "denied"; // 確認を出していれば拒否されるので、読めたら確認を出していない
  assert.deepEqual(await t.second().restore(), { tasks: [1, 2] });
  assert.equal(t.picked(), 1);
});

test("restore: 記憶がない、または権限の確認が必要なときは null。確認もファイル選択も出さない", async () => {
  const h = fakeHandle({ a: 1 });
  const t = twice(h);
  assert.equal(await t.second().restore(), null, "記憶なし");
  await t.first.choose();
  h.perm = "prompt"; h.reqPerm = "granted";
  const s = t.second();
  assert.equal(await s.restore(), null, "権限の確認が必要");
  assert.equal(s.hasFile, false);
  assert.equal(t.picked(), 1);
});

test("reopen: 権限の確認で許可されれば、ファイル選択を出さずに読み込み、保存もできる", async () => {
  const h = fakeHandle({ a: 1 });
  const t = twice(h);
  await t.first.choose();
  h.perm = "prompt"; h.reqPerm = "granted";
  const s = t.second();
  assert.deepEqual(await s.reopen(), { a: 1 });
  assert.equal(t.picked(), 1);
  assert.deepEqual(await s.save({ a: 2 }), { ok: true });
});

test("reopen: 権限が拒否されたら例外で、ファイル選択には切り替えない", async () => {
  const h = fakeHandle({ a: 1 });
  const t = twice(h);
  await t.first.choose();
  h.perm = "prompt"; h.reqPerm = "denied";
  await assert.rejects(t.second().reopen(), /許可/);
  assert.equal(t.picked(), 1);
});

test("lastFile: 記憶したファイル名・なし・読み取り失敗（理由つき）を返す", async () => {
  const h = fakeHandle({ a: 1 });
  const t = twice(h);
  assert.equal(await t.second().lastFile(), null);
  await t.first.choose();
  assert.deepEqual(await t.second().lastFile(), { name: "data.json" });
  const broken = createStore({ idb: { get: async () => { throw new Error("blocked"); }, set: async () => true } });
  assert.match((await broken.lastFile()).error, /blocked/);
});

test("choose: 記憶に失敗したことを rememberFailed で知らせる（読み込み自体は成功する）", async () => {
  const h = fakeHandle({ a: 1 });
  const s = createStore({ showOpenFilePicker: async () => [h], idb: { get: async () => undefined, set: async () => false } });
  assert.deepEqual(await s.choose(), { a: 1 });
  assert.equal(s.rememberFailed, true);
  assert.equal(mk(fakeHandle({})).rememberFailed, false);
});

test("save: 成功すると書き込まれ、続けて保存もできる", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.choose();
  assert.deepEqual(await s.save({ a: 2 }), { ok: true });
  assert.deepEqual(await s.save({ a: 3 }), { ok: true });
  assert.equal(JSON.parse(h.text).a, 3);
  assert.equal(h.writes, 2);
});

test("save: 読込後にファイルが更新されていたら conflict で、書き込まない", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.choose();
  h.modified += 5;
  const r = await s.save({ a: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "conflict");
  assert.equal(h.writes, 0);
  assert.equal(JSON.parse(h.text).a, 1);
});

test("reload: 最新を読み直すと、その後の保存が通る", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.choose();
  h.modified += 5;
  await s.reload();
  assert.deepEqual(await s.save({ a: 2 }), { ok: true });
});

test("save: 書き込みの例外は error（message つき）、権限拒否は denied", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.choose();
  h.failWrite = new Error("disk full");
  const r = await s.save({ a: 2 });
  assert.deepEqual([r.ok, r.reason], [false, "error"]);
  assert.match(r.message, /disk full/);
  h.failWrite = Object.assign(new Error("x"), { name: "NotAllowedError" });
  assert.equal((await s.save({ a: 2 })).reason, "denied");
});

test("open: JSON が壊れていれば例外", async () => {
  const h = fakeHandle({}); h.text = "{ broken";
  await assert.rejects(mk(h).choose());
});

test("saveMerged: 競合がなければ、そのまま 1 回で保存する", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.choose();
  const r = await s.saveMerged((d) => ({ ...d, a: 2 }), { a: 2 });
  assert.deepEqual([r.ok, r.data], [true, { a: 2 }]);
  assert.equal(JSON.parse(h.text).a, 2);
  assert.equal(h.writes, 1);
});

test("saveMerged: 読込のあとに他がファイルを更新していたら、最新のファイルに同じ編集を当てて保存し、他の更新も消さない", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.choose();
  h.text = JSON.stringify({ a: 1, inbox: "他が書いた" }); h.modified += 5;
  const r = await s.saveMerged((d) => ({ ...d, a: 2 }), { a: 2 });
  assert.deepEqual([r.ok, r.data], [true, { a: 2, inbox: "他が書いた" }]);
  assert.deepEqual(JSON.parse(h.text), { a: 2, inbox: "他が書いた" });
  assert.deepEqual(await s.save({ a: 3, inbox: "他が書いた" }), { ok: true }, "その後の保存も通る");
});

test("saveMerged: 最新のデータに編集を当てると例外のときは、保存せず error。競合が続くときは、再試行は 1 回だけで conflict", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.choose();
  h.text = JSON.stringify({ a: 1, gone: true }); h.modified += 5;
  const bad = await s.saveMerged(() => { throw new Error("もう当てられません"); }, { a: 2 });
  assert.deepEqual([bad.ok, bad.reason, bad.message], [false, "conflict", "もう当てられません"]);
  assert.equal(h.writes, 0);
  const d = fakeHandle({ a: 1 });
  const s2 = mk(d);
  await s2.choose();
  const getFile = d.getFile;
  d.getFile = async () => { d.modified += 1; return getFile.call(d); }; // 読むたびに更新されている
  const r = await s2.saveMerged((x) => ({ ...x, a: 2 }), { a: 2 });
  assert.deepEqual([r.ok, r.reason], [false, "conflict"]);
  assert.equal(d.writes, 0);
});

test("peek: ファイルの最新を読むだけで、読込時点（保存の競合の判定）は変えない", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.choose();
  h.text = JSON.stringify({ a: 1, inbox: "他が書いた" }); h.modified += 5;
  assert.deepEqual(await s.peek(), { a: 1, inbox: "他が書いた" });
  const r = await s.save({ a: 2 });
  assert.deepEqual([r.ok, r.reason], [false, "conflict"], "peek では、読み込んだことにならない");
});

test("saveMerged: 当て直しに失敗しても、読み込み時点は進めない。次の保存は、古いデータで他の更新を上書きせず、競合になる", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.choose();
  h.text = JSON.stringify({ a: 1, claude: "applied" }); h.modified += 5; // 他の更新
  const bad = await s.saveMerged(() => { throw new Error("すでに処理されています"); }, { a: 2 });
  assert.equal(bad.ok, false);
  const next = await s.save({ a: 3 }); // 画面は、まだ古いデータのまま、もう一度保存しようとする
  assert.deepEqual([next.ok, next.reason], [false, "conflict"]);
  assert.deepEqual(JSON.parse(h.text), { a: 1, claude: "applied" }, "他の更新は消えない");
  assert.equal(h.writes, 0);
});

test("saveMerged: 当て直しの保存が失敗したら、読み込み時点を戻す（次の保存が、他の更新を古いデータで上書きしない）", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.choose();
  h.text = JSON.stringify({ a: 1, inbox: "他が書いた" }); h.modified += 5;
  h.failWrite = new Error("disk error");
  const r = await s.saveMerged((d) => ({ ...d, a: 2 }), { a: 2 });
  assert.equal(r.ok, false);
  h.failWrite = null;
  const next = await s.save({ a: 3 }); // 画面の古いデータ（他の更新を持たない）
  assert.deepEqual([next.ok, next.reason], [false, "conflict"]);
  assert.deepEqual(JSON.parse(h.text), { a: 1, inbox: "他が書いた" }, "他の更新が残る");
});
