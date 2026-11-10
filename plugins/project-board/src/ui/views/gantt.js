// ガントチャート。位置と幅はすべて範囲全体に対する % で表し、画面幅に追従させる。
import { addDays, diffDays } from "../../core/dates.js";
import { ganttRows, ganttLayout, timeTicks, projectProgress, projectFlags, taskFlags } from "../../core/metrics.js";
import { projectHours } from "../../core/workload.js";
import { restDayChecker } from "../../core/holidays.js";
import { groupSections } from "../../core/groups.js";
import { checklistCount } from "../../core/checklist.js";
import { esc, fmtMD, wdJa, STATUS_UI, flagPills, checkMeterHtml } from "../common.js";

const GANTT_WINDOWS = [["m1", "1か月"], ["m3", "3か月"], ["m6", "6か月"], ["y1", "1年"], ["all", "全期間"]];

const legend = (showActual) => `<div class="legend"><span><i class="gbar b-todo" style="position:static;display:inline-block;width:22px;height:10px"></i>To Do</span><span><i class="gbar b-prog" style="position:static;display:inline-block;width:22px;height:10px"></i>In Progress</span><span><i class="gbar b-wait" style="position:static;display:inline-block;width:22px;height:10px"></i>Waiting</span><span><i class="gbar b-done" style="position:static;display:inline-block;width:22px;height:10px"></i>Done</span><span><i class="gbar gsum" style="position:static;display:inline-block;width:22px;height:8px"></i>プロジェクト全体</span><span><i class="ms" style="position:static;display:inline-block;transform:rotate(45deg);width:9px;height:9px"></i>マイルストーン</span>${showActual ? `<span><i class="gact" style="position:static;display:inline-block;width:22px;height:5px"></i>実績(最初の作業日〜完了日・今日)</span>` : ""}<span><i class="imp-key hi"></i>重要度 高（行を薄い赤で塗る）</span><span>開始日は、未入力なら前のタスクの期限から</span></div>`;

function tools(win, hideDone) {
  const seg = GANTT_WINDOWS.map(([k, l]) => `<button data-gwin="${k}" aria-pressed="${win === k}">${l}</button>`).join("");
  return `<div class="gtools"><span class="note">表示期間</span><div class="seg" role="group" aria-label="表示期間">${seg}</div><button class="chip-btn" data-hidedone aria-pressed="${hideDone}">完了を隠す</button><button class="chip-btn" data-gotoday>今日へ移動</button></div>`;
}

/**
 * マイルストーンのラベルを、重ならない最初の段へ置く。items は日付順の { x: ラベルの左端, w: 幅 }。戻り値は、各ラベルの段（0 から）。
 */
export function assignLevels(items) {
  const ends = [];
  return items.map(({ x, w }) => {
    let level = ends.findIndex((e) => e <= x);
    if (level < 0) level = ends.length;
    ends[level] = x + w;
    return level;
  });
}

const msLaneHeight = (levels) => Math.max(44, (Math.max(-1, ...levels) + 1) * 18 + 8);

/**
 * 描いたあとに、マイルストーンのラベルの実際の幅を測って、段と行の高さを決め直す（画面幅・表示期間で、重なりが変わるため）。
 */
export function layoutMilestones(gbodies) {
  // 測ると書くを混ぜると、そのたびにレイアウトが走る。先に全部を測り、そのあとで全部を書く（deps.js と同じ）
  const plans = [];
  for (const gb of gbodies) {
    const lane = gb.querySelector(".g-msrow .g-lane");
    if (!lane || !lane.offsetWidth) continue; // 隠れている（幅 0）ときは、測れないので触らない
    const marks = [...lane.querySelectorAll(".ms")];
    const labels = [...lane.querySelectorAll(".ms-l")];
    const levels = assignLevels(labels.map((l) => ({ x: l.offsetLeft, w: l.offsetWidth + 10 + 8 }))); // 10px はラベルの右ずらし、8px はラベルの間の隙間
    plans.push({ lane, marks, labels, levels });
  }
  for (const { lane, marks, labels, levels } of plans) {
    levels.forEach((lv, i) => { marks[i].style.top = `${6 + lv * 18}px`; labels[i].style.top = `${2 + lv * 18}px`; });
    lane.style.height = `${msLaneHeight(levels)}px`;
  }
}

/**
 * @param opts.window    "m1" | "m3" | "m6" | "y1" | "all"
 * @param opts.hideDone  Done の行を隠す（全体バーの進捗には影響しない）
 * @param opts.askDel    削除確認を出すタスク ID
 * @param opts.showActual false なら実績の線と凡例を出さない
 * @param opts.addAt     名前入力を開いている見出し { pid, group, subgroup }（なければ null）
 */
export function renderGantt(data, projectIds, today, opts = {}) {
  const { window: win = "m6", hideDone = false, askDel = null, showActual = true, addAt = null } = opts;
  const all = projectIds.map((id) => data.projects.find((p) => p.id === id));
  // 完了を隠すは、複数のプロジェクトを出しているとき、完了したプロジェクト（状態が「完了」、またはタスクが 1 件以上あって全部 Done）も隠す。1 つを選んでいるときは隠さない
  const closed = (p) => { const ts = data.tasks.filter((t) => t.projectId === p.id); return p.status === "完了" || (ts.length > 0 && ts.every((t) => t.status === "Done")); };
  const ps = hideDone && all.length > 1 ? all.filter((p) => !closed(p)) : all;
  // 編集画面は、道具と凡例を上端の固定の帯に置く（タスクが多くても、スクロール中に色の意味を見失わない）
  const top = `<div class="gtop">${tools(win, hideDone)}${legend(showActual)}</div>`;
  if (!ps.length) return `${top}<p class="muted">完了したプロジェクトを隠しています。「完了を隠す」を押すと、また出ます。</p>`;

  const geo = new Map(ps.map((p) => [p.id, ganttRows(data, p.id, today)]));
  const starts = [...geo.values()].map((g) => g.range.start);
  const ends = [...geo.values()].map((g) => g.range.end);
  const s0 = [addDays(today, -10), ...starts].reduce((a, b) => (a < b ? a : b));
  const e0 = [addDays(today, 14), ...ends].reduce((a, b) => (a > b ? a : b));
  const range = { start: s0, end: e0 };
  const total = diffDays(e0, s0) + 1;
  const { visibleDays, ratio, scale } = ganttLayout(range, win);
  const dayScale = scale === "day";
  const x = (d) => `${((diffDays(d, s0) / total) * 100).toFixed(3)}%`;
  const ticks = timeTicks(range, scale);
  const rest = restDayChecker(data.settings);
  const laneW = `calc((100cqw - var(--lw) - 12px) * ${ratio.toFixed(4)})`;
  const laneStyle = `style="width:var(--lanew)"`;

  const axis = ticks
    .filter((t) => dayScale || Math.abs(diffDays(t.date, today)) > visibleDays * 0.045)
    .map((t) => `<span class="mono ${t.yearStart ? "yr" : ""} ${dayScale && t.date === today ? "tdy" : ""}" data-tick="${t.date}" style="left:${x(t.date)}">${esc(t.label)}${dayScale ? `<small>${wdJa(t.date)}</small>` : ""}</span>`)
    .join("");
  const grid = (dayScale ? ticks.filter((t) => rest(t.date)).map((t) => `<i class="gwk" style="left:${x(t.date)};width:${(100 / total).toFixed(3)}%"></i>`).join("") : "")
    + ticks.map((t) => `<i class="gl ${t.yearStart ? "yr" : ""}" style="left:${x(t.date)}"></i>`).join("");
  const todayLine = `<span class="todayline" style="left:${x(today)}"></span>`;

  const scrollAttrs = ` data-todayfrac="${(diffDays(today, s0) / total).toFixed(5)}" data-s0="${s0}" data-span="${total}"`; // 全プロジェクト共通(ドラッグ・今日へ移動が .gscroll から読む)
  const sections = ps.map((p) => {
    const g = geo.get(p.id);
    const prog = projectProgress(data, p.id);
    const hh = projectHours(data, p.id);
    const pct = Math.round(prog.rate * 100);
    const flags = projectFlags(data, p.id, today);
    const ms = g.milestones;
    const msLines = ms.map((m) => `<i class="msl" style="left:${x(m.date)}"></i>`).join("");

    // 段は、画面幅を 1000px と仮定した見積もり。画面では、描いたあとに layoutMilestones が実測で決め直す
    const pxPerDay = 1000 / visibleDays;
    const levels = assignLevels(ms.map((m) => ({ x: diffDays(m.date, s0) * pxPerDay, w: [...m.name].reduce((n, c) => n + (c.charCodeAt(0) < 256 ? 6 : 11), 0) + 40 + 18 })));
    const msItems = ms.map((m, i) => {
      const level = levels[i];
      const idx = (p.milestones ?? []).findIndex((o) => o.name === m.name && o.date === m.date);
      const attr = ` data-gms="${esc(p.id)}|${idx}"`;
      return `<i class="ms"${attr} style="left:${x(m.date)};top:${6 + level * 18}px" title="${esc(m.name)} ${fmtMD(m.date)}(ドラッグで日付を変更)"></i><span class="ms-l" style="left:${x(m.date)};top:${2 + level * 18}px">${esc(m.name)} <b class="mono">${fmtMD(m.date)}</b></span>`;
    }).join("");
    const msRow = ms.length
      ? `<div class="g-row g-msrow"><div class="g-label"><span class="id"></span><span class="muted">マイルストーン</span></div><div class="g-lane" style="width:var(--lanew);height:${msLaneHeight(levels)}px">${msItems}</div></div>`
      : "";

    const months = Math.max(1, Math.round(diffDays(p.due, p.start) / 30.4));
    const head = `<div class="pg-head"><div><button class="proj-name" data-filter="${esc(p.id)}">${esc(p.name)}</button><div class="proj-meta"><span>${esc(p.type)}</span><span>${esc(p.status)}</span><span class="mono">${fmtMD(p.start)}〜${fmtMD(p.due)}(${months}か月)</span><span class="mono">${prog.done}/${prog.total} Done (${pct}%)</span><span class="mono hrs">稼働 ${(hh.task + hh.meeting).toFixed(1)}h（タスク ${hh.task.toFixed(1)}h・会議 ${hh.meeting.toFixed(1)}h）</span>${flagPills(data, p.id, today, flags)}</div></div><button class="btn" data-open="${esc(p.id)}">編集する</button></div>`;

    // バーは、開始日のマスから期限日のマスの右端まで（期限の日を含む）。期限の表示は、その右に付ける
    const sumW = Math.max(0, ((diffDays(p.due, p.start) + 1) / total) * 100).toFixed(3);
    const sumAttr = ` data-gp="${esc(p.id)}"`;
    const sumHandles = `<b class="gh l" data-gh="l"></b><b class="gh r" data-gh="r"></b>`;
    const sumRow = `<div class="g-row g-sumrow"><div class="g-label"><span class="id"></span><span class="muted">プロジェクト全体</span></div><div class="g-lane" ${laneStyle}><i class="gbar gsum"${sumAttr} style="left:${x(p.start)};width:${sumW}%;min-width:4px" title="${fmtMD(p.start)}〜${fmtMD(p.due)}(両端のドラッグで開始・期限を変更)"><u style="width:${pct}%"></u>${sumHandles}</i><span class="g-due mono" style="left:${x(addDays(p.due, 1))}">${fmtMD(p.due)}</span></div></div>`;

    const taskOf = (r) => data.tasks.find((o) => o.id === r.taskId);
    const shown = (r) => !(hideDone && taskOf(r).status === "Done");
    const rowHtml = (r) => {
      const t = data.tasks.find((o) => o.id === r.taskId);
      const late = taskFlags(t, today, data.settings).includes("overdue");
      const ui = STATUS_UI[t.status] ?? STATUS_UI["To Do"];
      const hasPre = (t.predecessors ?? []).length > 0;
      const gt = ` data-gt="${esc(t.id)}"${hasPre ? ` data-pre="${esc(t.predecessors.join(" "))}"` : ""}`;
      const drag = " gdrag";
      const label = `${esc(t.id)} ${esc(t.title)} ${fmtMD(r.start)}〜${fmtMD(r.end)}`;
      const ck = checklistCount(t);
      const ckFill = ck.total && t.status !== "Done" && t.status !== "Cancelled" ? `<u class="gck" style="width:${Math.round((ck.done / ck.total) * 100)}%"></u>` : ""; // 済みの割合だけ濃く塗る（完了したタスクは今までどおり）
      const bar = r.point
        ? `<i class="dot mk${drag} ${ui.dot}${late ? " is-late" : ""}"${gt} style="left:calc(${x(r.end)} + ${(50 / total).toFixed(3)}%)" title="${label}(ドラッグで期限を変更)"></i>`
        : `<i class="gbar${drag} ${ui.bar}${ckFill ? " ck" : ""}${late ? " is-late" : ""}"${gt} style="left:${x(r.start)};width:${(((diffDays(r.end, r.start) + 1) / total) * 100).toFixed(3)}%;min-width:5px" title="${label}(クリックで編集、ドラッグで移動、両端で開始・期限を変更)">${ckFill}<b class="gh l" data-gh="l"></b><b class="gh r" data-gh="r"></b></i>`;
      const act = r.actual && showActual
        ? `<i class="gact" style="left:${x(r.actual.start)};width:${((Math.max(diffDays(r.actual.end, r.actual.start), 0) + 1) / total * 100).toFixed(3)}%;min-width:4px" title="実績 ${fmtMD(r.actual.start)}〜${fmtMD(r.actual.end)}"></i>`
        : "";
      const dependents = data.tasks.filter((o) => (o.predecessors ?? []).includes(t.id)).map((o) => o.id);
      let lab;
      if (askDel === t.id) {
        lab = `<div class="g-label"><span class="id">${esc(t.id)}</span><div class="ask" style="grid-column:2/-1">${dependents.length ? `次のタスク ${esc(dependents.join(", "))} の前のタスクから外れます。` : "このタスクを削除します。"}<div style="display:flex;gap:6px;margin-top:4px"><button class="btn danger" data-delyes="${esc(t.id)}">削除する</button><button class="btn" data-delno>やめる</button></div></div></div>`;
      } else {
        const name = `<button class="g-name" data-gedit="${esc(t.id)}" title="クリックで編集">${esc(t.title)}</button>`;
        const del = `<button class="gx" data-del="${esc(t.id)}" aria-label="${esc(t.id)} を削除">×</button>`;
        const imp = t.importance === "high" && !["Done", "Cancelled"].includes(t.status) ? " imp-high" : ""; // 重要度の印（高）。完了したタスクには付けない
        lab = `<div class="g-label${imp}" data-mvrow="${esc(t.id)}"><span class="mv" draggable="true" data-mvh="${esc(t.id)}" title="ドラッグで並べ替え" aria-label="${esc(t.id)} を並べ替え">⠿</span><span class="id">${esc(t.id)}</span>${name}${del}<span class="g-pre">${hasPre ? "← " + esc(t.predecessors.join(", ")) : ""}</span>${checkMeterHtml(t)}</div>`;
      }
      return `<div class="g-row">${lab}<div class="g-lane" ${laneStyle}>${bar}${act}<span class="g-due mono" style="left:${x(addDays(r.end, 1))}">${fmtMD(t.due)}</span></div></div>`;
    };
    // (大項目, 中項目) ごとに見出し行を入れて並べる。追加の入口になるので、大項目がなくても「（なし）」の見出しを常に出す。
    // 見出しは完了を隠していても残す（そのグループへ追加できるように）
    const base = g.rows;
    const heading = (sec) => {
      const name = `${sec.group || "（なし）"}${sec.subgroup ? ` ▸ ${sec.subgroup}` : ""}`;
      const at = `data-ag="${esc(sec.group)}" data-asg="${esc(sec.subgroup)}"`;
      const opening = addAt && addAt.pid === p.id && addAt.group === sec.group && addAt.subgroup === sec.subgroup;
      const ctl = opening ? `<input class="in" data-gadd="${esc(p.id)}" ${at} placeholder="タスク名を入力して Enter" aria-label="${esc(name)} に追加するタスク名"><button class="plus" data-gaddok="${esc(p.id)}">追加</button><button class="plus" data-gaddno>やめる</button>`
        : `<button class="plus" data-gopen="${esc(p.id)}" ${at} aria-label="${esc(name)} にタスクを追加">＋</button>`;
      return `<div class="g-row g-grp"><div class="g-label" data-mvgrp="${esc(p.id)}" data-mvg="${esc(sec.group)}" data-mvsg="${esc(sec.subgroup)}"><span class="g-grp-t"><b>${esc(sec.group || "（なし）")}</b>${sec.subgroup ? ` <span class="muted">▸ ${esc(sec.subgroup)}</span>` : ""}</span>${ctl}</div><div class="g-lane" ${laneStyle}></div></div>`;
    };
    const secs = groupSections(base.map((r) => ({ ...taskOf(r), row: r })), { ensureNone: true });
    const rows = secs
      .map((sec) => `${heading(sec)}${sec.tasks.filter((x) => shown(x.row)).map((x) => rowHtml(x.row)).join("")}`).join("");

    const headRow = `<div class="g-row g-head"><div class="g-label"></div><div class="g-lane g-axis ${dayScale ? "day" : ""}" ${laneStyle}>${dayScale ? "" : `<span class="todaytag" style="left:${x(today)}">今日</span>`}${axis}</div></div>`;

    const gbody = `<div class="gbody" style="--lanew:${laneW}"><div class="gov under">${grid}</div><div class="gov over">${msLines}${todayLine}</div>${headRow}${msRow}${sumRow}${rows}</div>`;
    // プロジェクトごとに、固定の見出し(.pgstick。画面の縦スクロールに sticky)と、横スクロールだけの枠(.gscroll)に分ける。
    // 枠は横スクロールの枠なので、その中では sticky が画面の縦スクロールに効かない。見出しは枠の外に置く。日付軸の複製(.gstrip)は app.js が作る
    return `<section class="pg" aria-label="${esc(p.name)}"><div class="pgstick">${head}</div><div class="gwrap"><div class="gstrip" aria-hidden="true"></div><div class="gscroll"${scrollAttrs}><div class="gwide">${gbody}</div></div></div></section>`;
  }).join("");

  return `${top}<div class="gprojects">${sections}</div>`;
}
