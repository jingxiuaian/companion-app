/* 验收台：本地反馈模块（app.js 的反馈段）
   重点：① 报告里绝不出现用户输入的文字，只出现数量 ② 报错会被记下来、最多留 5 条、可持久化
        ③ 三个出口（复制 / 存文件 / GitHub issue）拼得对 ④ 入口与兜底条的接线
   用伪 DOM 直接执行 ../app.js，不需要浏览器、不修改项目文件。 */
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

function boot(storage0 = {}) {
  const els = new Map(), storage = { ...storage0 }, winH = {}, made = [];
  let copied = null, openedUrl = null;

  function makeEl(id) {
    const handlers = {};
    const o = {
      id, value: "", textContent: "", innerHTML: "", placeholder: "", disabled: false, href: "", download: "",
      style: {}, dataset: {}, children: [],
      classList: {
        _s: new Set(),
        add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
        toggle(c, on){ const w = (on === undefined) ? !this._s.has(c) : on; w ? this._s.add(c) : this._s.delete(c); },
        contains(c){ return this._s.has(c); },
      },
      addEventListener(t, fn){ (handlers[t] = handlers[t] || []).push(fn); },
      fire(t, ev){ (handlers[t] || []).forEach(fn => fn(Object.assign({ target: o }, ev || {}))); },
      select(){}, focus(){}, click(){}, querySelectorAll: () => [],
    };
    return new Proxy(o, { get: (a,k) => a[k], set: (a,k,v) => { a[k] = (k==="value"||k==="textContent"||k==="innerHTML") ? String(v) : v; return true; } });
  }
  const el = id => { if(!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };

  const sandbox = {
    console, setTimeout, clearTimeout, innerWidth: 390, innerHeight: 844,
    screen: { width: 390, height: 844 },
    Blob: class { constructor(parts){ this.parts = parts; } },
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
    localStorage: { getItem: k => (k in storage ? storage[k] : null), setItem: (k,v) => { storage[k] = String(v); },
                    removeItem: k => { delete storage[k]; } },
    document: {
      getElementById: el,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      createElement: tag => { const e = makeEl("new-" + tag); made.push(e); return e; },
      execCommand: () => true,
      body: { dataset: {}, appendChild(){}, removeChild(){} },
    },
    navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
                 onLine: true, clipboard: { writeText: t => { copied = t; return Promise.resolve(); } } },
    confirm: () => true, alert: () => {},
  };
  sandbox.window = sandbox;   // 应用里用 window.xxx
  sandbox.window.addEventListener = (t, fn) => { (winH[t] = winH[t] || []).push(fn); };
  sandbox.window.matchMedia = () => ({ matches: false });
  sandbox.window.open = url => { openedUrl = url; return {}; };
  sandbox.window.location = { href: "" };   // 用来接住 mailto: 跳转

  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, { filename: "app.js" });
  return {
    ctx, els, storage, el,
    fireWin: (t, ev) => (winH[t] || []).forEach(fn => fn(ev || {})),
    getCopied: () => copied, getOpened: () => openedUrl, made,
    getLoc: () => sandbox.window.location.href,
  };
}

const results = [];
const ok = (name, cond, extra) => results.push([!!cond, name, extra || ""]);
const run = (ctx, src) => vm.runInContext(src, ctx, { filename: "acceptance.js" });

/* ============ 1. 隐私红线 + 报告结构 ============ */
{
  const h = boot();
  run(h.ctx, `
state.days = {}; state.date = todayStr();
state.backlog = [{ id:"b1", name:"绝密计划名XYZ", desc:"", cat:"自定义", min:20, energy:"高", scene:"不限",
                   type:"habit", deadline:null, interval:1, lastDone:null }];
state.notes = [{ id:"n1", type:"note", text:"我的私密笔记内容ABC", done:false, ts: Date.now() }];
dayData().fragments = [{ start:"19:00", end:"20:00" }];
dayData().tasks = [{ id:"t1", backlogId:"b1", title:"绝密计划名XYZ", min:20, done:false }];
save(); render();
globalThis.__report = buildReport("我在冲刺页点了全部展开，页面卡了一下");
globalThis.__name = reportFileName();
globalThis.__issue = issueUrl("卡住了 & 试试", "报告正文");
`);
  const r = run(h.ctx, "__report");
  const name = run(h.ctx, "__name");
  const issue = run(h.ctx, "__issue");

  ok("报告里不含事项名（只报数量）", !r.includes("绝密计划名XYZ"), r.includes("绝密计划名XYZ") ? "泄露了！" : "");
  ok("报告里不含笔记正文", !r.includes("我的私密笔记内容ABC"), "");
  ok("报告里给的是数量", /事项池 1 条/.test(r) && /今日任务 1 条（已完成 0）/.test(r) && /笔记 1 条/.test(r), "");
  ok("报告带版本号", /版本：v5/.test(r), (r.match(/版本：\S+/) || [])[0]);
  ok("报告带环境行", /环境：Chrome 130 \/ Windows/.test(r), (r.match(/环境：.*/) || [])[0]);
  ok("报告带设置行", /设置：主题/.test(r), "");
  ok("报告带用户描述", /我在冲刺页点了全部展开，页面卡了一下/.test(r), "");
  ok("报告有自动诊断标记", r.includes("--- 自动诊断（可以删掉这里面任何一行）---") && r.includes("--- 自动诊断结束 ---"), "");
  ok("没报错时写明「最近报错：无」", /最近报错：无/.test(r), "");
  ok("文件名形如 陪伴-计划-反馈-YYYYMMDD-HHMM.txt", /^陪伴-计划-反馈-\d{8}-\d{4}\.txt$/.test(name), name);
  ok("issue 链接指向本仓库的 new issue", issue.startsWith("https://github.com/jingxiuaian/companion-app/issues/new?"), issue.slice(0, 70));
  ok("issue 正文做了 URL 编码（& 不再是裸的）", !/[\?&]body=[^&]*&[^=]/.test(issue.split("body=")[1] || "") || issue.includes("%26"), "");
  ok("issue 标题带上了用户描述", issue.includes(encodeURIComponent("反馈：卡住了 & 试试")), "");
}

/* ============ 2. 报错收集：上限、持久化、兜底条 ============ */
{
  const h = boot();
  h.fireWin("error", { message: "TypeError: 炸了", filename: "https://x/app.js", lineno: 42 });
  h.fireWin("unhandledrejection", { reason: { message: "Promise 也炸了" } });
  run(h.ctx, `globalThis.__r = buildReport("");`);
  const r = run(h.ctx, "__r");
  ok("window error 会被记进报告", /app\.js:42 · TypeError: 炸了/.test(r), (r.match(/\d\) .*/g) || []).join(" | "));
  ok("未处理的 Promise 也会被记", /未处理的 Promise：Promise 也炸了/.test(r), "");
  ok("出错时兜底条显示出来", h.el("errBar").classList.contains("on"), "");
  ok("报错写进了 localStorage", !!h.storage["companion-plan-errors"], h.storage["companion-plan-errors"]);

  for(let i = 0; i < 8; i++) h.fireWin("error", { message: "第 " + i + " 次错", filename: "app.js", lineno: i });
  const n = run(h.ctx, "errLog.length");
  ok("最多只留 5 条", n === 5, "实际 " + n);
  const r2 = run(h.ctx, `buildReport("")`);
  ok("留的是最新的 5 条", /第 7 次错/.test(r2) && !/第 0 次错/.test(r2), (r2.match(/\d\) .*/g) || []).join(" | "));

  // 重新打开应用：报错记录还在
  const h2 = boot(h.storage);
  const r3 = run(h2.ctx, `buildReport("")`);
  ok("重开应用后报错记录仍在（崩了重开再反馈也带得上）", /第 7 次错/.test(r3), "");

  // 清空
  h2.el("fbText").value = "";
  run(h2.ctx, `clearErrLog(); globalThis.__r4 = buildReport("");`);
  ok("清空后报告写「最近报错：无」", /最近报错：无/.test(run(h2.ctx, "__r4")), "");
  ok("清空后 localStorage 里也没了", !("companion-plan-errors" in h2.storage), "");
  ok("清空后兜底条收起", !h2.el("errBar").classList.contains("on"), "");
}

/* ============ 3. 三个出口 + 入口接线 ============ */
{
  const h = boot();
  h.el("errBar").classList.add("on");
  run(h.ctx, `state.days = {}; state.date = todayStr(); save(); render();`);

  // 入口：点「打开反馈窗口」
  h.el("feedbackBtn").fire("click");
  ok("设置里的入口能打开反馈弹窗", h.el("mFeedback").classList.contains("on"), "");
  ok("弹窗打开时报告已填好", /【陪伴·计划 反馈】/.test(h.el("fbReport").value), "");
  ok("无报错时的提示文案正常", /没检测到报错/.test(h.el("fbHint").textContent), h.el("fbHint").textContent);

  // 描述跟着同步进报告
  h.el("fbText").value = "按钮点不动";
  h.el("fbText").fire("input");
  ok("写描述时报告里同步出现", /按钮点不动/.test(h.el("fbReport").value), "");

  // 复制
  h.el("fbCopy").fire("click");
  ok("复制拿到的是报告全文", h.getCopied() === h.el("fbReport").value && h.getCopied().length > 50, "长度 " + (h.getCopied() || "").length);

  // 存文件
  h.el("fbSave").fire("click");
  const a = h.made[h.made.length - 1];
  ok("存文件用的是反馈文件名", /^陪伴-计划-反馈-\d{8}-\d{4}\.txt$/.test(a.download), a.download);
  ok("存文件指向的是 blob", a.href === "blob:fake", a.href);

  // GitHub issue
  h.el("fbIssue").fire("click");
  ok("去 GitHub 会打开预填链接", String(h.getOpened() || "").startsWith("https://github.com/jingxiuaian/companion-app/issues/new?"), "");

  // 兜底条的两个动作
  h.el("errBarGo").fire("click");
  ok("兜底条「把问题发我」能打开反馈弹窗", h.el("mFeedback").classList.contains("on"), "");
  ok("同时把兜底条收起", !h.el("errBar").classList.contains("on"), "");
  h.el("errBar").classList.add("on");
  h.el("errBarClose").fire("click");
  ok("兜底条的 ✕ 能关掉", !h.el("errBar").classList.contains("on"), "");
}

/* ============ 4. 邮箱出口 ============ */
{
  const h = boot();
  run(h.ctx, `state.days = {}; state.date = todayStr(); save(); render();
              globalThis.__mail = mailtoUrl(buildReport("页面卡住了"), "页面卡住了");`);
  const url = run(h.ctx, "__mail");
  const report = run(h.ctx, `buildReport("页面卡住了")`);

  ok("邮箱出口拼成 mailto:", /^mailto:[^?]+@[^?]+\?/.test(url), url.slice(0, 45) + "…");
  ok("mailto 的收件人就是配置里的地址", url.startsWith("mailto:" + run(h.ctx, "FEEDBACK_EMAIL") + "?"), "");
  ok("mailto 里没有裸换行（有的话邮件正文会被截断）", !/[\r\n]/.test(url), "");
  ok("mailto 正文编码后就是报告全文", decodeURIComponent((url.split("body=")[1] || "")) === report, "");
  ok("mailto 主题带版本号和描述首行",
     decodeURIComponent((url.match(/subject=([^&]*)/) || [])[1] || "").includes("【陪伴·计划 反馈】v5") &&
     decodeURIComponent((url.match(/subject=([^&]*)/) || [])[1] || "").includes("页面卡住了"), "");

  // 点按钮 → 交给系统邮件客户端（页面本身不发网络请求）
  h.el("fbText").value = "页面卡住了"; h.el("fbText").fire("input");   // 描述一改，报告跟着更新
  const expect = run(h.ctx, `mailtoUrl($("fbReport").value, $("fbText").value)`);
  h.el("fbMail").fire("click");
  ok("点「发邮件给我」会跳 mailto:", h.getLoc() === expect, String(h.getLoc()).slice(0, 40) + "…");

  // 超长报告会给告警，但仍然交出去
  run(h.ctx, `globalThis.__long = mailtoUrl(buildReport("长".repeat(3000)), "长".repeat(3000))`);
  const longUrl = run(h.ctx, "__long");
  ok("超长报告会超过阈值（触发告警路径）", longUrl.length > run(h.ctx, "MAILTO_MAX"), "长度 " + longUrl.length);
  h.el("fbText").value = "长".repeat(3000); h.el("fbText").fire("input");
  h.el("fbMail").fire("click");
  ok("超长时提示改用「复制报告」", /邮件可能被截断/.test(h.el("toast").textContent), h.el("toast").textContent);

  // 公开仓库里不该出现明文地址
  const js = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  ok("app.js 里没有明文的完整邮箱（拆开拼的，挡一挡爬虫）", !/245757759@qq\.com/.test(js), "");
}

/* ============ 5. 接线契约：app.js 里用到的 id 都存在于 index.html ============ */
{
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const js = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const ids = [...new Set([...js.matchAll(/\$\("(fb[A-Za-z]*|mFeedback[A-Za-z]*|errBar[A-Za-z]*|feedbackBtn)"\)/g)].map(m => m[1]))];
  const missing = ids.filter(id => !html.includes('id="' + id + '"'));
  ok("反馈相关的 id 全部在 index.html 里（接线契约）", missing.length === 0, missing.join(",") || ids.length + " 个都在");
  ok("index.html 里有反馈弹窗和兜底条", html.includes('id="mFeedback"') && html.includes('class="err-bar"'), "");
  ok("报告文本域是等宽字体（好复制）", fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8").includes("#fbReport { font-family: ui-monospace"), "");
}

let failed = 0;
console.log("本地反馈模块验收\n");
for(const [pass, name, extra] of results){
  if(!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? "   [" + extra + "]" : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
