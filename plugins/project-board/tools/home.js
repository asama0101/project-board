// 置き場（${CLAUDE_PLUGIN_DATA}）の決め方を、xlsx.js と mcpconf.js で共有する。
// 優先順: 環境変数 PJ_LENS_HOME → 引数（--data <パス>）→ なし（呼び出し側が終了コード 2）。

/** `--data <パス>` を引数から取り除く。値が無ければ data は ""（未指定と同じ扱い） */
export function takeData(args) {
  const i = args.indexOf("--data");
  if (i < 0) return { data: null, rest: args };
  return { data: args[i + 1] ?? "", rest: args.filter((_, j) => j !== i && j !== i + 1) };
}

/** 置き場。環境変数が最優先、次に引数。どちらもなければ null */
export const pickHome = (arg, env = process.env) => env.PJ_LENS_HOME || arg || null;

export const NO_HOME_MESSAGE = "置き場が決まりません。環境変数 PJ_LENS_HOME を設定するか、--data \"${CLAUDE_PLUGIN_DATA}\" を付けてください（SKILL.md・agent の本文では ${CLAUDE_PLUGIN_DATA} が展開されます）。";
