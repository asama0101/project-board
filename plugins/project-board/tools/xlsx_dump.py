# -*- coding: utf-8 -*-
"""使い方: python xlsx_dump.py <file.xlsx>

xlsx の全シートを JSON（UTF-8）で標準出力へ出す。
  {"sheets": [{"name": str, "rows": [[セル, ...], ...], "indents": [int, ...], "truncated": bool, "hidden": bool,
                "hiddenRows": int, "hiddenColumns": int}]}
- 結合セルは、左上の値を結合範囲のすべてのセルへ展開する（上位項目が縦に結合された WBS を読むため）
- 日付は YYYY-MM-DD（時刻があれば YYYY-MM-DDTHH:MM）。整数に見える数値は整数にする
- 文字列は前後の空白（全角を含む）を除き、空は null
- indents は行ごとのインデント量（各行の最初の値のあるセルの、先頭の空白の数と Excel のインデント設定の大きい方）。
  インデントで階層を表す WBS を読むために出す（文字列からは先頭の空白を除くため）
- 非表示の行・列は読み取らず（列は詰める）、除いた数を hiddenRows・hiddenColumns に出す
- 1 シート最大 2000 行（超えたら truncated: true）。読む範囲は 5000 行 × 200 列まで（シートの範囲がそれより広いときも truncated: true）
"""
import datetime
import json
import sys
import zipfile

from openpyxl import load_workbook
from openpyxl.utils import column_index_from_string

MAX_ROWS = 2000
# 読む範囲の上限。遠い隅にセルが 1 つあるだけで、範囲が A1:XFD1048576 まで広がり、読み込みが終わらなくなるのを防ぐ（非表示の行・空行を飛ばす余裕を見て、MAX_ROWS より大きくする）
SCAN_ROWS = 5000
SCAN_COLS = 200
# 展開後の合計サイズの上限。openpyxl は読む範囲を絞る前にシート全体をメモリへ読むため、圧縮率の極端なファイル（巨大なシートを小さく固めたもの）を先に断る
MAX_UNZIPPED = 300 * 1024 * 1024


def cell_value(v):
    if isinstance(v, datetime.datetime):
        if (v.hour, v.minute, v.second) == (0, 0, 0):
            return v.strftime("%Y-%m-%d")
        return v.strftime("%Y-%m-%dT%H:%M")
    if isinstance(v, datetime.date):
        return v.isoformat()
    if isinstance(v, datetime.time):
        return v.strftime("%H:%M")
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def leading_ws(v):
    return len(v) - len(v.lstrip()) if isinstance(v, str) else 0


def hidden_columns(ws):
    cols = set()
    for key, d in ws.column_dimensions.items():
        if d.hidden:
            lo = d.min or column_index_from_string(key)
            hi = d.max or lo
            cols.update(range(lo, hi + 1))
    return cols


def sheet_rows(ws):
    grid = [list(r) for r in ws.iter_rows(max_row=min(ws.max_row, SCAN_ROWS), max_col=min(ws.max_column, SCAN_COLS), values_only=True)]
    for rng in ws.merged_cells.ranges:
        top = grid[rng.min_row - 1][rng.min_col - 1] if rng.min_row <= len(grid) and rng.min_col <= len(grid[rng.min_row - 1]) else None
        for r in range(rng.min_row - 1, min(rng.max_row, len(grid))):
            for c in range(rng.min_col - 1, min(rng.max_col, len(grid[r]))):
                grid[r][c] = top
    # 非表示の行・列を除く（結合セルの展開のあとで除く）。元の行・列の位置は、インデントの取得に使う
    hidden_rows = {i for i, d in ws.row_dimensions.items() if d.hidden}
    hidden_cols = hidden_columns(ws)
    kept = []
    for r, row in enumerate(grid, start=1):
        if r in hidden_rows:
            continue
        kept.append((r, [(c, cell_value(v), v) for c, v in enumerate(row, start=1) if c not in hidden_cols]))
    while kept and all(v is None for _, cells in kept[-1:] for _, v, _ in cells):
        kept.pop()
    rows, indents = [], []
    for r, cells in kept:
        values = [v for _, v, _ in cells]
        rows.append(values)
        first = next((k for k, v in enumerate(values) if v is not None), None)
        if first is None:
            indents.append(0)
            continue
        col, _, raw = cells[first]
        excel = int(ws.cell(row=r, column=col).alignment.indent or 0)
        indents.append(max(leading_ws(raw), excel))
    truncated = len(rows) > MAX_ROWS or ws.max_row > SCAN_ROWS or ws.max_column > SCAN_COLS
    return rows[:MAX_ROWS], indents[:MAX_ROWS], truncated, len([r for r in hidden_rows if r <= len(grid)]), len([c for c in hidden_cols if c <= max((len(r) for r in grid), default=0)])


def main(path):
    sys.stdout.reconfigure(encoding="utf-8")
    with zipfile.ZipFile(path) as z:
        if sum(i.file_size for i in z.infolist()) > MAX_UNZIPPED:
            raise ValueError("展開後のサイズが 300MB を超えます。シートを減らすか、必要な範囲だけを別のファイルに保存してください")
    wb = load_workbook(path, data_only=True)
    sheets = []
    for ws in wb.worksheets:
        rows, indents, truncated, hidden_r, hidden_c = sheet_rows(ws)
        sheets.append({"name": ws.title, "rows": rows, "indents": indents, "truncated": truncated, "hidden": ws.sheet_state != "visible", "hiddenRows": hidden_r, "hiddenColumns": hidden_c})
    json.dump({"sheets": sheets}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main(sys.argv[1])
    except Exception as e:  # 壊れたファイルなど。理由を標準エラーへ出して終了コード 1
        sys.stderr.write(f"読み取れません: {e}\n")
        sys.exit(1)
