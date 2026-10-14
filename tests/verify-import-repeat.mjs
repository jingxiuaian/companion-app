/* 临时验收台（跑完可删）：Node + 伪 DOM 直接执行 companion-app/app.js。
   验收目标：一键导入 = 增量补新（只补今天还没有的），真重复只走勾选弹窗。
   另一条主线：新建习惯当天要能被"今天该做的"认到，但不会自动出现在今日计划里。 */
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

function boot(initialStorage = {}) {
  const els = new Map();
  const storage = { ...initialStorage };
  /* 冻结"现在几点"：freeSlots 只排此刻之后的空档，不冻住的话验收会随运行时刻飘 */
  const clock = { h: 6, m: 0 };
  const FrozenDate = class extends Date {
    constructor(...args){
      if(args.length){ super(...args); }
      else { const d = new Date(); d.setHours(clock.h, clock.m, 0, 0); super(d.getTime()); }
    }
    static now(){ const d = new Date(); d.setHours(clock.h, clock.m, 0, 0); return d.getTime(); }
  };
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
    console, setTimeout, clearTimeout, Date: FrozenDate, clock,
    localStorage: {
      getItem: k => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: k => { delete storage[k]; },
    },
    document: { getElementById: t, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, body: { dataset: {} } },
    navigator: {}, confirm: () => true, alert: () => {},
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, { filename: "companion-app/app.js" });
  return { ctx, els, storage };
}

const results = [];
const run = (ctx, src) => vm.runInContext(src, ctx, { filename: "acceptance.js" });

const HABIT_A = '{ id:"A", name:"背单词", desc:"", cat:"自定义", min:20, energy:"高", scene:"不限", type:"habit", deadline:null, interval:2, lastDone:"2020-01-01" }';
/* 用户到事项池"＋ 添加"一个全新习惯：mBacklogOk 现在写 lastDone: null */
const HABIT_B = '{ id:"B", name:"跑步", desc:"", cat:"自定义", min:30, energy:"高", scene:"不限", type:"habit", deadline:null, interval:2, lastDone: null }';

/* ============ 你的场景：导入 → 加新任务 → 再导入 ============ */
{
  const { ctx, storage } = boot();
  run(ctx, `
const out = [];
const ok = (name, cond, extra) => out.push({ pass: !!cond, name, extra: extra || "" });
state.days = {}; state.date = todayStr(); settings.importMode = "due";
state.backlog = [${HABIT_A}];
dayData().fragments = [{ start:"19:00", end:"22:00" }];

doImport("due");                                   // 第一次导入
ok("第一次导入：1 条", dayData().tasks.length === 1, $("toast").textContent);

state.backlog.push(${HABIT_B});                    // 事项池加一个全新习惯
ok("新习惯被算作\\"今天该做的\\"", dueItems().some(b => b.id === "B"), "dueItems=" + dueItems().map(b=>b.id).join(","));

doImport("due");                                   // 第二次导入
const titles = dayData().tasks.map(t => t.title);
ok("旧任务没有被重复添加（背单词只 1 条）", titles.filter(x => x === "背单词").length === 1, titles.join(","));
ok("新任务进来了（跑步 1 条）", titles.filter(x => x === "跑步").length === 1, titles.join(","));
ok("今日计划共 2 条：" + titles.join("、"), titles.length === 2, $("toast").textContent);

doImport("due");                                   // 第三次：什么都不该新增
const t3 = dayData().tasks.length;
ok("再点一次：0 新增（不重复）", t3 === 2, "tasks=" + t3 + " toast=" + $("toast").textContent);
ok("toast 说明「没有新任务要导入」", $("toast").textContent === "没有新任务要导入", $("toast").textContent);

ok("事项池卡片显示「还没开始」而不是 NaN 天", /习惯 · 还没开始/.test($("backlogList").innerHTML), $("backlogList").innerHTML.replace(/\\s+/g," ").slice(0,150));

suggest();
ok("建议理由里没有 Infinity/NaN", !/Infinity|NaN/.test(lastSugg.singles.map(c=>c.reason).join("|")), lastSugg.singles.map(c=>c.reason).join(" | "));
renderWeek();
ok("周视图里没有 Infinity/NaN", !/Infinity|NaN/.test($("weekList").innerHTML), "");

globalThis.__R = out;
globalThis.__STORAGE = JSON.parse(localStorage.getItem("companion-plan-v2"));
`);
  results.push(...run(ctx, "__R"));
  storage["companion-plan-v2"] = JSON.stringify(run(ctx, "__STORAGE"));

  /* ============ 刷新页面 ============ */
  const { ctx: ctx2 } = boot(storage);
  run(ctx2, `
const out = [];
state.date = todayStr();
out.push({ pass: dayData().tasks.length === 2, name: "刷新后今日计划仍是 2 条（没被自动生成冲掉）", extra: "tasks=" + dayData().tasks.map(t=>t.title).join(",") });
out.push({ pass: state.backlog.length === 2, name: "事项池也还在（2 条）", extra: "" });
globalThis.__R2 = out;
`);
  results.push(...run(ctx2, "__R2"));
}

/* ============ 自动生成：全新习惯不自动塞，欠账的才自动补 ============ */
{
  const { ctx } = boot();
  run(ctx, `
const out = [];
const ok = (name, cond, extra) => out.push({ pass: !!cond, name, extra: extra || "" });
state.days = {}; state.date = todayStr();
state.backlog = [${HABIT_A}, ${HABIT_B}];
dayData().fragments = [{ start:"19:00", end:"22:00" }];
render();                                          // autoGenHabits 在 render 里跑
const titles = dayData().tasks.map(t => t.title);
ok("欠账的老习惯自动补进来了", titles.includes("背单词"), titles.join(","));
ok("全新习惯不会自动进今日计划（等你点导入）", !titles.includes("跑步"), titles.join(","));
globalThis.__R = out;
`);
  results.push(...run(ctx, "__R"));
}

/* ============ 真重复：只有勾选弹窗这条路 ============ */
{
  const { ctx } = boot();
  run(ctx, `
const out = [];
const ok = (name, cond, extra) => out.push({ pass: !!cond, name, extra: extra || "" });
state.days = {}; state.date = todayStr();
state.backlog = [${HABIT_A}];
dayData().fragments = [{ start:"19:00", end:"22:00" }];

doImport("all");
openImportPick();
const html = $("importPickList").innerHTML;
ok("勾选弹窗标出「今日计划里已有 1 条」", /今日计划里已有 1 条/.test(html), html.replace(/\\s+/g," ").slice(0,150));
ok("已排过的项默认不勾", !/value="A"[^>]*checked/.test(html), "");

importTasks(state.backlog.slice(), { allowDup: true });   // 用户亲手勾上 = 显式要求再做一次
ok("显式勾选后能重复导入 → 2 条", dayData().tasks.length === 2, $("toast").textContent);
render();
ok("重复条目带 ×2 标签", /×2/.test($("taskList").innerHTML), "");

// 排不下时间段也照样导入，只是不占时间段
dayData().fragments = [{ start:"19:00", end:"19:10" }];
state.backlog.push({ id:"C", name:"冥想", min:30, energy:"高", scene:"不限", type:"habit", interval:1, lastDone:null });
importTasks([state.backlog.find(b => b.id === "C")]);
const c = dayData().tasks.find(t => t.backlogId === "C");
ok("排不下也进计划（「待排」）", !!c && !c.start, "start=" + c.start + " toast=" + $("toast").textContent);
globalThis.__R = out;
`);
  results.push(...run(ctx, "__R"));
}

/* ============ 旧数据修复：曾被写死成"今天做过"的习惯 ============ */
{
  const legacy = {
    "companion-plan-v2": JSON.stringify({
      schedule: [], notes: [], days: {},
      backlog: [
        { id: "old", name: "旧数据里的新习惯", desc: "", cat: "自定义", min: 20, energy: "高", scene: "不限", type: "habit", deadline: null, interval: 2, lastDone: new Date().toISOString().slice(0, 10) },
      ],
    }),
  };
  const { ctx } = boot(legacy);
  run(ctx, `
const out = [];
const ok = (name, cond, extra) => out.push({ pass: !!cond, name, extra: extra || "" });
ok("没有完成记录的「今天做过」被改回没做过", state.backlog[0].lastDone === null, String(state.backlog[0].lastDone));
ok("于是它能被「今天该做的」认到", dueItems().some(b => b.id === "old"), "");
globalThis.__R = out;
`);
  results.push(...run(ctx, "__R"));
}

/* ---------- 报告 ---------- */
let failed = 0;
console.log("「一键导入 = 增量补新」验收\n");
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.extra ? "   [" + r.extra + "]" : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
