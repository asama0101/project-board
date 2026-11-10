// 固定表示: ガントの日付軸・リストの列見出しの複製（スクロール中も見える位置に付ける）、ヘッダーの高さの反映、横スクロール枠のそろえ。
// 描き直し（app.js の render）のあとに syncSticky を呼ぶ。状態（S）には触れず、#view の DOM だけを読み書きする。
const view = document.getElementById("view");

/** ガントの横スクロール枠(プロジェクトごと)の横位置を、動かした枠にそろえる。差が 0.5px 以下なら代入しない */
function alignGScrolls(src) {
  for (const gs of view.querySelectorAll(".gscroll")) {
    if (gs === src || Math.abs(gs.scrollLeft - src.scrollLeft) <= 0.5) continue;
    const before = gs.scrollLeft;
    gs.scrollLeft = src.scrollLeft;
    if (gs.scrollLeft !== before) aligned.set(gs, gs.scrollLeft); // 代入で起きる scroll は、そろえ直さない(動いている最中の枠を、古い位置へ引き戻してしまうため)。右端で丸められて値が変わらないときは、scroll が起きないので、記録しない(古い値が、あとの本物のスクロールを飲み込む)
  }
  for (const gs of view.querySelectorAll(".gscroll")) updateGStrip(gs);
}
/** 日付軸の複製(.gstrip)の横位置を、枠の横スクロールにそろえる(縦は CSS の sticky。横だけ JS) */
function updateGStrip(gs) {
  const lane = gs.closest(".gwrap")?.querySelector(":scope > .gstrip > .gsv > .g-lane");
  if (lane) lane.style.transform = `translateX(${-gs.scrollLeft}px)`;
}
/**
 * ガントの日付軸の複製(.gstrip)を作り直す。枠(.gscroll)は横スクロールの枠なので、その中の日付軸は、画面の縦スクロールで留められない。
 * 枠の外に、本物の日付軸の写し(左の空き .gsl + 窓 .gsv の中の目盛りの行)を sticky で置く。固定していないときは、本物の日付軸にぴったり重なる(出し分けは要らない)。
 * 流れの高さは増やさない(複製は margin-bottom で、枠は padding-bottom と負の margin-bottom で、sticky の範囲を複製の高さだけ短くし、プロジェクトの下端を越えないようにする)
 */
function syncGStrips() {
  for (const wrap of view.querySelectorAll(".gwrap")) {
    const strip = wrap.querySelector(":scope > .gstrip"), gs = wrap.querySelector(":scope > .gscroll");
    const axis = gs.querySelector(".g-head"), lane = gs.querySelector(".g-head .g-lane");
    const l = document.createElement("div"); l.className = "gsl";
    const v = document.createElement("div"); v.className = "gsv";
    const copy = lane.cloneNode(true);
    copy.removeAttribute("id"); copy.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id"));
    const gap = parseFloat(getComputedStyle(axis).columnGap); // 本物の行は、ラベルと目盛りの間にすきま(gap)がある。写しの窓はラベルの右端から始まるので、目盛りの行を gap だけ右へ置く
    copy.style.marginLeft = `${gap}px`;
    copy.style.width = `${lane.offsetWidth}px`; // 本物の幅は、枠の幅から決まる calc(cqw)。枠の外では決められないので、px で写す
    v.appendChild(copy);
    strip.replaceChildren(l, v);
    wrap.style.setProperty("--sh", `${axis.getBoundingClientRect().height}px`);
    wrap.style.setProperty("--sb", `${gs.offsetHeight - gs.clientHeight}px`); // 枠の横スクロールバーの高さ。複製がその上に重ならないよう、sticky の範囲から除く
    strip.style.setProperty("--lw", getComputedStyle(gs).getPropertyValue("--lw").trim());
    updateGStrip(gs);
  }
}


const aligned = new WeakMap();
// scroll はバブルしないので、キャプチャで受ける
view.addEventListener("scroll", (e) => {
  const gs = e.target;
  if (!gs.classList.contains("gscroll")) return;
  if (aligned.get(gs) === gs.scrollLeft) { aligned.delete(gs); return; }
  alignGScrolls(gs);
}, true);

// ヘッダーとフィルタ行は上端に固定する（theme.css）。その高さを --hh・--th に入れ、固定の帯・表の列見出し・「今日の優先」がその下に付くようにする
const topbar = document.querySelector("header.top");
export function syncSticky() {
  const root = document.documentElement.style;
  root.setProperty("--hh", `${topbar.offsetHeight}px`);
  const tool = view.querySelector(".ptool");
  root.setProperty("--th", `${tool ? tool.offsetHeight : 0}px`);
  // ガントの操作の帯(.gtop)の高さ(プロジェクトの見出し .pgstick の固定位置)と、プロジェクトごとの見出しの高さ(日付軸の複製の固定位置)。スクロールには連動させない
  root.setProperty("--gh", `${view.querySelector(".gtop")?.offsetHeight ?? 0}px`);
  for (const pg of view.querySelectorAll("section.pg")) pg.style.setProperty("--pgh", `${pg.querySelector(".pgstick").getBoundingClientRect().height}px`);
  syncGStrips();
  syncThStrips();
  pinTableHeads();
}
/**
 * リストの列見出しの複製（.thstrip）を作り直す。表は横スクロールの枠の中にあり、列見出しの sticky が画面の縦スクロールに効かないため、
 * 枠の外(表を包む .twrap の先頭)に、列見出しの写しを sticky で置く(縦は CSS の sticky、横スクロールの位置だけ translateX でそろえる)。
 * 固定していないときは、本物の列見出しにぴったり重なる(出し分けは要らない)。流れの高さは増やさず、sticky の範囲を複製の高さだけ短くして、表の下端を越えないようにする。
 * 幅・余白・文字は、本物の thead を測って写す
 */
function syncThStrips() {
  for (const panel of view.querySelectorAll("section.panel")) {
    const st = panel.querySelector(":scope > .pstick"), wrap = panel.querySelector(":scope > .twrap");
    const strip = wrap?.querySelector(":scope > .thstrip"), box = wrap?.querySelector(":scope > .tlist");
    if (!st || !strip || !box) continue;
    const ths = [...box.querySelectorAll("thead th")];
    panel.style.setProperty("--ph", `${st.getBoundingClientRect().height}px`);
    if (!ths.length || !ths[0].offsetHeight) { strip.replaceChildren(); wrap.style.setProperty("--sh", "0px"); wrap.style.setProperty("--sb", "0px"); continue; } // 狭い画面では、列見出しは出ない
    if (!box.dataset.thsync) {
      box.dataset.thsync = "1";
      box.addEventListener("scroll", () => { const inner = strip.firstElementChild; if (inner) inner.style.transform = `translateX(${-box.scrollLeft}px)`; }, { passive: true });
    }
    const inner = document.createElement("div"); inner.className = "thin";
    for (const th of ths) {
      const c = document.createElement("div"); c.className = "thc"; c.textContent = th.textContent;
      c.style.width = `${th.getBoundingClientRect().width}px`; c.style.padding = getComputedStyle(th).padding;
      inner.appendChild(c);
    }
    wrap.style.setProperty("--sh", `${ths[0].getBoundingClientRect().height}px`);
    wrap.style.setProperty("--sb", `${box.offsetHeight - box.clientHeight}px`); // 表の横スクロールバーの高さ
    inner.style.transform = `translateX(${-box.scrollLeft}px)`;
    strip.replaceChildren(inner);
  }
}
/** 横スクロールの枠の中で sticky が効かない表（設定・稼働の表）の列見出しを、スクロール中も、ヘッダーとフィルタ行の下に付ける（表の枠の中でセルをずらす。表の下端は越えない）。リストの表は、表を包む枠の先頭の複製（syncThStrips） */
function pinTableHeads() {
  const cs = getComputedStyle(document.documentElement);
  const top = (parseFloat(cs.getPropertyValue("--hh")) || 0) + (parseFloat(cs.getPropertyValue("--th")) || 0);
  for (const box of view.querySelectorAll(".tscroll")) {
    const ths = box.querySelectorAll("thead th");
    if (!ths.length) continue;
    if (box.classList.contains("tlist")) continue; // リストの表は、表を包む枠（.twrap）の先頭の複製（.thstrip）で固定する
    const r = box.getBoundingClientRect();
    const dy = Math.max(0, Math.min(top - r.top, r.height - ths[0].offsetHeight - 4));
    for (const th of ths) th.style.transform = dy ? `translateY(${dy}px)` : "";
  }
}
let pinQueued = false;
window.addEventListener("scroll", () => { if (!pinQueued) { pinQueued = true; requestAnimationFrame(() => { pinQueued = false; pinTableHeads(); }); } }, { passive: true });
new ResizeObserver(syncSticky).observe(topbar);
