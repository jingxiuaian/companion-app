/* 临时验收台（跑完可删）：起本地静态服务 + headless Chrome，通过 CDP 真的点「一键导入」按钮，
   验证「可重复导入」在真实浏览器里成立，并截图存证。不修改项目文件。 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "companion-app-重复导入-验收截图.png");
const PORT = 8899;
const CDP_PORT = 9333;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, extra = "") => { results.push([!!cond, name, extra]); };

/* ---------- 1. 静态服务 ---------- */
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, "127.0.0.1", r));
const URL_APP = `http://127.0.0.1:${PORT}/index.html`;

/* ---------- 2. headless Chrome ---------- */
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "companion-verify-"));
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--disable-background-networking", "--window-size=390,844",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, URL_APP,
], { stdio: "ignore", detached: false });

let targets = null;
for (let i = 0; i < 60 && !targets; i++) {
  await sleep(300);
  try { targets = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).filter(t => t.type === "page"); } catch {}
}
if (!targets || !targets.length) { console.log("FAIL  无法连上 Chrome 调试端口"); chrome.kill(); server.close(); process.exit(1); }

/* ---------- 3. 极简 CDP 客户端 ---------- */
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws fail")); });
let msgId = 0;
const pending = new Map();
const pageErrors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  } else if (m.method === "Runtime.exceptionThrown") {
    pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
    pageErrors.push(m.params.entry.text);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
async function evalJs(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expr, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evalJs(`!!(${expr})`)) return true; } catch {}
    await sleep(150);
  }
  return false;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
ok("页面加载并且 app.js 跑通", await waitFor("typeof importTasks === 'function' && document.readyState === 'complete'"));
ok("没有 JS 运行时报错（加载阶段）", pageErrors.length === 0, pageErrors.join(" | "));

/* ---------- 4. 造数据：1 个习惯事项 + 1 小时空闲 ---------- */
await evalJs(`localStorage.clear(); settings.importMode = "all"; saveSettings(); "ok"`);
await send("Page.reload", { ignoreCache: true });
await waitFor("typeof importTasks === 'function' && typeof state === 'object'");
await evalJs(`
  state.days = {}; state.date = todayStr();
  state.backlog = [{ id:"b1", name:"背单词", desc:"", cat:"自定义", min:20, energy:"高",
                     scene:"不限", type:"habit", deadline:null, interval:2, lastDone:"2020-01-01" }];
  dayData().fragments = [{ start:"19:00", end:"20:00" }];
  settings.importMode = "all"; saveSettings();
  window.confirm = () => true;   // 真浏览器里 confirm 会阻塞，测试里自动按"确定"
  save(); render(); "seeded"
`);
ok("今日计划初始为空", (await evalJs("document.querySelectorAll('#taskList .task').length")) === 0);

/* ---------- 5. 真的点两次按钮 ---------- */
const clickImport = () => evalJs(`document.getElementById("importTasks").click(); "clicked"`);
const board = () => evalJs(`(() => {
  const rows = [...document.querySelectorAll("#taskList .task")];
  return {
    count: rows.length,
    times: dayData().tasks.map(t => t.start ? t.start + "–" + t.end : "（待排）"),
    dupTags: [...document.querySelectorAll("#taskList .t-dup")].map(x => x.textContent),
    toast: document.getElementById("toast").textContent,
  };
})()`);

await clickImport();
let b = await board();
ok("真实点击第 1 次 → 今日计划 1 条", b.count === 1, `times=${b.times.join(",")} toast=${b.toast}`);

await clickImport();
b = await board();
ok("真实点击第 2 次（重复导入）→ 今日计划 2 条", b.count === 2, `times=${b.times.join(",")} toast=${b.toast}`);
ok("两条各占一个互不重叠的时间段", b.times[0] === "19:00–19:20" && b.times[1] === "19:20–19:40", b.times.join(","));
ok("页面上出现 ×2 标签", b.dupTags.includes("×2"), b.dupTags.join(","));

/* ---------- 6. 空闲不够时也要导入 ---------- */
await evalJs(`dayData().fragments = [{ start:"19:00", end:"19:10" }]; save(); render(); "ok"`);
await clickImport();
b = await board();
ok("空闲只剩 10 分钟时仍导入 → 3 条", b.count === 3, `toast=${b.toast}`);
ok("排不下的第 3 条不占时间段（显示待排）", b.times[2] === "（待排）", b.times.join(","));
ok("三条都标 ×3", b.dupTags.join(",") === "×3,×3,×3", b.dupTags.join(","));

/* ---------- 7. 勾选弹窗 ---------- */
const pick = await evalJs(`(() => {
  openImportPick();
  const cb = document.querySelector("#importPickList input[type=checkbox]");
  return {
    opened: document.getElementById("mImportPick").classList.contains("on"),
    checked: cb.checked,
    label: cb.closest("label").innerText.replace(/\\s+/g, " ").trim(),
  };
})()`);
ok("勾选弹窗能打开", pick.opened);
ok("已排过的项默认不勾（避免误加重复）", pick.checked === false);
ok("勾选弹窗标出今日已有条数", /今日计划里已有 3 条/.test(pick.label), pick.label);
await evalJs(`closeModal("mImportPick"); "ok"`);

/* ---------- 8. 截图存证 ---------- */
await evalJs(`render(); window.scrollTo(0, 0); "ok"`);
await sleep(400);
const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
fs.writeFileSync(SHOT, Buffer.from(shot.data, "base64"));
ok("截图已保存", fs.existsSync(SHOT));

/* ---------- 9. 刷新后重复条目还在 ---------- */
await send("Page.reload", { ignoreCache: true });
await waitFor("typeof importTasks === 'function' && typeof state === 'object'");
ok("刷新后重复条目仍在（3 条）", (await evalJs("dayData().tasks.length")) === 3, `tasks=${await evalJs("dayData().tasks.map(t=>t.title).join(',')")}`);
ok("刷新后页面上仍渲染 3 条", (await evalJs("document.querySelectorAll('#taskList .task').length")) === 3);
ok("没有 JS 运行时报错（全程）", pageErrors.length === 0, pageErrors.join(" | "));

/* ---------- 报告 + 收尾 ---------- */
let failed = 0;
console.log("真实浏览器（headless Chrome + CDP，390x844 移动端视口）\n");
for (const [pass, name, extra] of results) {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? "   [" + extra + "]" : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);

try { await send("Browser.close"); } catch {}
await sleep(500);
try { chrome.kill(); } catch {}
server.close();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(failed ? 1 : 0);
