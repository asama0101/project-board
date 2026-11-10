---
name: watch
description: HTML の「Claude Code に依頼する」から届く依頼を、見張って処理する。見張っている間、予定表の会議も最新に保つ。HTML に「Claude Code が見ています」と出る。「見張りをやめて」と言われたら止める。
allowed-tools: 'Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/inbox.js" wait *) Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/inbox.js" get *) Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/inbox.js" approve *) Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/inbox.js" reject *) Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/holidays.js" ensure *)'
disable-model-invocation: true
---

HTML の「Claude Code に依頼する」の受信箱を見張ります。依頼が届いたら、`project-board:inbox` エージェントで 1 件ずつ処理し、提案を作ります（承認は、HTML か、ここで「R3 を承認」と伝えたとき）。

データは `.project-board/data.json` です。見つからないときは、先に `/project-board:init` を実行するよう利用者に伝えてください。

## 手順
0. 祝日を更新します（営業日を使う提案で、土日に加えて飛ばす日になります。設定で土日祝を営業日に数えるときは、取得されません）。次を 1 回実行します。

   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/holidays.js" ensure ".project-board/data.json"
   ```

   未取得・取得から 30 日超・一覧の最終日が今日以前のときだけ、内閣府の一覧を取得します（出力の `fetched` が true）。失敗したとき（終了コード 1）は、理由を 1 行で伝えて、見張りは続けます。
1. Monitor ツールで、次のコマンドを起動します（標準出力の 1 行が、1 つのイベントになります）。`timeout_ms` は上限の 1800000（30 分）にします。

   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/inbox.js" wait ".project-board/data.json"
   ```

   Monitor が使えないときは、その旨を伝えて終わります（見張りなしで依頼を処理する入口はありません）。
1.5. 予定表を更新します（見張りは、もう始まっています）。`project-board:intake-calendar` エージェントに「`calendar（見張りから）`」を、**バックグラウンドで**頼みます（更新の間も、届いた依頼を処理できるように。MCP ツールなどの許可の確認が出たときは、答えるまで更新が待ちます）。エージェントの報告が届いたら、`blocked`・`warnings`・保留（`held`）も含めて、**そのまま利用者に伝えます**。予定表の MCP が未指定のとき、取得に失敗したときは、データは変わりません。どの場合も、見張りは続けます。
2. イベントの種類:
   - `{"event":"request","id":"R3",...}` — 依頼が届いた（新しい依頼、聞き返しへの返信、修正の依頼、もう一度の提案）。**`project-board:inbox` エージェントに、依頼 R3 の処理を頼みます**。複数届いたら、順に。
3. 見張っている間の約束:
   - **端末で質問して止まらない**（聞きたいことは `ask` で HTML に出す）。承認も待たない。
   - 利用者が端末で「R3 を承認」「R3 を却下」と伝えたら、自分で実行する: 承認は `get R3` で提案の中身（`sections`・`warnings`）を見せてから `approve R3`（HTML で先に承認・却下されていて失敗したら、その旨を伝える）、却下は `reject R3`。コマンドは `node "${CLAUDE_PLUGIN_ROOT}/tools/inbox.js" <コマンド> ".project-board/data.json" R3` の形。
4. 30 分で Monitor は終わります。終わったら（期限切れの通知が来たら）、**もう一度 手順 1 を実行して、続けて予定表の更新（手順 1.5）も行い、見張りを続けます**（予定表が古いままにならないため）。見張りを止めるのは、利用者が「見張りをやめて」と伝えたときです（下の「見張りを止めるとき」）。
5. 見張りの印（`inbox.watching.at`）は、`wait` コマンドが 30 秒ごとに書きます。Monitor が止まると、90 秒ほどで、HTML に「見ていません」と出ます。

## 見張りを止めるとき
利用者が「見張りをやめて」と伝えたら、次のとおりにします。データは変えません。

1. TaskList で、このセッションで動いている Monitor のうち、コマンドが `inbox.js wait` のものを探します。
2. 見つかったら TaskStop で止めます（複数あれば、すべて）。
3. 「見張りを止めました。HTML の帯は、90 秒ほどで『見ていません』になります。再開は `/project-board:watch`」と伝えます。
4. 見つからないときは、「このセッションでは見張りが動いていません」と伝えて終わります。別のセッションで動いている見張りは、そのセッションで止めます。

処理中の依頼と、承認待ちの提案は、そのまま残ります（次に `/project-board:watch` を始めたとき、`pending` の依頼が拾われます）。

見張りを始めたら、「見張りを始めました。HTML の『Claude Code に依頼する』から依頼できます」とだけ伝えてください。
