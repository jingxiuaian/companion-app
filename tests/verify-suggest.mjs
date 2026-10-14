/* 临时验收台（跑完可删）：Node + 伪 DOM 执行 companion-app/app.js，验收"空余时间建议"。
   重点：① 完成/已排的不再被推荐 ② 时长账（预计−实际=盈余）③ 强制上报耗时 ④ 让出的时间段能排进去。 */
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

function boot(initialStorage = {}) {
  const els = new Map();
  const storage = { ...initialStorage };
  /* 冻结"现在几点"，让跟时间有关的验收可复现；测试里改 clock.h / clock.m 即可推进时间 */
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
      const o = { id, innerHTML: "", textContent: "", value: "", style: {}, dataset: {}, children: [], disabled: false };
      o.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
      o.addEventListener = () => {};
      o.querySelectorAll = () => [];
      o.focus = () => {};
      els.set(id, new Proxy(o, {
        get: (a, k) => a[k],
        // 真 DOM 里 input.value 赋值会被强制转成字符串，这里照做，免得测出假问题
        set: (a, k, v) => { a[k] = (k === "value" || k === "textContent" || k === "innerHTML") ? String(v) : v; return true; },
      }));
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
/* 夹具说明：lastDone 传 "null" = "从没做过"，这种习惯不会被 autoGenHabits 自动塞进今日计划，
   便于单独测建议引擎；默认的 "2020-01-01" = 老欠账习惯，render 时会被自动列进计划。 */
const H = (id, name, min, type, extra, lastDone = '"2020-01-01"') =>
  `{ id:"${id}", name:"${name}", desc:"", cat:"自定义", min:${min}, energy:"高", scene:"不限", type:"${type}", ` +
  `deadline:${type === "deadline" ? `addDaysStr(todayStr(), ${extra})` : "null"}, interval:1, lastDone:${lastDone} }`;

/* ============ 1. 时长账：读书一小时（规定时长）vs 背 30 个单词（规定工作量） ============ */
{
  const { ctx } = boot();
  run(ctx, `
const out = [];
const ok = (name, cond, extra) => out.push({ pass: !!cond, name, extra: extra || "" });
state.days = {}; state.date = todayStr();
state.backlog = [ ${H("R", "读书一小时", 60, "habit")}, ${H("W", "背30个单词", 30, "habit")} ];
dayData().fragments = [{ start:"19:00", end:"22:00" }];   // 180 分钟
const d = dayData();
d.tasks.push({ id:"t1", backlogId:"R", title:"读书一小时", min:60, start:"19:00", end:"20:00", done:false });
d.tasks.push({ id:"t2", backlogId:"W", title:"背30个单词", min:30, start:"20:00", end:"20:30", done:false });
save(); render();

const base = freeMinOf(dayData());
ok("未完成时按预计占用：180−60−30=90", base === 90, "可支配=" + base);
ok("总览「可支配」与之一致", $("ovFree").textContent === fmtDur(base), $("ovFree").textContent);

// 完成「读书一小时」，实际正好 60 分钟 → 盈余 0
openActual(0); $("aMin").value = "60"; commitActual();
ok("读书一小时（预计60/实际60）：可支配不变 = 90", freeMinOf(dayData()) === 90, "可支配=" + freeMinOf(dayData()));
ok("  → 提示「正好用满预计时间」", /正好用满预计时间/.test($("toast").textContent), $("toast").textContent);

// 完成「背30个单词」，实际 20 分钟 → 盈余 +10
openActual(1); $("aMin").value = "20"; commitActual();
ok("背30个单词（预计30/实际20）：可支配 +10 = 100", freeMinOf(dayData()) === 100, "可支配=" + freeMinOf(dayData()));
ok("  → 提示「省下 10m」", /省下 10m/.test($("toast").textContent), $("toast").textContent);
ok("  → 任务行显示「实际 20m（预计 30m）」", /实际 20m（预计 30m）/.test($("taskList").innerHTML), "");
ok("  → 实际占用区间收窄到 19:00–19:10 那一类（此例 20:00–20:20）", /20:00–20:20/.test($("taskList").innerHTML), "");

// 修正：做得比预计久 → 可支配应当减少
openActual(1); $("aMin").value = "45"; commitActual();
ok("把实际改成 45 分钟（超时 15）：可支配回落到 75", freeMinOf(dayData()) === 75, "可支配=" + freeMinOf(dayData()));
ok("  → 提示「比预计多用了 15m」", /比预计多用了 15m/.test($("toast").textContent), $("toast").textContent);
ok("  → 已完成状态没被改坏（仍是已完成）", dayData().tasks[1].done === true, "");

// 未完成任务仍按预计占用
ok("未完成的读书任务仍按预计 60 分钟占用", spentMin(dayData().tasks[0]) === 60, "");
globalThis.__R = out;
`);
  results.push(...run(ctx, "__R"));
}

/* ============ 2. 你报的症状：完成后不再推荐已完成 / 已排的 ============ */
{
  const { ctx } = boot();
  run(ctx, `
const out = [];
const ok = (name, cond, extra) => out.push({ pass: !!cond, name, extra: extra || "" });
state.days = {}; state.date = todayStr();
state.backlog = [ ${H("R", "交黑客松材料", 20, "deadline", 3)}, ${H("W", "背单词", 30, "habit")}, ${H("X", "跑步", 40, "habit")} ];
dayData().fragments = [{ start:"19:00", end:"22:00" }];
state.backlog.push(${H("N", "冥想", 15, "habit", 0, "null")});   // 第 4 件：不排进今日计划（从没做过，不会被自动列出）
save(); render();

importTasks(state.backlog.filter(b => b.id !== "N"));   // 前 3 件导入今日计划
ok("3 件已排进今日计划", dayData().tasks.length === 3, "tasks=" + dayData().tasks.length);

suggest();
ok("已排进计划(未做)的不再被推荐", lastSugg.singles.every(c => c.item.id === "N"), lastSugg.singles.map(c=>c.item.id).join(","));
ok("只推荐没安排的那一件（冥想）", lastSugg.singles.length === 1 && lastSugg.singles[0].item.id === "N", lastSugg.singles.map(c=>c.item.name).join(","));

// 全部完成
dayData().tasks.forEach((t,i) => { openActual(i); $("aMin").value = String(t.min); commitActual(); });
ok("3 条已全部完成", dayData().tasks.every(t => t.done), "");

suggest();
const afterNames = lastSugg.singles.map(c => c.item.name);
ok("全部完成后：推荐里不含任何已完成 / 已排的事项", afterNames.every(n => n === "冥想"), afterNames.join(","));
ok("  → 唯一没安排的「冥想」仍被推荐（这才是有用的建议）", afterNames.join(",") === "冥想", afterNames.join(","));
const html = $("suggList").innerHTML.replace(/<[^>]+>/g," ").replace(/\\s+/g," ").trim();
ok("  → 界面文案不再出现已完成的任务名", !/交黑客松材料|背单词|跑步/.test(html), html);

// 把第 4 件也做掉 → 应当给出"今天清空了"的正面反馈
dayData().tasks.push({ id:"t4", backlogId:"N", title:"冥想", min:15, done:true, actual:15 });
state.backlog.find(b => b.id === "N").lastDone = todayStr();
save(); render(); suggest();
const done = $("suggList").innerHTML.replace(/<[^>]+>/g," ").replace(/\\s+/g," ").trim();
ok("全部清空 → 给出恢复类建议块", /今天的都做完了/.test(done), done);
ok("  → 界面文案不再出现任何已完成的任务名", !/交黑客松材料|背单词|跑步|冥想/.test(done), done);
globalThis.__R = out;
`);
  results.push(...run(ctx, "__R"));
}

/* ============ 3. 让出的时间段真的能排进去 ============ */
{
  const { ctx } = boot();
  run(ctx, `
const out = [];
const ok = (name, cond, extra) => out.push({ pass: !!cond, name, extra: extra || "" });
state.days = {}; state.date = todayStr();
state.backlog = [ ${H("R", "写周报", 30, "habit")} ];
dayData().fragments = [{ start:"19:00", end:"19:30" }];
dayData().tasks.push({ id:"t1", backlogId:"R", title:"写周报", min:30, start:"19:00", end:"19:30", done:false });
save(); render();
ok("未完成时该段没有空位", freeSlots().length === 0, JSON.stringify(freeSlots()));

openActual(0); $("aMin").value = "10"; commitActual();   // 实际只花 10 分钟
const slots = freeSlots();
ok("完成后让出 19:10–19:30", slots.length === 1 && slots[0].start === "19:10" && slots[0].end === "19:30", JSON.stringify(slots));

// 提前完成省下的 20 分钟 + 空闲，能让池里另一件事排进去
state.backlog.push({ id:"Z", name:"拉伸", desc:"", cat:"自定义", min:20, energy:"高", scene:"不限", type:"habit", deadline:null, interval:1, lastDone:null });
importTasks([state.backlog.find(b => b.id === "Z")]);
const z = dayData().tasks.find(t => t.backlogId === "Z");
ok("省下的时间能被新任务用上（拉伸 19:10–19:30）", !!z && z.start === "19:10", z ? z.start + "–" + z.end : "没排进去");
globalThis.__R = out;
`);
  results.push(...run(ctx, "__R"));
}

/* ============ 4. 排序：紧急的排在池子后面也要先出 ============ */
{
  const { ctx } = boot();
  run(ctx, `
const out = [];
const ok = (name, cond, extra) => out.push({ pass: !!cond, name, extra: extra || "" });
state.days = {}; state.date = todayStr();
state.backlog = [
  ${H("A", "练字", 20, "habit", 0, "null")}, ${H("B", "背单词", 20, "habit", 0, "null")}, ${H("C", "跑步", 20, "habit", 0, "null")},
  ${H("D", "交材料", 20, "deadline", 2, "null")},
];
dayData().fragments = [{ start:"19:00", end:"23:00" }];
save(); render();
suggest();
ok("池子最后一条（2 天后截止）排第一，而不是池子最靠前的练字",
   lastSugg.singles[0] && lastSugg.singles[0].item.id === "D", lastSugg.singles.map(c => c.item.name).join(" > "));
ok("  → 理由说的是截止日期", /截止|天/.test(lastSugg.singles[0].reason), lastSugg.singles[0].reason);
// 反证：若 pri 还是 ×100，练字(A) 会以 420 分压过交材料(D) 的 280 分
ok("  → 权重确实翻了盘（旧权重下 A=420 > D=280）", (4*100 + 20) > (1*100 + 180), "旧权重 A=420 / D=280，新权重 A=40+20=60 / D=10+180=190");
globalThis.__R = out;
`);
  results.push(...run(ctx, "__R"));
}

/* ============ 5. 强制上报耗时 ============ */
{
  const { ctx } = boot();
  run(ctx, `
const out = [];
const ok = (name, cond, extra) => out.push({ pass: !!cond, name, extra: extra || "" });
state.days = {}; state.date = todayStr();
state.backlog = [ ${H("R", "读书一小时", 60, "habit")} ];
dayData().fragments = [{ start:"19:00", end:"22:00" }];
dayData().tasks.push({ id:"t1", backlogId:"R", title:"读书一小时", min:60, start:"19:00", end:"20:00", done:false });
save(); render();

openActual(0);
ok("打卡弹窗标题是「完成打卡」", /完成打卡/.test($("aTitle").textContent), $("aTitle").textContent);
ok("输入框默认空着（不预填，强制你自己填）", $("aMin").value === "", "value=" + JSON.stringify($("aMin").value));
ok("没填数字时「完成打卡」是禁用的", $("mActualOk").disabled === true, "");

syncActualOk();
ok("空值仍禁用", $("mActualOk").disabled === true, "");
$("aMin").value = "45"; syncActualOk();
ok("填了 45 就启用", $("mActualOk").disabled === false, "");
$("aMin").value = "-5"; syncActualOk();
ok("负数不启用", $("mActualOk").disabled === true, "");
$("aMin").value = ""; syncActualOk();
ok("清空又变回禁用", $("mActualOk").disabled === true, "");

// 没填就想提交 → 不生效，任务保持未完成
commitActual();
ok("没填数字直接提交：任务仍未完成", dayData().tasks[0].done === false, "");
ok("  → 也没写入 actual", dayData().tasks[0].actual === undefined, String(dayData().tasks[0].actual));

// 「就按预计」一键填入
fillActualEstimate();
ok("「就按预计」填入预计时长 60", $("aMin").value === "60" && $("mActualOk").disabled === false, String($("aMin").value));
commitActual();
ok("提交后任务完成", dayData().tasks[0].done === true, "");
ok("actual 记为 60", dayData().tasks[0].actual === 60, String(dayData().tasks[0].actual));

// 完成后再点耗时标签 = 只改数字
openActual(0);
ok("已完成的任务打开是「修改实际耗时」", /修改实际耗时/.test($("aTitle").textContent), $("aTitle").textContent);
ok("  → 预填当前 actual", $("aMin").value === "60", String($("aMin").value));
$("aMin").value = "30"; commitActual();
ok("改成 30 后 actual 更新", dayData().tasks[0].actual === 30, String(dayData().tasks[0].actual));
ok("  → 仍是已完成状态", dayData().tasks[0].done === true, "");
ok("  → 可支配随之 +30", freeMinOf(dayData()) === 180 - 30, "可支配=" + freeMinOf(dayData()));

// 取消打卡（点勾）应当直接还原，不该再弹耗时窗
dayData().tasks[0].done = false; save(); render();
ok("取消打卡后回到未完成", dayData().tasks[0].done === false, "");
ok("  → actual 保留着，便于再次打卡时参考", dayData().tasks[0].actual === 30, String(dayData().tasks[0].actual));
globalThis.__R = out;
`);
  results.push(...run(ctx, "__R"));
}

/* ============ 6. 空状态四种情况各说对话 ============ */
{
  const { ctx } = boot();
  run(ctx, `
const out = [];
const ok = (name, cond, extra) => out.push({ pass: !!cond, name, extra: extra || "" });
const note = () => $("suggList").innerHTML.replace(/<[^>]+>/g," ").replace(/\\s+/g," ").trim();
state.days = {}; state.date = todayStr();
dayData().fragments = [{ start:"19:00", end:"20:00" }];

state.backlog = []; save(); render(); suggest();
ok("① 事项池为空", /事项池还是空的/.test(note()), note());

state.backlog = [ ${H("A", "大工程", 120, "habit", 0, "null")} ]; save(); render(); suggest();
ok("② 时间不够放下最短的一件", /最短的一件也要/.test(note()), note());

state.backlog = [ ${H("B", "拉伸", 20, "habit", 0, "null")} ];
state.backlog[0].energy = "高"; energy = "低"; save(); render(); suggest();
ok("③ 精力不匹配", /换个精力档位/.test(note()), note());
energy = "高";

state.backlog = [ ${H("C", "跑步", 20, "habit", 0, "null")} ];
state.backlog[0].scene = "室外"; scene = "室内"; save(); render(); suggest();
ok("④ 环境不匹配", /换个精力档位|室外/.test(note()), note());
scene = "可外出";

// 池里的事项今天都排进计划了
state.backlog = [ ${H("D", "背单词", 20, "habit", 0, "null")} ];
dayData().tasks.push({ id:"t1", backlogId:"D", title:"背单词", min:20, done:false });
save(); render(); suggest();
ok("⑤ 今天都已经在今日计划里了", /都已经在今日计划里了/.test(note()), note());
globalThis.__R = out;
`);
  results.push(...run(ctx, "__R"));
}

/* ============ 7. 今日清空后的"恢复类"建议 ============ */
{
  const { ctx } = boot();
  run(ctx, `
const out = [];
const ok = (name, cond, extra) => out.push({ pass: !!cond, name, extra: extra || "" });
const txt = () => $("suggList").innerHTML.replace(/<[^>]+>/g," ").replace(/\\s+/g," ").trim();
const fromTier = (i, n) => { const got = restIdeas(n); const all = REST_TIERS[i].items.map(x => x.t);
                             return got.length === 2 && got.every(t => all.includes(t)); };
state.days = {}; state.date = todayStr(); state.backlog = [];
dayData().fragments = [{ start:"19:00", end:"20:00" }];   // 60 分钟空闲
dayData().tasks.push({ id:"t1", backlogId:null, title:"写周报", min:30, start:"19:00", end:"19:30", done:false });
save(); render(); suggest();
ok("没全部完成时不出现恢复建议块", !/今天的都做完了/.test(txt()), txt());

openActual(0); $("aMin").value = "20"; commitActual();   // 提前 10 分钟做完 → 盈余 10，可支配 60−20=40
suggest();
ok("全部完成后出现「今天的都做完了」", /今天的都做完了/.test(txt()), txt());
ok("  → 写出提前省下的 10m", /今天提前省下 10m/.test(txt()), txt());
ok("  → 写出今天的空闲还剩 40m", /空闲还剩 40m/.test(txt()), txt());
ok("  → 给出 2 条建议", lastSugg.rest.items.length === 2, JSON.stringify(lastSugg.rest.items));
ok("  → 40 分钟落在 25–45 档", lastSugg.rest.items.every(t => REST_TIERS[2].items.map(x=>x.t).includes(t)), JSON.stringify(lastSugg.rest.items));
ok("  → 纯建议，不给按钮", !/<button|data-sugg/.test($("suggList").innerHTML), $("suggList").innerHTML.slice(0,120));

// 分档边界
ok("8 分钟 → 第 1 档（≤10）",  fromTier(0, 8),   JSON.stringify(restIdeas(8)));
ok("10 分钟 → 第 1 档",        fromTier(0, 10),  JSON.stringify(restIdeas(10)));
ok("11 分钟 → 第 2 档（≤25）", fromTier(1, 11),  JSON.stringify(restIdeas(11)));
ok("25 分钟 → 第 2 档",        fromTier(1, 25),  JSON.stringify(restIdeas(25)));
ok("26 分钟 → 第 3 档（≤45）", fromTier(2, 26),  JSON.stringify(restIdeas(26)));
ok("45 分钟 → 第 3 档",        fromTier(2, 45),  JSON.stringify(restIdeas(45)));
ok("46 分钟 → 第 4 档（≤75）", fromTier(3, 46),  JSON.stringify(restIdeas(46)));
ok("75 分钟 → 第 4 档",        fromTier(3, 75),  JSON.stringify(restIdeas(75)));
ok("76 分钟 → 第 5 档（≤120）", fromTier(4, 76), JSON.stringify(restIdeas(76)));
ok("121 分钟 → 第 6 档（很长）", fromTier(5, 121), JSON.stringify(restIdeas(121)));

// 文案守门：不给用户下判断、不用"什么都不干"这类打发人的说法
ok("恢复类文案里没有打发人/下判断的说法",
   !REST_TIERS.some(t => t.items.some(i => /什么都不干|什么都不做|懒得|反正也/.test(i.t))),
   REST_TIERS.flatMap(t => t.items.map(i => i.t)).filter(t => /什么都不干|什么都不做|懒得|反正也/.test(t)).join(" | "));
ok("每一档至少 2 条备选", REST_TIERS.every(t => t.items.length >= 2), REST_TIERS.map(t => t.items.length).join(","));

// 场景 / 精力只筛选、不写进文案
energy = "低";
ok("精力低时不推「骑车」这种高精力项", !restIdeas(100).includes("骑车或者走远一点，去个平时不去的地方"), JSON.stringify(restIdeas(100)));
energy = "高";
scene = "室内";
ok("环境=室内时不推「出门散散步」", !restIdeas(30).includes("出门散散步，别戴耳机，听听外面的声音"), JSON.stringify(restIdeas(30)));
scene = "可外出";

// 边界：排满且没省下时间
state.days = {}; state.date = todayStr();
dayData().fragments = [{ start:"19:00", end:"19:30" }];
dayData().tasks.push({ id:"t1", backlogId:null, title:"写周报", min:30, start:"19:00", end:"19:30", done:false });
save(); render();
openActual(0); $("aMin").value = "30"; commitActual(); suggest();
ok("时间刚好用满：说「时间刚好用满」且不提提前省下", /时间刚好用满/.test(txt()) && !/提前省下/.test(txt()), txt());
ok("  → 一条建议都不给", lastSugg.rest.items.length === 0, JSON.stringify(lastSugg.rest.items));

// 边界：没省下时间，但今天本来就没排满
state.days = {}; state.date = todayStr();
dayData().fragments = [{ start:"19:00", end:"20:30" }];   // 90 分钟
dayData().tasks.push({ id:"t1", backlogId:null, title:"写周报", min:30, start:"19:00", end:"19:30", done:false });
save(); render();
openActual(0); $("aMin").value = "30"; commitActual(); suggest();
ok("没省时间但有空闲：只写「空闲还剩 1h」", /空闲还剩 1h/.test(txt()) && !/提前省下/.test(txt()), txt());
ok("  → 仍然给出建议（60 分钟 → 第 4 档）", lastSugg.rest.items.every(t => REST_TIERS[3].items.map(x=>x.t).includes(t)), JSON.stringify(lastSugg.rest.items));

// 与事项池建议并列
state.days = {}; state.date = todayStr();
state.backlog = [ ${H("P", "练字", 20, "habit", 0, "null")} ];
dayData().fragments = [{ start:"19:00", end:"20:00" }];
dayData().tasks.push({ id:"t1", backlogId:null, title:"写周报", min:20, done:true, actual:10 });
save(); render(); suggest();
ok("全部完成 + 池里还有事：两层建议并列", /sugg-card/.test($("suggList").innerHTML) && /今天的都做完了/.test(txt()), "");
globalThis.__R = out;
`);
  results.push(...run(ctx, "__R"));
}

/* ============ 8. 时间口径：不能声称自己还拥有已经过去的时间 ============ */
{
  const { ctx } = boot();
  run(ctx, `
const out = [];
const ok = (name, cond, extra) => out.push({ pass: !!cond, name, extra: extra || "" });
const txt = () => $("suggList").innerHTML.replace(/<[^>]+>/g," ").replace(/\\s+/g," ").trim();

/* 复刻你截图那天的日内状态：整天空闲 935 分钟，5 条任务上午全做完，实际共 170 分钟 */
state.days = {}; state.date = todayStr(); state.backlog = [];
dayData().fragments = [{ start:"06:25", end:"22:00" }];
dayData().tasks = [
  { id:"t1", backlogId:null, title:"英语",    min:20, start:"06:25", end:"06:45", done:true, actual:0  },
  { id:"t2", backlogId:null, title:"CTF-Web", min:60, start:"06:45", end:"07:45", done:true, actual:60 },
  { id:"t3", backlogId:null, title:"全栈",    min:60, start:"07:45", end:"08:45", done:true, actual:60 },
  { id:"t4", backlogId:null, title:"健身",    min:30, start:"08:45", end:"09:15", done:true, actual:20 },
  { id:"t5", backlogId:null, title:"法学",    min:30, start:"09:15", end:"09:45", done:true, actual:30 },
];
save(); render();

clock.h = 10; clock.m = 0;
ok("上午 10:00：裁到从现在到熄灯 = 12h", freeMinOf(dayData()) === 720, "可支配=" + freeMinOf(dayData()));
clock.h = 21; clock.m = 0;
ok("晚上 21:00：只剩 1h，不再自称还有 12h45m", freeMinOf(dayData()) === 60, "可支配=" + freeMinOf(dayData()));
suggest();
ok("  → 档位跟着落到 45–75 档（读书 / 纪录片）",
   lastSugg.rest.items.every(t => REST_TIERS[3].items.map(x => x.t).includes(t)), JSON.stringify(lastSugg.rest.items));
ok("  → 文案写出「今天的空闲还剩 1h」", /空闲还剩 1h/.test(txt()), txt());
clock.h = 23; clock.m = 0;
ok("过了熄灯：可支配归 0", freeMinOf(dayData()) === 0, "可支配=" + freeMinOf(dayData()));
suggest();
ok("  → 不再硬给建议，只说时间用满", lastSugg.rest.items.length === 0 && /时间刚好用满/.test(txt()), txt());

/* 排程也不许排到已经过去的时间段 */
state.days = {}; state.date = todayStr();
dayData().fragments = [{ start:"06:25", end:"22:00" }];
save(); render();
clock.h = 21; clock.m = 0;
const slots = freeSlots();
ok("21:00 只给出此刻之后的空档（21:00–22:00）",
   slots.length === 1 && slots[0].start === "21:00" && slots[0].end === "22:00", JSON.stringify(slots));
state.backlog = [{ id:"Z", name:"拉伸", desc:"", cat:"自定义", min:20, energy:"高", scene:"不限",
                   type:"habit", deadline:null, interval:1, lastDone:null }];
importTasks([state.backlog[0]]);
const z = dayData().tasks.find(t => t.backlogId === "Z");
ok("  → 导入排到 21:00，而不是排回早上", !!z && z.start === "21:00", z ? z.start + "–" + z.end : "没排进去");
clock.h = 23; clock.m = 0;
ok("23:00 已无空档可排（导入会变成待排）", freeSlots().length === 0, JSON.stringify(freeSlots()));

/* 凌晨不裁剪：还没到的空闲该全算进来 */
state.days = {}; state.date = todayStr();
dayData().fragments = [{ start:"06:25", end:"22:00" }];
save(); render();
clock.h = 5; clock.m = 0;
ok("凌晨 5:00：全天 935 分钟都算未来空闲", freeMinOf(dayData()) === 935, "可支配=" + freeMinOf(dayData()));
globalThis.__R = out;
`);
  results.push(...run(ctx, "__R"));
}

/* ---------- 报告 ---------- */
let failed = 0;
console.log("「空余时间建议」验收\n");
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.extra ? "   [" + r.extra + "]" : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
