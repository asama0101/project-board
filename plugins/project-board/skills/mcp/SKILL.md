---
name: mcp
description: 予定表の取り込みで使う MCP とツールを指定して保存する。接続中の MCP から候補を提案し、承認後に保存して、1件取得して動作を確認する。予定表以外の取り込みには使わない（/project-board:intake）
argument-hint: "[show | calendar]"
allowed-tools: 'Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/mcpconf.js" --data "${CLAUDE_PLUGIN_DATA}" show) Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/mcpconf.js" --data "${CLAUDE_PLUGIN_DATA}" set *) Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/mcpconf.js" --data "${CLAUDE_PLUGIN_DATA}" clear *)'
disable-model-invocation: true
---

予定表の取り込み（`/project-board:intake calendar`）で使う MCP の指定を管理します。MCP 自体は利用者が Claude Code に用意したものを使い、このプラグインには同梱しません。指定は `${CLAUDE_PLUGIN_DATA}` の `project-board-mcp.json` に保存し、プロジェクトの `data.json` には入れません。

引数: $ARGUMENTS

## 手順
1. **現状を表示する。** 次のコマンドを実行し、予定表用の指定の有無と内容を伝える。引数が空または `show` のときは、ここまでで終わる。
   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/mcpconf.js" --data "${CLAUDE_PLUGIN_DATA}" show
   ```
2. **候補を提案する。** 予定表（`calendar`）について、いま接続している MCP のツール一覧から候補を選ぶ。**サーバー名とツール名を明示して**示す。
   - `server`、`listTool`（期間を指定して予定を取得するツール）
   - 該当するツールが見つからないときは、見つからなかったと伝え、MCP の用意（`claude mcp add` など）を案内して終わる。推測で指定しない。
3. **承認を得て保存する。** 承認された内容を次のコマンドで保存する。
   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/mcpconf.js" --data "${CLAUDE_PLUGIN_DATA}" set calendar server=<サーバー名> listTool=<ツール名>
   ```
4. **自分のメールアドレス・名前と会議室の名前を聞いて保存する。** 手順 1 の表示で `selfEmails` か `selfNames` が保存済みなら、聞かずに保存済みの値を伝えて、手順 5 へ進む（変えたいと言われたときだけ聞き直す）。`selfEmails` だけが保存済みで `selfNames` がないときは、値を伝えるときに、「予定表がメールアドレスを表示名に置き換えて返す場合は、名前も保存できる」と一言添える。取り込みで、自分だけ・自分と会議室だけの予定（作業ブロックなど）を会議として取り込まないための設定。聞く内容は次の 3 つ。どれも答えは任意で、答えがなければ保存しない（自分のメールアドレスも名前も未設定のときは、何も除外されない）。
   - 自分のメールアドレス（複数可。予定表の参加者に載る形。例: 会社と個人のアドレス）。
   - 自分の名前（複数可。予定表が、メールアドレスを表示名に置き換えて返すときのため。予定表の参加者に載る形のとおりに、そのまま入れる。前後の空白と大文字小文字だけを区別しない完全一致。同じ表示名の別人がいると、その人を自分とみなして本物の会議を取り込まなくなる。同じ表示名の人に心当たりがないか、利用者に確かめる。ある場合は、その名前を入れず、メールアドレスだけにする。カンマ（,）を含む表示名（例: 「Yamada, Taro」）は、保存の区切りと同じなので、保存できない。その名前も入れず、メールアドレスだけにする）。
   - 会議室の名前に含まれる言葉（複数可）。MCP が会議室を `resource` 種別で返すときは不要。何も保存しないときは「会議室」が使われる。
   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/mcpconf.js" --data "${CLAUDE_PLUGIN_DATA}" set calendar selfEmails=<メール,メール> selfNames=<名前,名前> roomKeywords=<言葉,言葉>
   ```
   保存済みの `server`・`listTool` は、そのまま残る。項目を空（`selfEmails=`）にすると、その項目を消す。
5. **試しに取得して確認する。** 今日の予定を、指定したツールで取得する。使った MCP のサーバー名とツール名を添えて、取得できた件数と1件の件名を見せる。参加者（メールアドレス・表示名・人か会議室か）が取得できるかも伝える（取得できないと、自分だけの予定を除外できない）。`selfNames` が保存済み（今回保存した場合を含む）のときは、取得できた参加者の表示名を見せ、保存した名前と同じもの（前後の空白と大文字小文字を除いて同じ）があるかを、利用者に確かめてもらう。完全一致でないと、警告なしで除外されないため。同じものがない、または今日の予定に自分が載っておらず確かめられないときは、その旨を伝え、手順 4 に戻って名前を入れ直すかを聞く。入れ直すときは、手順 4 の「保存済みなら聞かない」にかかわらず、名前を聞き直す。失敗したら、理由を伝え、指定を残すか消す（`clear calendar`）かを聞く。

終わったら、`/project-board:intake calendar` で取り込めることを伝える。
