---
name: doctor
description: project-board が動く環境かを診断し、足りないものと対処の手順を出す。別の PC で使い始めるときや、動かないときに使う。何も変更しない。Excel の取り込みそのもの（/project-board:intake）や、予定表の MCP の指定（/project-board:mcp）には使わない
allowed-tools: 'Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" --data "${CLAUDE_PLUGIN_DATA}")'
disable-model-invocation: true
---

project-board が動く環境かを診断します。診断だけで、何も変更しません。祝日一覧（内閣府）への接続は試しますが、こちらのデータは何も送りません。

1. 次のコマンドを実行する。終了コード 3 は「必須の項目に要対処がある」で、失敗ではない。出力をそのまま読む。
   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" --data "${CLAUDE_PLUGIN_DATA}"
   ```
   起動コマンド `node` が見つからないとき、または構文エラーで起動に失敗するときは、Node.js 24 以上が入っていない。`winget install OpenJS.NodeJS.LTS` を案内し、ターミナルを開き直してからもう一度実行してもらう。
2. 結果を、項目ごとに伝える。
   - `[OK]`: 一言で済ませる。
   - `[要対処]`: 必須の項目。動かないので、「→」の対処を番号つきの手順で、コマンドをそのまま写して伝える。
   - `[任意]`: Excel の取り込みと予定表の取り込みを使うときだけ必要。使うかを聞き、使うなら「→」の手順を伝える。使わないなら、触れずに終える。
3. 対処のコマンドは、利用者が頼むまで実行しない。`winget`・`ensurepip`・`setup --yes` は、環境を変えるため。実行を頼まれたら、1 つずつ実行して結果を伝える。`xlsx.js setup` は、`--yes` なしの出力（入れ先と内容）を見せて、入れ先（専用の venv が推奨。システムは版の衝突に注意）を選んで承認を得てから、`--yes`（システムに入れるときは `--system --yes`）を付けて実行する。
4. 対処のあとは、手順の最後の「もう一度 doctor を実行する」のとおり、この `/project-board:doctor` をもう一度実行して、`[要対処]` が無くなったことを確かめる。
