---
name: init
description: project-board のセットアップ。作業フォルダに、ダッシュボード(project-board.html)とデータ(.project-board/data.json)を用意する。何度実行しても既存のデータは変えない。データの取り込みや日程の変更には使わない（取り込みは /project-board:intake、日程の変更は HTML の「Claude Code に依頼する」）
argument-hint: "[--sample]"
allowed-tools: 'Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/init.js") Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/init.js" --sample)'
disable-model-invocation: true
---

project-board のセットアップを行います。次のコマンドを実行してください。

```
node "${CLAUDE_PLUGIN_ROOT}/tools/init.js"
```

- 利用者が `--sample` を付けたときだけ、代わりに次を実行してください。空のデータの代わりに架空のサンプルデータが入ります(試用向け)。

  ```
  node "${CLAUDE_PLUGIN_ROOT}/tools/init.js" --sample
  ```
- この 2 つ以外の引数は渡さないでください。
- 終了コードが 0 以外のときは、出力に書かれた理由をそのまま利用者に伝え、ファイルを作り直したり上書きしたりしないでください。

成功したら、作成・更新されたファイルを短く伝え、次の手順を案内してください。

1. ブラウザ(Edge または Chrome)で、プロジェクト直下の `project-board.html` を開く。
2. 「ファイルを開く」で `.project-board/data.json` を選ぶ。
