---
name: intake
description: Excel の WBS、予定表の会議、会議のプロジェクト規則を、プロジェクトのデータへ取り込む。変更案を見せて、承認後に書き込む（予定表の会議は承認の確認なしで更新する）。メール・議事録・メモの取り込みと、日程の変更は、HTML の「Claude Code に依頼する」で行う
argument-hint: "wbs <ファイル> | calendar | rules"
---

次の依頼を、エージェントで処理してください。`wbs`・`rules` は `project-board:intake`、`calendar` は `project-board:intake-calendar` です（予定表の件名は外の人が書くので、予定表だけを別のエージェントにして、Excel を読む側のツールを絞っています）。

依頼: $ARGUMENTS

依頼が空のときは、取り込みたいもの（`wbs <ファイル>`、`calendar`、`rules`）を利用者に聞いてください。メール・議事録・メモの本文は、HTML の「Claude Code に依頼する」に貼って頼むよう伝えてください。
データは `.project-board/data.json` です。見つからないときは、先に `/project-board:init` を実行するよう利用者に伝えてください。
`calendar` は、先に `/project-board:mcp` で予定表の MCP を指定しておく必要があります。
