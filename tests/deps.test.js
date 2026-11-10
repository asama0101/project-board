import { test } from "node:test";
import assert from "node:assert/strict";
import { depPath, depMarkup, focusDeps } from "../plugins/project-board/src/ui/deps.js";

test("depPath: 先行の右端から後続の左端へ、折れ線の path を返す", () => {
  assert.equal(depPath({ right: 200, y: 17 }, { left: 362, y: 85 }), "M200,17 H212 V85 H361");
});

test("depPath: 後続の左端が先行の右端と同じ位置のとき、手前（left - 8）で折れる", () => {
  assert.equal(depPath({ right: 250, y: 17 }, { left: 250, y: 51 }), "M250,17 H242 V51 H249");
});

test("depMarkup: タスク ID の引用符・山括弧を HTML のエスケープにして、属性を壊さない", () => {
  const html = depMarkup({ from: 'f"><b>', to: 'x"><img src=x onerror=alert(1)>', d: "M1,2 H3", left: 10, y: 5 });
  assert.doesNotMatch(html, /"><img|"><b>/);
  assert.match(html, /data-from="f&quot;&gt;&lt;b&gt;"/);
  assert.match(html, /data-to="x&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;"/);
  assert.match(html, /<path d="M1,2 H3"\/>/);
  assert.match(html, /<polygon points="9,5 4,1\.5 4,8\.5"\/>/);
});

// focusDeps は DOM を使うので、classList と querySelectorAll だけの簡易の要素で確かめる
const fakeEl = (attrs = {}) => { const c = new Set(); return { dataset: attrs, classList: { add: (...n) => n.forEach((x) => c.add(x)), remove: (...n) => n.forEach((x) => c.delete(x)), has: (x) => c.has(x) } }; };
const fakeBody = (bars, lines = []) => { const b = fakeEl(); b.querySelectorAll = (sel) => (sel === "[data-gt]" ? bars : sel === ".gdep" ? lines : [...bars, ...lines]); return b; };

test("focusDeps: 前のタスクも次のタスクもないバーでも、マウスを置いたバー自身は光る。ほかは薄くしない", () => {
  const solo = fakeEl({ gt: "S1" }), other = fakeEl({ gt: "S2" });
  const body = fakeBody([solo, other]);
  focusDeps(body, "S1");
  assert.ok(solo.classList.has("dep-self"));
  assert.ok(!body.classList.has("dep-focus"), "全体を薄くしない");
  assert.ok(!other.classList.has("dep-self"));
  focusDeps(body, null);
  assert.ok(!solo.classList.has("dep-self"), "離したら戻る");
});

test("focusDeps: 前のタスク・次のタスクがあるバーは、自身・前・次を色分けして、ほかを薄くする", () => {
  const a = fakeEl({ gt: "A1" }), b = fakeEl({ gt: "A2", pre: "A1" }), c = fakeEl({ gt: "A3", pre: "A2" });
  const body = fakeBody([a, b, c]);
  focusDeps(body, "A2");
  assert.ok(b.classList.has("dep-self") && a.classList.has("dep-pre") && c.classList.has("dep-next") && body.classList.has("dep-focus"));
});
