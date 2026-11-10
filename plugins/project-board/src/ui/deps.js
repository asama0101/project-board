// ガントチャートの「前のタスク」の線(編集画面だけ)。描画のあとに、バーの位置を測って SVG を重ねる。
// ふだんは薄い線、バーにマウスを置くと、そのタスクと前のタスク・次のタスクを色分けし、つなぐ線を濃くして、ほかを薄くする。

import { esc } from "./common.js";

/** 前のタスクの右端から、次のタスクの左端への折れ線の path。次のタスクが前のタスクの右端に近いときは、左端の手前で折れる */
export function depPath(from, to) {
  const x = Math.min(to.left - 8, from.right + 12);
  return `M${from.right},${from.y} H${x} V${to.y} H${to.left - 1}`;
}

const ids = (el) => (el.dataset.pre ?? "").split(" ").filter(Boolean);
const num = (n) => Math.round(n * 10) / 10;

/** 線 1 本の SVG の文字列。タスク ID は、属性に入れるのでエスケープする */
export const depMarkup = ({ from, to, d, left, y }) =>
  `<g class="gdep" data-from="${esc(from)}" data-to="${esc(to)}"><path d="${d}"/><polygon points="${left - 1},${y} ${left - 6},${y - 3.5} ${left - 6},${y + 3.5}"/></g>`;

/** 1 つのガント本体(gbody)の線の SVG の文字列。バーの位置を測るだけで、DOM は書き換えない。両端のバーが gbody に出ているものだけ引く */
function measureDeps(gbody) {
  const box = gbody.getBoundingClientRect();
  const byId = new Map([...gbody.querySelectorAll("[data-gt]")].map((el) => [el.dataset.gt, { el, r: el.getBoundingClientRect() }]));
  const mid = (r) => num(r.top + r.height / 2 - box.top);
  let lines = "";
  for (const { el, r: b } of byId.values()) {
    for (const pid of ids(el)) {
      const p = byId.get(pid);
      if (!p) continue;
      const left = num(b.left - box.left), y = mid(b);
      const d = depPath({ right: num(p.r.right - box.left), y: mid(p.r) }, { left, y });
      lines += depMarkup({ from: pid, to: el.dataset.gt, d, left, y });
    }
  }
  return `<svg class="gdeps" aria-hidden="true">${lines}</svg>`;
}

/** 画面にあるすべてのガント本体(gbody)の線を引き直す。先に全部を測り、そのあとで全部を書く(測ると書くを混ぜると、そのたびにレイアウトが走る)。
 *  SVG は HTML の文字列から作る(名前空間の URL を持たずに済む) */
export function drawDeps(gbodies) {
  const parts = [...gbodies].map((gb) => [gb, measureDeps(gb)]);
  for (const [gb, svg] of parts) {
    gb.querySelector(":scope > svg.gdeps")?.remove();
    gb.insertAdjacentHTML("beforeend", svg);
  }
}

/** taskId のバーにマウスを置いたときの強調。null で戻す。前のタスクも次のタスクもないバーは、自身だけを光らせる(全部を薄くしない) */
export function focusDeps(gbody, taskId) {
  gbody.classList.remove("dep-focus");
  gbody.querySelectorAll(".dep-self,.dep-pre,.dep-next,.dep-on,.dep-out").forEach((el) => el.classList.remove("dep-self", "dep-pre", "dep-next", "dep-on", "dep-out"));
  if (!taskId) return;
  const bars = [...gbody.querySelectorAll("[data-gt]")];
  const self = bars.find((el) => el.dataset.gt === taskId);
  const pres = ids(self);
  const nexts = bars.filter((el) => ids(el).includes(taskId));
  self.classList.add("dep-self");
  if (!pres.length && !nexts.length) return;
  gbody.classList.add("dep-focus");
  bars.forEach((el) => { if (pres.includes(el.dataset.gt)) el.classList.add("dep-pre"); else if (nexts.includes(el)) el.classList.add("dep-next"); });
  gbody.querySelectorAll(".gdep").forEach((g) => {
    if (g.dataset.to === taskId) g.classList.add("dep-on");
    else if (g.dataset.from === taskId) g.classList.add("dep-out");
  });
}
