import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../plugins/project-board/src/ui/store.js";
import { createSync } from "../plugins/project-board/src/ui/sync.js";

// 偽のファイルハンドル（store.test.js と同じ。File System Access API の必要部分だけ）
function fakeHandle(initial) {
  const h = {
    name: "data.json", text: JSON.stringify(initial), modified: 1000,
    async getFile() { return { lastModified: h.modified, text: async () => h.text }; },
    async createWritable() {
      let buf = "";
      return { write: async (s) => { buf += s; }, close: async () => { h.text = buf; h.modified += 1; } };
    },
    async queryPermission() { return "granted"; },
    async requestPermission() { return "granted"; },
  };
  return h;
}
const memIdb = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); } }; };
const base = () => ({ projects: [], tasks: [{ id: "A1", title: "a" }], events: [], changeLog: [], inbox: { watching: null, requests: [] } });

/** 画面の代わり: データの入れ物と、描画・通知の呼ばれた回数 */
async function setup(initial = base()) {
  const h = fakeHandle(initial);
  const store = createStore({ showOpenFilePicker: async () => [h], idb: memIdb() });
  const ui = { data: await store.choose(), render: 0, renderBar: 0, banner: [], toast: [] };
  const sync = createSync({
    store, getData: () => ui.data, setData: (d) => { ui.data = d; },
    render: () => { ui.render++; }, renderBar: () => { ui.renderBar++; }, banner: (m) => ui.banner.push(m), toast: (m) => ui.toast.push(m),
    visible: () => true, wantFast: () => false,
  });
  return { h, store, ui, sync };
}
/** 他（Claude Code）がファイルを更新した */
const external = (h, patch) => { h.text = JSON.stringify({ ...JSON.parse(h.text), ...patch }); h.modified += 1; };
const rename = (title) => (d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === "A1" ? { ...t, title } : t)) });

test("persist: 保存の前に他がファイルを更新していても、最新のファイルに同じ編集を当てて保存し、他の更新も画面の編集も消えない", async () => {
  const { h, ui, sync } = await setup();
  external(h, { inbox: { watching: null, requests: [{ id: "R1", status: "proposed" }] } });
  const edit = rename("b");
  ui.data = edit(ui.data);
  sync.persist(edit);
  await sync.whenIdle();
  const saved = JSON.parse(h.text);
  assert.equal(saved.tasks[0].title, "b", "画面の編集が保存されている");
  assert.equal(saved.inbox.requests[0]?.id, "R1", "他の更新が消えていない");
  assert.equal(ui.data.inbox.requests[0]?.id, "R1", "当て直した結果が画面にも出る");
  assert.equal(sync.failed, false);
  assert.deepEqual(ui.banner, []);
});

test("pollInbox: 保存していない編集がある間は読み直さず、編集が無ければ他の更新を取り込む（受信箱だけの変化は帯だけ描き直す）", async () => {
  const { h, ui, sync } = await setup();
  const edit = rename("c");
  ui.data = edit(ui.data);
  sync.persist(edit);
  external(h, { tasks: [{ id: "A1", title: "x" }] }); // 保存が済む前に他が書いた（当て直しの対象）
  sync.pollInbox(true); // 保存が並んでいる間は、読み直しを積まない
  await sync.whenIdle();
  assert.equal(JSON.parse(h.text).tasks[0].title, "c", "画面の編集が、古い内容で上書きされない");
  assert.equal(ui.data.tasks[0].title, "c");
  assert.equal(ui.renderBar, 0, "保存が並んでいる間の pollInbox は、読み直しを積まない（積むと帯が描き直される）");

  const renders = ui.render;
  external(h, { inbox: { watching: { at: "2026-10-31T00:00:00Z" }, requests: [] } });
  sync.pollInbox(true);
  await sync.whenIdle();
  assert.equal(ui.data.inbox.watching.at, "2026-10-31T00:00:00Z", "他の更新を取り込む");
  assert.equal(ui.render, renders, "受信箱だけの変化では画面全体を描き直さない");
  assert.ok(ui.renderBar >= 1);
});
