import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../plugins/project-board/tools/build.js";

test("build: 1 ファイルにまとまり、import/export・外部 URL・外部スクリプトが残らない", () => {
  const dir = mkdtempSync(join(tmpdir(), "nwdash-build-"));
  try {
    const out = join(dir, "dashboard.html");
    build(out);
    const html = readFileSync(out, "utf8");
    assert.ok(html.includes("<title>"));
    assert.doesNotMatch(html, /^\s*(import|export)\s/m);
    assert.doesNotMatch(html, /<script[^>]*\ssrc=/i);
    assert.doesNotMatch(html, /https?:\/\//i);
    assert.doesNotMatch(html, /<link[^>]+href=/i);
    assert.doesNotMatch(html, /__(CSS|JS)__/);
    // 構文が正しい（実行はしない）
    const js = /<script>([\s\S]*)<\/script>/.exec(html)[1];
    assert.doesNotThrow(() => new Function(js));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wrapModule: 対応しない import/export の形や、先に並んでいない名前の import は例外にする", async () => {
  const { wrapModule } = await import("../plugins/project-board/tools/build.js");
  const known = new Set(["a"]);
  assert.doesNotThrow(() => wrapModule("x.js", 'import { a } from "./a.js";\nexport const b = a;', new Set(known)));
  for (const bad of ['import "./side.js";', "export { a };", "export default 1;", "export const { p, q } = o;", 'import * as ns from "./a.js";', 'import { a as z } from "./a.js";', 'import { nope } from "./a.js";', "export const a = 1;"]) {
    assert.throws(() => wrapModule("x.js", bad, new Set(known)), undefined, bad);
  }
});
