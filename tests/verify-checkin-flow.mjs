/* 临时验收台（跑完可删）：把「点勾 → 完成打卡弹窗 → 填耗时 → 提交」这条链路真跑一遍。
   比前两个测试台更接近真实：元素会记录事件监听、classList 有状态、能派发事件，
   所以能验"监听器有没有挂上""属性名对不对得上"这类接线问题。
   仍然差两样：不解析 innerHTML（用属性契约代替）、不跑 CSS 与布局。 */
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

function boot() {
  const els = new Map();
  const storage = {};
  const docClick = [];
  /* 冻结"现在几点"，让可支配时长的断言可复现 */
  const clock = { h: 6, m: 0 };
  const FrozenDate = class extends Date {
    constructor(...args){
      if(args.length){ super(...args); }
      else { const d = new Date(); d.setHours(clock.h, clock.m, 0, 0); super(d.getTime()); }
    }
    static now(){ const d = new Date(); d.setHours(clock.h, clock.m, 0, 0); return d.getTime(); }
  };

  function makeEl(id) {
    const handlers = {};
    const classes = new Set();
    const o = {
      id, value: "", textContent: "", innerHTML: "", placeholder: "", disabled: false,
      style: {}, dataset: {}, children: [],
      classList: {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle: (c, on) => { const want = (on === undefined) ? !classes.has(c) : on; want ? classes.add(c) : classes.delete(c); },
        contains: c => classes.has(c),
      },
      addEventListener: (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); },
      fire: (t, ev) => (handlers[t] || []).forEach(fn => fn(Object.assign({ target: o }, ev || {}))),
      querySelectorAll: () => [],
      focus: () => {},
    };
    return new Proxy(o, {
      get: (a, k) => a[k],
      // 真 DOM 里这几个属性赋值会被强制转成字符串，这里照做
      set: (a, k, v) => { a[k] = (k === "value" || k === "textContent" || k === "innerHTML") ? String(v) : v; return true; },
    });
  }
  const el = id => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };

  /* 造一个最小元素，按 data-* 属性实现 closest()，再派发到 document 的 click 委托上 */
  function clickOn(attrs) {
    const target = {
      dataset: attrs,
      closest(sel) {
        const m = /^\[data-([a-z-]+)\]$/.exec(sel);
        if (!m) return null;
        const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return (key in attrs) ? target : null;
      },
    };
    docClick.forEach(fn => fn({ target }));
  }

  const sandbox = {
    console, setTimeout, clearTimeout, clickOn, Date: FrozenDate, clock,
    localStorage: {
      getItem: k => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: k => { delete storage[k]; },
    },
    document: {
      getElementById: el,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: (t, fn) => { if (t === "click") docClick.push(fn); },
      body: { dataset: {} },
    },
    navigator: {}, confirm: () => true, alert: () => {},
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, { filename: "companion-app/app.js" });
  return { ctx, clickOn };
}

const results = [];
const { ctx, clickOn } = boot();
vm.runInContext(`
const out = [];
const ok = (name, cond, extra) => out.push({ pass: !!cond, name, extra: extra || "" });
state.days = {}; state.date = todayStr();
state.backlog = [{ id:"R", name:"读书一小时", desc:"", cat:"自定义", min:60, energy:"高", scene:"不限",
                   type:"habit", deadline:null, interval:1, lastDone:"2020-01-01" }];
dayData().fragments = [{ start:"19:00", end:"22:00" }];
dayData().tasks.push({ id:"t1", backlogId:"R", title:"读书一小时", min:60, start:"19:00", end:"20:00", done:false });
save(); render();

/* ---- 渲染层与委托处理器之间的"接线契约" ---- */
const taskHtml = $("taskList").innerHTML;
ok("勾选框渲染出 data-check，委托处理器才认得到", /class="cb" data-check="0"/.test(taskHtml), taskHtml.slice(0, 110));
ok("未完成的任务不显示可点的耗时标签", !/data-actual="0"/.test(taskHtml), "");

/* ---- 点勾：应当弹窗，而不是直接完成 ---- */
ok("点勾前弹窗是关的", !$("mActual").classList.contains("on"), "");
clickOn({ check:"0" });
ok("点勾后弹窗打开", $("mActual").classList.contains("on"), "");
ok("  → 标题「完成打卡：「读书一小时」」", /^完成打卡：「读书一小时」$/.test($("aTitle").textContent), $("aTitle").textContent);
ok("  → 输入框空着（强制填写）", $("aMin").value === "", JSON.stringify($("aMin").value));
ok("  → 「完成打卡」按钮禁用", $("mActualOk").disabled === true, "");
ok("  → 任务还没被标记完成", dayData().tasks[0].done === false, "");

/* ---- 取消：什么都不该变 ---- */
$("mActualCancel").fire("click");
ok("点取消后弹窗关闭", !$("mActual").classList.contains("on"), "");
ok("  → 任务仍未完成", dayData().tasks[0].done === false, "");
ok("  → 也没写入 actual", dayData().tasks[0].actual === undefined, String(dayData().tasks[0].actual));

/* ---- 再点勾，走真实 input 事件 ---- */
clickOn({ check:"0" });
$("aMin").value = "45"; $("aMin").fire("input");
ok("填 45 后按钮启用（input 监听真的挂上了）", $("mActualOk").disabled === false, "");
$("aMin").value = ""; $("aMin").fire("input");
ok("清空后按钮重新禁用", $("mActualOk").disabled === true, "");
$("aQuick").fire("click");
ok("「就按预计」填入 60", $("aMin").value === "60", $("aMin").value);
$("aMin").value = "45"; $("aMin").fire("input");

/* ---- 提交 ---- */
$("mActualOk").fire("click");
ok("提交后弹窗自动关闭", !$("mActual").classList.contains("on"), "");
ok("  → 任务标记完成", dayData().tasks[0].done === true, "");
ok("  → actual 记为 45", dayData().tasks[0].actual === 45, String(dayData().tasks[0].actual));
ok("  → 可支配 = 180−45 = 135", freeMinOf(dayData()) === 135, "可支配=" + freeMinOf(dayData()));
ok("  → toast 报出省下的 15m", /省下 15m/.test($("toast").textContent), $("toast").textContent);
ok("  → 事项池 lastDone 更新为今天", state.backlog[0].lastDone === todayStr(), String(state.backlog[0].lastDone));
ok("  → 任务行出现可点的耗时标签", /data-actual="0"/.test($("taskList").innerHTML), "");
ok("  → 任务行显示实际区间 19:00–19:45", /19:00–19:45/.test($("taskList").innerHTML), $("taskList").innerHTML.replace(/\\s+/g," ").slice(0,150));

/* ---- 点已完成任务的耗时标签：只改数字 ---- */
clickOn({ actual:"0" });
ok("点耗时标签能打开弹窗", $("mActual").classList.contains("on"), "");
ok("  → 标题「修改实际耗时」", /^修改实际耗时：「读书一小时」$/.test($("aTitle").textContent), $("aTitle").textContent);
ok("  → 预填当前 actual 45", $("aMin").value === "45", $("aMin").value);
$("aMin").value = "60"; $("aMin").fire("input");
$("mActualOk").fire("click");
ok("改完仍是已完成状态", dayData().tasks[0].done === true, "");
ok("  → actual 更新为 60，可支配回到 120", dayData().tasks[0].actual === 60 && freeMinOf(dayData()) === 120, "actual=" + dayData().tasks[0].actual + " 可支配=" + freeMinOf(dayData()));

/* ---- 点勾 = 取消打卡，不该弹窗 ---- */
clickOn({ check:"0" });
ok("点勾取消打卡：任务回到未完成", dayData().tasks[0].done === false, "");
ok("  → 没有弹窗（取消打卡不需要报耗时）", !$("mActual").classList.contains("on"), "");
ok("  → actual 保留着，再次打卡可参考", dayData().tasks[0].actual === 60, String(dayData().tasks[0].actual));

/* ---- 全部完成 → 恢复类建议区块真的渲染出来 ---- */
clickOn({ check:"0" });
$("aMin").value = "30"; $("aMin").fire("input"); $("mActualOk").fire("click");
suggest();
ok("走完整链路后出现「今天的都做完了」", /今天的都做完了/.test($("suggList").innerHTML), "");
ok("  → 写着提前省下的 30m", /今天提前省下 30m/.test($("suggList").innerHTML), "");

globalThis.__R = out;
`, ctx);
results.push(...vm.runInContext("__R", ctx));

let failed = 0;
console.log("「完成打卡」交互链路验收（伪 DOM + 真实事件派发）\n");
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.extra ? "   [" + r.extra + "]" : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
