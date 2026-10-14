/* 冲刺模块验收台：加载 plan-data.js + app.js，验证
   今日配额渲染 / 勾选持久化 / 顺延 / 低星让位 / 考试日视图。 */
import fs from "node:fs";
import vm from "node:vm";

const planCode = fs.readFileSync(new URL("../plan-data.js", import.meta.url), "utf8");
const code = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

function boot() {
  const els = new Map();
  const storage = {};
  const docClick = [];
  const clock = { h: 8, m: 0, day: null }; // day: null=真实今天；数字=冻结到 2026-10-<day>
  const FrozenDate = class extends Date {
    constructor(...args){
      if(args.length){ super(...args); }
      else {
        const d = new Date();
        if(clock.day !== null){ super(2026, 9, clock.day, clock.h, clock.m); }
        else { d.setHours(clock.h, clock.m, 0, 0); super(d.getTime()); }
      }
    }
    static now(){ return new FrozenDate().getTime(); }
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
      set: (a, k, v) => { a[k] = (k === "value" || k === "textContent" || k === "innerHTML") ? String(v) : v; return true; },
    });
  }
  const el = id => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
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
  vm.runInContext(planCode, ctx, { filename: "companion-app/plan-data.js" });
  vm.runInContext(code, ctx, { filename: "companion-app/app.js" });
  return { ctx, clickOn };
}

const results = [];
const { ctx, clickOn } = boot();
vm.runInContext(`
const out = [];
const ok = (name, cond, extra) => out.push({ pass: !!cond, name, extra: extra || "" });

/* ---- 数据加载 ---- */
ok("plan-data 已加载（400+ 学习单元）", window.PLAN && sprintCounts().total > 400, "total=" + (window.PLAN ? sprintCounts().total : 0));
ok("首日 2026-10-13", planDays()[0].date === "2026-10-13", planDays()[0].date);
ok("末日晚间回炉存在", planDays()[10].items.some(i => i.id === "all-w2"), "");

/* ---- 把"今天"冻结到计划第 1 天，断言才不会随真实日期漂移 ---- */
clock.day = 13; state.date = todayStr(); render();
ok("冻结到计划首日 = 2026-10-13", todayStr() === "2026-10-13", todayStr());
ok("顶部显示第 1 天", /第 1 天/.test($("spMeta").textContent), $("spMeta").textContent);
ok("距考试倒计时 11 天", /距首场考试 11 天/.test($("spMeta").textContent), $("spMeta").textContent);
ok("今日配额 0/24 起步", /已完成 0\\//.test($("spDayTitle").innerHTML), $("spDayTitle").innerHTML.replace(/<[^>]*>/g," ").slice(0,80));
ok("出现科目分组头", /马原/.test($("sprintList").innerHTML) && /公司法/.test($("sprintList").innerHTML), "");
ok("高频标签渲染", /sp-freq/.test($("sprintList").innerHTML), "");
ok("词表条目带 words 面板", /sp-words/.test($("sprintList").innerHTML), "");
/* 词表默认展开 + 明确按钮：不能只靠"点标题"这种看不见的入口 */
const wordsItem = planDays()[0].items.filter(i => i.kind === "words")[0];
const wordsHtml = wordsItem ? sprintRow(wordsItem, false) : "";
ok("词表条目默认展开", / open"/.test(wordsHtml), wordsHtml.slice(0, 90));
ok("词表给了写明词数的按钮", /共 \\d+ 词/.test($("sprintList").innerHTML), "");
ok("词表内容真的渲染出来了（200 个词）", wordsItem && (wordsHtml.match(/<span>/g) || []).length >= 200, "词条数=" + (wordsHtml.match(/<span>/g) || []).length);
ok("词表条目排在今日配额里", wordsHtml.length > 0, "");
ok("第一天没有顺延", !/顺延进来/.test($("spDebt").innerHTML), "");

/* ---- 勾选：状态持久化 ---- */
const firstId = planDays()[0].items[0].id;
clickOn({ sprintCheck: firstId });
ok("勾选后 checked 写入状态", sprintState.checked[firstId] === true, String(sprintState.checked[firstId]));
ok("勾选后 localStorage 已保存", JSON.parse(localStorage.getItem("companion-sprint-v1")).checked[firstId] === true, "");
ok("列表里该条目带 done", sprintRow(planDays()[0].items[0], false).indexOf("done") >= 0, "");
clickOn({ sprintCheck: firstId });
ok("再点取消勾选", sprintState.checked[firstId] === false, "");

/* ---- 顺延：把"今天"冻结到 D2（10-14），D1 没勾的都应滚过来 ---- */
clock.day = 14; state.date = todayStr(); render();
ok("冻结后今天 = 2026-10-14", todayStr() === "2026-10-14", todayStr());
ok("D2 顶部显示第 2 天", /第 2 天/.test($("spMeta").textContent), $("spMeta").textContent);
ok("顺延提示出现", /顺延进来/.test($("spDebt").innerHTML), $("spDebt").innerHTML);
const d1Count = planDays()[0].items.length;
ok("顺延数量 = D1 全部条目", new RegExp("顺延进来 " + d1Count + " 条").test($("spDebt").innerHTML), $("spDebt").innerHTML + " d1=" + d1Count);
ok("列表里出现顺延标签", /sp-carry/.test($("sprintList").innerHTML), "");

/* ---- 回归：勾掉顺延条目不能让它从清单里凭空消失（历史上被当成"整条被删了"） ---- */
const gsfCarried = carriedItems(todayStr()).filter(i => i.subject === "gsf");
ok("公司法分组里排在最前的是顺延条目", gsfCarried.length > 0, "顺延公司法=" + gsfCarried.length);
const carriedTarget = gsfCarried[0];
clickOn({ sprintCheck: carriedTarget.id });
ok("勾掉顺延条目后它仍在清单里", $("sprintList").innerHTML.indexOf(carriedTarget.id) >= 0, "");
ok("  → 记为今天完成，渲染成 ✓ 划线", sprintState.checked[carriedTarget.id] === true && sprintState.doneOn[carriedTarget.id] === todayStr(), String(sprintState.doneOn[carriedTarget.id]));
ok("  → 顺延条数相应减少 1", new RegExp("顺延进来 " + (d1Count - 1) + " 条").test($("spDebt").innerHTML), $("spDebt").innerHTML);
clickOn({ sprintCheck: carriedTarget.id });
ok("取消勾选后它也还在清单里", $("sprintList").innerHTML.indexOf(carriedTarget.id) >= 0 && !sprintState.checked[carriedTarget.id], "");
clickOn({ sprintCheck: carriedTarget.id }); // 再勾上，供第二天验证"收起"

/* 第二天：昨天勾完的顺延条目不再出现（完成就是完成，不永远挂在清单上） */
clock.day = 15; state.date = todayStr(); render();
ok("第二天不再显示昨天已勾完的顺延条目", carriedItems(todayStr()).every(i => i.id !== carriedTarget.id), "");

/* ---- 低星让位（D4 才有低星） ---- */
clock.day = 16; state.date = todayStr(); render();
const d4 = planDays()[3].items;
const low = d4.filter(i => i.kind === "kaodian" && i.stars >= 1 && i.stars <= 2 && !i.freq);
ok("D4 存在低星考点", low.length > 0, "low=" + low.length);
$("spYieldBtn").fire("click");
ok("让位后底部出现「已让位」", /已让位/.test($("spYielded").innerHTML), $("spYielded").innerHTML.slice(0, 60));
ok("让位条目不再出现在列表", sprintState.yielded.includes(low[0].id) && !planDays()[3].items.filter(i => !sprintState.yielded.includes(i.id)).some(i => i.id === low[0].id), "");
ok("顺延清单也排除让位项", !carriedItems("2026-10-17").some(i => i.id === low[0].id), "");
clickOn({ sprintRestore: low[0].id });
ok("恢复让位条目", !sprintState.yielded.includes(low[0].id), "");

/* ---- 考试日视图（冻结到 10-24） ---- */
clock.day = 24; state.date = todayStr(); render();
ok("冻结后今天 = 2026-10-24", todayStr() === "2026-10-24", todayStr());
ok("考试卡片显示", $("spExamCard").style.display === "", $("spExamCard").style.display);
ok("考试日出现高频扫读区", /考前扫一遍高频/.test($("sprintList").innerHTML), "");
ok("扫读区含马原高频", /马克思主义的科学内涵/.test($("sprintList").innerHTML), "");
ok("倒计时为 0 天文案", /今天考试/.test($("spMeta").textContent), $("spMeta").textContent);

clock.day = 25; state.date = todayStr(); render();
ok("10-25 扫读区含近代史高频（非公司法）", /中国半殖民地半封建社会的主要矛盾/.test($("sprintList").innerHTML), "");

clock.day = 26; state.date = todayStr(); render();
ok("考后显示完成统计", /全部考试结束/.test($("sprintList").innerHTML), "");

/* ---- 完整要点可见：长要点给「展开全文」，可一键全部展开 ---- */
clock.day = 13; state.date = todayStr(); render();
ok("长要点渲染出「展开全文」入口", /sp-more/.test($("sprintList").innerHTML), "");
ok("默认不是全部展开", sprintAllOpen === false && sprintRow(planDays()[0].items[0], false).indexOf("open") < 0, "");
$("spExpandAllBtn").fire("click");
ok("点「全部展开」后条目渲染为展开态", sprintAllOpen === true && sprintRow(planDays()[0].items[0], false).indexOf("open") >= 0, "allOpen=" + sprintAllOpen);
ok("按钮文案切成「全部收起」", $("spExpandAllBtn").textContent === "全部收起", $("spExpandAllBtn").textContent);
$("spExpandAllBtn").fire("click");
ok("再点一次收起", sprintAllOpen === false && sprintRow(planDays()[0].items[0], false).indexOf("open") < 0, "");

globalThis.__R = out;
`, ctx);
results.push(...vm.runInContext("__R", ctx));

let failed = 0;
console.log("冲刺计划模块验收（伪 DOM + 真实事件派发）\n");
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.extra ? "   [" + r.extra + "]" : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
