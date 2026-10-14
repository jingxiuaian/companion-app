/* 临时复现脚本（跑完可删）：证明"空余时间建议"在任务完成后仍然推荐已完成的/已排进今日计划的事项。 */
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

function boot() {
  const els = new Map(), storage = {};
  const t = id => {
    if (!els.has(id)) {
      const o = { id, innerHTML: "", textContent: "", value: "", style: {}, dataset: {}, children: [] };
      o.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
      o.addEventListener = () => {};
      o.querySelectorAll = () => [];
      els.set(id, new Proxy(o, { get: (a, k) => a[k], set: (a, k, v) => { a[k] = v; return true; } }));
    }
    return els.get(id);
  };
  const sandbox = {
    console, setTimeout, clearTimeout,
    localStorage: { getItem: k => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); }, removeItem: k => { delete storage[k]; } },
    document: { getElementById: t, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, body: { dataset: {} } },
    navigator: {}, confirm: () => true, alert: () => {},
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, { filename: "app.js" });
  return ctx;
}

const ctx = boot();
const out = vm.runInContext(`
state.days = {}; state.date = todayStr();
state.backlog = [
  { id:"A", name:"交黑客松材料", desc:"", cat:"自定义", min:20, energy:"高", scene:"不限", type:"deadline",
    deadline: addDaysStr(todayStr(), 3), interval:2, lastDone:null },
  { id:"B", name:"背单词", desc:"", cat:"自定义", min:30, energy:"高", scene:"不限", type:"habit",
    deadline:null, interval:2, lastDone:"2020-01-01" },
  { id:"C", name:"跑步", desc:"", cat:"自定义", min:40, energy:"高", scene:"不限", type:"habit",
    deadline:null, interval:2, lastDone:"2020-01-01" },
];
dayData().fragments = [{ start:"19:00", end:"22:00" }];   // 3 小时空闲
save(); render();

const snap = () => ({
  remaining: lastSugg.remaining,
  free: $("ovFree").textContent,
  list: lastSugg.singles.map(c => c.item.name + "(" + c.fit + ")"),
  empty: lastSugg.empty,
  raw: $("suggList").innerHTML.replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim().slice(0, 260),
});

suggest();                                   // ① 任务都没排进计划时
const s0 = snap();

doImport("all");                             // ② 全部事项导入今日计划
suggest();
const s1 = snap();

// ③ 把今日计划里的任务全部勾掉（模拟打卡：done=true 且该事项 lastDone=今天）
dayData().tasks.forEach(t => { t.done = true; const b = state.backlog.find(x => x.id === t.backlogId); if(b) b.lastDone = todayStr(); });
save(); render();
suggest();
const s2 = snap();

globalThis.__R = { s0, s1, s2, doneCount: dayData().tasks.filter(t=>t.done).length, total: dayData().tasks.length };
`, ctx);
const r = vm.runInContext("__R", ctx);

const show = (label, s) => {
  console.log(`\n=== ${label} ===`);
  console.log(`  当前可支配: ${s.remaining} 分钟   （总览显示: ${s.free}）`);
  console.log(`  建议条目  : ${s.empty ? "（空）" : s.list.join(" / ")}`);
  console.log(`  界面文案  : ${s.raw}`);
};
show("① 事项池 3 条，什么都没排", r.s0);
show("② 3 条都导入了今日计划（还没做）", r.s1);
show(`③ 今日计划 ${r.doneCount}/${r.total} 条已全部勾掉完成`, r.s2);
