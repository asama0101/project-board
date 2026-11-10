// 使い方: node tools/mcpconf.js --data <保存先フォルダ> show | set calendar key=value ... | clear calendar
// 予定表の MCP の指定を、保存先フォルダ（${CLAUDE_PLUGIN_DATA}）の project-board-mcp.json に読み書きする。
// 保存先は、環境変数 PROJECT_BOARD_HOME が最優先、次に --data <保存先フォルダ>。どちらもなければ終了コード 2。
import { readMcpConfig, setMcpRole, clearMcpRole, ROLES } from "../src/import/mcpconf.js";
import { takeData, pickHome, NO_HOME_MESSAGE } from "./home.js";

const { data, rest } = takeData(process.argv.slice(2));
const COMMANDS = ["show", "set", "clear"];
const dir = pickHome(data);
const [cmd, role, ...pairs] = rest;
const usage = () => {
  console.error("使い方: node tools/mcpconf.js --data <保存先フォルダ> show | set calendar key=value ... | clear calendar\n  calendar: server・listTool（必須）、selfEmails・selfNames・roomKeywords（任意。カンマ区切り。空にすると消える）");
  process.exit(2);
};
if (!COMMANDS.includes(cmd)) usage();
if (!dir) { console.error(NO_HOME_MESSAGE); process.exit(2); }

try {
  if (cmd === "show") {
    const config = readMcpConfig(dir);
    console.log(JSON.stringify({ configured: { calendar: !!config.calendar }, config }, null, 2));
  } else {
    if (!ROLES[role]) throw new Error(`不明な役割です: ${role ?? ""}（calendar のみ）`);
    if (cmd === "set") {
      const values = {};
      for (const p of pairs) {
        const i = p.indexOf("=");
        if (i < 1) throw new Error(`key=value の形で指定してください: ${p}`);
        values[p.slice(0, i)] = p.slice(i + 1);
      }
      console.log(JSON.stringify(setMcpRole(dir, role, values), null, 2));
    } else {
      console.log(JSON.stringify(clearMcpRole(dir, role), null, 2));
    }
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
