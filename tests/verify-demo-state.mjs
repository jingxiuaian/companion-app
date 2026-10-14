/* 临时验收台（跑完可删）：验证 演示数据-一键填充.js 真的能产出可录制的状态。
   分别模拟"早上 6 点录"和"下午 3 点录"，因为空闲碎片和排程会随时钟变。 */
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const snippet = fs.readFileSync(new URL("./演示数据-一键填充.js", import.meta.url), "utf8");

function boot(h, m) {
  const els = new Map(), storage = {};
  const clock = { h, m };
  const FrozenDate = class extends Date {
    constructor(...args){
      if(args.length){ super(...args); }
      else { const d = new Date(); d.setHours(clock.h, clock.m, 0, 0); super(d.getTime()); }
    }
    static now(){ const d = new Date(); d.setHours(clock.h, clock.m, 0, 0); return d.getTime(); }
  };
  const el = id => {
    if (!els.has(id)) {
      const o = { id, value: "", textContent: "", innerHTML: "", placeholder: "", disabled: false, style: {}, dataset: {}, children: [] };
      o.classList = { add(){}, remove(){}, toggle(){}, contains: () => false };
      o.addEventListener = () => {};
      o.querySelectorAll = () => [];
      o.focus = () => {};
      els.set(id, new Proxy(o, { get: (a,k) => a[k], set: (a,k,v) => { a[k] = (k==="value"||k==="textContent"||k==="innerHTML") ? String(v) : v; return true; } }));
    }
    return els.get(id);
  };
  const sandbox = {
    console, setTimeout, clearTimeout, Date: FrozenDate, clock,
    localStorage: { getItem: k => (k in storage ? storage[k] : null), setItem: (k,v) => { storage[k] = String(v); }, removeItem: k => { delete storage[k]; } },
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, body: { dataset: {} } },
    navigator: {}, confirm: () => true, alert: () => {},
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, { filename: "app.js" });
  return ctx;
}

let failed = 0;
const check = (pass, name, extra) => { if(!pass) failed++; console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? "   [" + extra + "]" : ""}`); };

for (const [h, m, label] of [[6, 0, "早上 06:00 录制"], [15, 0, "下午 15:00 录制"]]) {
  const ctx = boot(h, m);
  vm.runInContext(snippet, ctx, { filename: "演示数据-一键填充.js" });
  const r = vm.runInContext(`(() => {
    const d = dayData();
    return {
      frags: d.fragments.map(f => f.start + "–" + f.end + " " + fragMin(f) + "m"),
      tasks: d.tasks.map(t => t.title + "｜" + (t.start ? t.start + "–" + t.end : "时间未定") + "｜" + (t.done ? "已完成 实际" + t.actual + "m/预计" + t.min + "m" : "未完成")),
      undone: d.tasks.filter(t => !t.done).length,
      noSlot: d.tasks.filter(t => !t.start).length,
      backpack: state.backlog.length,
      notes: state.notes.length,
      free: fmtDur(freeMinOf(d)),
      groups: [...new Set(state.schedule.map(s => bucketOf(s.days)))].join(" / "),
      futureSlots: freeSlots().map(s => s.start + "–" + s.end).join("、"),
      rest: (suggest(), lastSugg.rest ? lastSugg.rest.items.length : -1),
      restTxt: $("suggList").innerHTML.replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim().slice(0, 120),
      pool: $("backlogList").innerHTML.replace(/<[^>]+>/g, " ").replace(/\\s+/g, " "),
      poolLine: ($("backlogList").innerHTML.match(/习惯 · \\d+ 天没做/g) || []).join("、"),
      pool2: lastSugg.singles.map(c => c.item.name).join("、"),
    };
  })()`, ctx);

  console.log(`\n===== ${label} =====`);
  console.log("  空闲碎片  : " + r.frags.join(" | "));
  console.log("  今日任务  : " + r.tasks.join("\n              "));
  console.log("  可支配    : " + r.free + "   还没排的空档: " + r.futureSlots);
  console.log("  作息分组  : " + r.groups + "   事项池 " + r.backpack + " 条   笔记 " + r.notes + " 条");

  check(r.frags.length >= 3, `${label}：至少有 3 个空闲碎片`, r.frags.length + " 个");
  check(r.tasks.length === 4, `${label}：今日计划 4 条（含自动接回的过期习惯）`, r.tasks.length + " 条");
  check(r.undone === 2, `${label}：留 2 条未完成给镜头打卡`, r.undone + " 条未完成");
  check(r.noSlot === 0, `${label}：4 条任务都排好了时间段`, r.noSlot + " 条没时间");
  check(r.tasks.filter(t => t.includes("已完成")).length === 2, `${label}：2 条已完成，带「实际 vs 预计」`);
  check(r.backpack === 7 && r.notes === 2, `${label}：事项池 7 条 + 笔记 2 条`);
  check(/work/.test(r.groups) && /rest/.test(r.groups), `${label}：作息的"工作日 / 休息日"分组都有内容`, r.groups);
  check(/3 天没做/.test(r.pool) && /还没开始/.test(r.pool),
        `${label}：事项池能看到「断了 3 天」和「还没开始」两种状态`, r.poolLine);
  check(/剪参赛视频|专升本英语真题/.test(r.pool2) && !/英语单词|法学网课|CTF-Web|读</.test(r.pool2),
        `${label}：建议卡只推"今天还没安排"的那几条`, r.pool2);
}

/* 最后一步：把剩下的那条做掉，恢复类建议该出现（这是录制时的收尾镜头） */
const ctx = boot(15, 0);
vm.runInContext(snippet, ctx, { filename: "演示数据-一键填充.js" });
const finalStep = vm.runInContext(`(() => {
  for(let guard = 0; guard < 10; guard++){
    const i = dayData().tasks.findIndex(t => !t.done);
    if(i < 0) break;
    openActual(i); $("aMin").value = "20"; commitActual();
  }
  suggest();
  return { allDone: dayData().tasks.every(t => t.done), free: fmtDur(freeMinOf(dayData())),
           hasRest: /今天的都做完了/.test($("suggList").innerHTML),
           txt: $("suggList").innerHTML.replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim().slice(0, 150) };
})()`, ctx);
console.log("\n===== 收尾镜头：打卡最后一条 → 点「给我一点建议」 =====");
console.log("  " + finalStep.txt);
check(finalStep.allDone, "全部完成");
check(finalStep.hasRest, "出现了「今天的都做完了」恢复类建议块");

console.log(`\n${failed ? failed + " 条不通过" : "全部通过"}`);
process.exit(failed ? 1 : 0);
