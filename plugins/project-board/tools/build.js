// 使い方: node tools/build.js [出力先]   （既定: assets/project-board.html）
// src の ES モジュールを 1 つの HTML にまとめる。file:// では ES module を読み込めないため、
// 各モジュールを関数スコープで包み、import を取り除き、export した名前だけを外側へ渡す。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 依存の順（先に並べたモジュールの export は、後ろのモジュールから使える）
export const MODULES = [
  "src/core/dates.js",
  "src/core/holidays.js",
  "src/core/schema.js",
  "src/core/checklist.js",
  "src/core/metrics.js",
  "src/core/sessions.js",
  "src/core/impact.js",
  "src/core/rules.js",
  "src/core/schedule.js",
  "src/core/workload.js",
  "src/core/groups.js",
  "src/core/inbox.js",
  "src/ui/store.js",
  "src/ui/sync.js",
  "src/ui/prefs.js",
  "src/ui/common.js",
  "src/ui/deps.js",
  "src/ui/edit.js",
  "src/ui/donecheck.js",
  "src/ui/inboxops.js",
  "src/ui/views/prio.js",
  "src/ui/views/gantt.js",
  "src/ui/views/schedule.js",
  "src/ui/views/workload.js",
  "src/ui/views/settings.js",
  "src/ui/views/inboxpanel.js",
  "src/ui/views/checklist.js",
  "src/ui/views/taskpop.js",
  "src/ui/views/project.js",
  "src/ui/sticky.js",
  "src/ui/app.js",
];

const EXPORT_RE = /^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;
const IMPORT_RE = /^import\s[\s\S]*?\sfrom\s+["'][^"']+["'];?[ \t]*$/gm;
const NAMED_IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*["'][^"']+["'];?/gm;

// 構文は正しいのに、まとめたあと実行時にだけ壊れる記法。見つけたらビルドを止める
const UNSUPPORTED = [
  [/^import\s+["']/m, "副作用だけの import"],
  [/^export\s*\{/m, "export { ... }"],
  [/^export\s+default/m, "export default"],
  [/^export\s+(?:var|const\s*[{[])/m, "export var / 分割代入の export"],
  [/^import\s+\*/m, "import * as"],
  [/^import\s*\{[^}]*\bas\b[^}]*\}/m, "import { a as b }"],
];

/**
 * 1 モジュールを関数スコープで包む。対応しない記法と、先に並んでいない名前の import は例外にする
 * （実行時まで壊れに気づけないため）。known は先に並んだモジュールが export した名前の集合で、ここに今回の export を足す
 */
export function wrapModule(path, src, known) {
  for (const [re, what] of UNSUPPORTED) {
    if (re.test(src)) throw new Error(`${path}: ビルドが対応しない記法です（${what}）`);
  }
  for (const m of src.matchAll(NAMED_IMPORT_RE)) {
    for (const name of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
      if (!known.has(name)) throw new Error(`${path}: import した ${name} が、先に並んだモジュールの export にありません（MODULES の順序を確認）`);
    }
  }
  const names = [...src.matchAll(EXPORT_RE)].map((m) => m[1]);
  for (const n of names) {
    if (known.has(n)) throw new Error(`${path}: export 名 ${n} が他のモジュールと重複しています`);
    known.add(n);
  }
  const body = src.replace(IMPORT_RE, "").replace(/^export\s+/gm, "");
  const head = names.length ? `const { ${names.join(", ")} } = ` : "";
  return `/* ${path} */\n${head}(() => {\n${body}\n${names.length ? `return { ${names.join(", ")} };` : ""}\n})();`;
}

export function build(out = resolve(ROOT, "assets/project-board.html"), root = ROOT) {
  const read = (p) => readFileSync(resolve(root, p), "utf8").replace(/\r\n/g, "\n"); // autocrlf の clone でも同じ出力にする
  const known = new Set();
  const js = MODULES.map((p) => wrapModule(p, read(p), known)).join("\n\n").replace(/<\/script/gi, "<\\/script");
  const html = read("src/ui/index.html")
    .replace("/*__CSS__*/", () => read("src/ui/theme.css"))
    .replace("/*__JS__*/", () => js);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`出力しました: ${build(process.argv[2] ? resolve(process.argv[2]) : undefined)}`);
}
