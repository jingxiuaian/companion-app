"use strict";
/* =========================================================
 * 陪伴 · 计划 —— 最小原型
 * 核心闭环：排今日计划 → 打卡 → 空余时间建议
 * 数据存 localStorage；纯前端、零依赖。
 * ========================================================= */

const STORE_KEY = "companion-plan-v2";
const MS_DAY = 86400000;
const TODAY = "2026-09-23";
const DAY_START = "06:25";   // 可支配日窗口（起床后）
const DAY_END = "22:00";     // 熄灯
const MIN_FRAG = 10;         // 小于 10 分钟的碎片忽略
const DAY_NAMES = ["一","二","三","四","五","六","日"];

function pad(n){ return String(n).padStart(2, "0"); }
function daysUntil(deadline){ return Math.round((new Date(deadline+"T00:00:00") - new Date(TODAY+"T00:00:00")) / MS_DAY); }
function daysSince(lastDone){ return Math.round((new Date(TODAY+"T00:00:00") - new Date(lastDone+"T00:00:00")) / MS_DAY); }
function weekdayOf(dateStr){ const d = new Date(dateStr+"T00:00:00").getDay(); return d === 0 ? 7 : d; } // 1=周一…7=周日
function fragMin(f){ const [sh,sm]=f.start.split(":").map(Number), [eh,em]=f.end.split(":").map(Number); return (eh*60+em)-(sh*60+sm); }
function fmtDur(min){ const h=Math.floor(min/60), m=min%60; return h>0 ? (m>0? h+"h"+m+"m" : h+"h") : m+"m"; }
function daysLabel(days){
  if(!days || !days.length) return "";
  const all=[1,2,3,4,5,6,7], wd=[1,2,3,4,5];
  const eq=(a,b)=>a.length===b.length && a.every(v=>b.includes(v));
  if(eq(days, all)) return "每天";
  if(eq(days, wd)) return "工作日";
  return days.map(d=>"周"+DAY_NAMES[d-1]).join("、");
}

/* ---------- 从固定占用反推空闲碎片 ---------- */
function genFromSchedule(schedule, dateStr){
  const wd = weekdayOf(dateStr);
  const occ = schedule.filter(s => s.days.includes(wd)).sort((a,b)=>a.start.localeCompare(b.start));
  const frags = [];
  let cursor = DAY_START;
  for(const o of occ){
    if(o.start > cursor) frags.push({start:cursor, end:o.start});
    if(o.end > cursor) cursor = o.end;
  }
  if(DAY_END > cursor) frags.push({start:cursor, end:DAY_END});
  return frags.filter(f => fragMin(f) >= MIN_FRAG);
}

/* ---------- 种子数据：你的真实处境 ---------- */
function seedState(){
  const schedule = [
    { days:[1,2,3,4,5], start:"07:10", end:"11:40", label:"早餐·上午课" },
    { days:[1,2,3,4,5], start:"11:40", end:"12:15", label:"午饭" },
    { days:[1,2,3,4,5], start:"13:20", end:"16:55", label:"小憩·下午课" },
    { days:[1,2,3,4,5], start:"17:00", end:"18:40", label:"晚饭·休息" },
    { days:[1,2,3,4,5], start:"21:30", end:"22:00", label:"洗漱·就寝" },
  ];
  // 数组顺序即优先级：越靠前越优先（英语刚需排最前，法学最后）；拖动可重排
  const backlog = [
    { id:"en",  name:"英语",          desc:"专升本英语·应试刚需", cat:"英语", min:20, energy:"低", scene:"不限", must:true, type:"habit", interval:1, lastDone:"2026-09-22", hint:"每天雷打不动，不可断" },
    { id:"ctf", name:"CTF Web",       desc:"竞赛 + 兴趣", cat:"安全", min:60, energy:"高", scene:"室内", type:"habit", interval:2, lastDone:"2026-09-22" },
    { id:"web", name:"Web全栈+AI编程", desc:"核心技能 · 黑客松MVP", cat:"编程", min:60, energy:"高", scene:"室内", type:"deadline", deadline:"2026-10-07", unit:"黑客松(10.7)", left:9 },
    { id:"fit", name:"低冲击健身",    desc:"慢跑/快走 · 护膝三件套", cat:"健康", min:30, energy:"中", scene:"室外", type:"habit", interval:2, lastDone:"2026-09-21", hint:"左膝旧伤，别剧烈" },
    { id:"law", name:"法学",          desc:"超长期备选", cat:"备选", min:30, energy:"中", scene:"不限", type:"habit", interval:7, lastDone:"2026-09-15", hint:"每周一次即可" },
  ];
  const days = {
    "2026-09-23": {
      fragments: genFromSchedule(schedule, "2026-09-23"),
      tasks: [
        { id:"t1", backlogId:"en",  title:"英语 · 背单词（晨间块）", min:20, done:false },
        { id:"t2", backlogId:"web", title:"Web/AI编程 · 推黑客松 MVP", min:60, done:false },
      ]
    },
    "2026-09-24": { fragments: genFromSchedule(schedule, "2026-09-24"), tasks: [] },
  };
  return { schedule, backlog, days };
}

/* ---------- 状态 ---------- */
let state = load();
function load(){
  try { const s = localStorage.getItem(STORE_KEY); if(s) return JSON.parse(s); } catch(e){}
  return seedState();
}
function save(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function dayData(){ if(!state.days[state.date]) state.days[state.date] = {fragments:[], tasks:[]}; return state.days[state.date]; }

state.date = state.date || TODAY;
let view = "today";
let energy = "高", scene = "可外出";

function $(id){ return document.getElementById(id); }
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function uid(){ return "id"+Math.random().toString(36).slice(2,9); }

/* ---------- 渲染 ---------- */
function render(){
  $("datePicker").value = state.date;
  $("tabToday").classList.toggle("on", view==="today");
  $("tabBacklog").classList.toggle("on", view==="backlog");
  $("tabSchedule").classList.toggle("on", view==="schedule");
  $("viewToday").classList.toggle("on", view==="today");
  $("viewBacklog").classList.toggle("on", view==="backlog");
  $("viewSchedule").classList.toggle("on", view==="schedule");
  renderOverview(); renderFrags(); renderTasks(); renderBacklog(); renderSchedule(); renderSuggList();
}

function renderOverview(){
  const d = dayData();
  const totalMin = d.fragments.reduce((s,f)=>s+fragMin(f),0);
  const plannedMin = d.tasks.reduce((s,t)=>s+t.min,0);
  const doneCount = d.tasks.filter(t=>t.done).length;
  const freeMin = Math.max(0, totalMin - plannedMin);
  $("ovTitle").textContent = state.date === TODAY ? "今天" : state.date;
  $("ovFree").textContent = fmtDur(freeMin);
  $("ovDone").textContent = doneCount + "/" + d.tasks.length;
  $("ovMeter").style.width = (totalMin ? Math.min(100, plannedMin/totalMin*100) : 0) + "%";
}

function renderFrags(){
  const d = dayData();
  const el = $("fragList");
  if(!d.fragments.length){ el.innerHTML = '<div class="empty">还没有空闲时间段。点"从作息生成"，或手动"＋ 添加"。</div>'; return; }
  el.innerHTML = d.fragments.map((f,i)=>`
    <div class="frag">
      <span class="time">${f.start}–${f.end}</span>
      <span class="dur">${fmtDur(fragMin(f))}</span>
      <span class="del" data-del-frag="${i}">✕</span>
    </div>`).join("");
}

function renderTasks(){
  const d = dayData();
  const el = $("taskList");
  if(!d.tasks.length){ el.innerHTML = '<div class="empty">还没安排任务，点"＋ 安排任务"。</div>'; return; }
  el.innerHTML = d.tasks.map((t,i)=>`
    <div class="task ${t.done?'done':''}">
      <div class="cb" data-check="${i}">${t.done?'✓':''}</div>
      <div class="t-body">
        <div class="t-title">${esc(t.title)}</div>
        <div class="t-meta">${fmtDur(t.min)}</div>
      </div>
      <span class="t-del" data-del-task="${i}">✕</span>
    </div>`).join("");
}

function renderBacklog(){
  const el = $("backlogList");
  if(!state.backlog.length){ el.innerHTML = '<div class="empty">事项池为空，点"＋ 添加"。</div>'; return; }
  el.innerHTML = state.backlog.map((b,i)=>{
    let meta = "";
    if(b.type==="deadline"){ const dd=daysUntil(b.deadline); meta = `截止 ${b.deadline} · 剩 ${dd} 天`; if(b.left) meta += ` · 剩 ${b.left} 节`; }
    else { meta = `习惯 · ${daysSince(b.lastDone)} 天没做`; }
    const must = !!b.must;
    return `<div class="blk" draggable="true" data-idx="${i}">
      <span class="grip" title="拖动排序">⠿</span>
      <span class="tag ${must?'must':''}">${must?'⭐ ':''}${esc(b.cat||"其他")}</span>
      <div class="b-main">
        <div class="b-name">${esc(b.name)}</div>
        <div class="b-desc">${esc(b.desc||"")}</div>
        <div class="b-flags">
          <span class="flag pri">第 ${i+1} 优先</span>
          <span class="flag">≥${b.min}分钟</span>
          <span class="flag">精力${b.energy}</span>
          <span class="flag">${b.scene}</span>
          <span class="flag">${meta}</span>
        </div>
      </div>
      <span class="t-del" data-del-backlog="${i}">✕</span>
    </div>`;
  }).join("");
}

function renderSchedule(){
  const el = $("occList");
  if(!state.schedule.length){ el.innerHTML = '<div class="empty">还没有固定占用。点下方"一键填入我的作息"或"＋ 添加占用"。</div>'; return; }
  el.innerHTML = state.schedule.map((o,i)=>`
    <div class="occ">
      <span class="o-days">${daysLabel(o.days)}</span>
      <div class="o-body">
        <div class="o-label">${esc(o.label||"占用")}</div>
        <div class="o-time">${o.start}–${o.end}</div>
      </div>
      <span class="del" data-del-occ="${i}">✕</span>
    </div>`).join("");
}

function renderSuggList(){
  $("suggList").innerHTML = "";
}

/* ---------- 建议引擎 ---------- */
function suggest(){
  const d = dayData();
  const totalMin = d.fragments.reduce((s,f)=>s+fragMin(f),0);
  const plannedMin = d.tasks.reduce((s,t)=>s+t.min,0);
  const baseFree = Math.max(0, totalMin - plannedMin);
  const extra = parseInt($("extraMin").value,10) || 0;
  const remaining = baseFree + extra;

  const cands = state.backlog
    .filter(b => b.min <= remaining)
    .filter(b => scene === "可外出" || b.scene !== "室外")
    .filter(b => energyAllow(energy, b.energy))
    .map(b => {
      let dyn = 0, reason = "";
      if(b.type === "deadline" && b.deadline){
        const dd = daysUntil(b.deadline);
        dyn += Math.max(0, 21 - dd) * 0.5;
        reason = `距 ${b.unit||"截止"} 还有 ${dd} 天` + (b.left ? `，剩 ${b.left} 节` : "");
      } else if(b.type === "habit"){
        const gap = daysSince(b.lastDone);
        dyn += gap * 1.0;
        reason = `「${b.name}」已经 ${gap} 天没做了`;
      }
      if(b.hint) reason = reason ? reason + " · " + b.hint : b.hint;
      else if(!reason && b.must) reason = "你的刚需主线，每天雷打不动";
      const over = remaining - b.min;
      const fit = over <= 15 ? 1.5 : (over <= 45 ? 0.8 : 0.2);
      const pri = state.backlog.length - state.backlog.indexOf(b); // 位置越靠前优先级越高
      const score = pri * 1000 + dyn * 10 + fit;
      const fitTag = over <= 15 ? "刚刚好" : (over <= 45 ? "合适" : "时间有余");
      return { item:b, score, reason, fit:fitTag };
    })
    .sort((a,b)=> b.score - a.score)
    .slice(0,3);

  const el = $("suggList");
  if(!cands.length){
    el.innerHTML = '<div class="empty" style="padding-top:14px">暂时没有合适的事项——去事项池添加，或把时间调长一点试试。</div>';
    return;
  }
  el.innerHTML = `<div style="font-size:12px;color:var(--sub);margin-top:12px">当前可支配 <b style="color:var(--brand)">${fmtDur(remaining)}</b>，建议：</div>` +
    cands.map((c,i)=>`
      <div class="sugg-card">
        <div class="rank">建议 ${i+1}</div>
        <div class="s-name">${esc(c.item.name)}<span class="s-fit">${c.fit}</span></div>
        <div class="s-reason">${esc(c.reason)} · 用 ${fmtDur(c.item.min)} 左右</div>
      </div>`).join("");
}

function energyAllow(user, need){
  const rank = {低:1, 中:2, 高:3};
  return rank[need] <= rank[user];
}

/* ---------- 事件 ---------- */
function openModal(id){ $(id).classList.add("on"); }
function closeModal(id){ $(id).classList.remove("on"); }

$("datePicker").addEventListener("change", e => { state.date = e.target.value; save(); render(); });
$("tabToday").addEventListener("click", ()=>{ view="today"; render(); });
$("tabBacklog").addEventListener("click", ()=>{ view="backlog"; render(); });
$("tabSchedule").addEventListener("click", ()=>{ view="schedule"; render(); });

/* 从作息生成今日空闲 */
$("genFrag").addEventListener("click", ()=>{
  if(!state.schedule.length){ alert("先到「作息」页填入固定占用（或点「一键填入我的作息」）。"); return; }
  const has = dayData().fragments.length > 0;
  if(has && !confirm("用固定作息覆盖当前的空闲时间段？")) return;
  dayData().fragments = genFromSchedule(state.schedule, state.date);
  save(); render(); toast("已生成今日空闲时间");
});

$("addFrag").addEventListener("click", ()=> openModal("mFrag"));
$("mFragCancel").addEventListener("click", ()=> closeModal("mFrag"));
$("mFragOk").addEventListener("click", ()=>{
  const start=$("fStart").value, end=$("fEnd").value;
  if(start && end && end > start){ dayData().fragments.push({start,end}); dayData().fragments.sort((a,b)=>a.start.localeCompare(b.start)); save(); render(); }
  closeModal("mFrag");
});

$("addTask").addEventListener("click", ()=>{
  const sel = $("tBacklog"); sel.innerHTML = '<option value="">— 自定义任务 —</option>' + state.backlog.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join("");
  $("tName").value=""; $("tMin").value="60"; openModal("mTask");
});
$("mTaskCancel").addEventListener("click", ()=> closeModal("mTask"));
$("mTaskOk").addEventListener("click", ()=>{
  const bid = $("tBacklog").value;
  const b = state.backlog.find(x=>x.id===bid);
  const name = $("tName").value.trim() || (b ? b.name : "");
  const min = parseInt($("tMin").value,10) || (b ? b.min : 60);
  if(name){ dayData().tasks.push({ id:uid(), backlogId:bid||null, title:name, min, done:false }); save(); render(); }
  closeModal("mTask");
});

$("addBacklog").addEventListener("click", ()=> openModal("mBacklog"));
$("mBacklogCancel").addEventListener("click", ()=> closeModal("mBacklog"));
$("mBacklogOk").addEventListener("click", ()=>{
  const name = $("bName").value.trim();
  if(name){
    state.backlog.push({
      id: uid(), name, desc: $("bDesc").value.trim(), cat:"自定义",
      min: parseInt($("bMin").value,10)||20,
      energy: $("bEnergy").value, scene: $("bScene").value,
      type: $("bType").value, deadline: $("bType").value==="deadline" ? ($("bDeadline").value || null) : null,
      interval: 2, lastDone: TODAY,
    });
    save(); render();
  }
  closeModal("mBacklog");
});

/* 占用 */
$("addOcc").addEventListener("click", ()=> openModal("mOcc"));
$("mOccCancel").addEventListener("click", ()=> closeModal("mOcc"));
$("mOccOk").addEventListener("click", ()=>{
  const label=$("oLabel").value.trim()||"占用", start=$("oStart").value, end=$("oEnd").value;
  const days = [...document.querySelectorAll("#oDays input:checked")].map(x=>+x.value);
  if(start && end && end > start && days.length){ state.schedule.push({days, start, end, label}); save(); render(); }
  closeModal("mOcc");
});
$("fillMySchedule").addEventListener("click", ()=>{
  state.schedule = [
    { days:[1,2,3,4,5], start:"07:10", end:"11:40", label:"早餐·上午课" },
    { days:[1,2,3,4,5], start:"11:40", end:"12:15", label:"午饭" },
    { days:[1,2,3,4,5], start:"13:20", end:"16:55", label:"小憩·下午课" },
    { days:[1,2,3,4,5], start:"17:00", end:"18:40", label:"晚饭·休息" },
    { days:[1,2,3,4,5], start:"21:30", end:"22:00", label:"洗漱·就寝" },
  ];
  save(); render(); toast("已填入你的作息 ✓");
});

/* 点击委托：删除 / 打卡 */
document.addEventListener("click", e=>{
  const df = e.target.closest("[data-del-frag]");
  if(df){ dayData().fragments.splice(+df.dataset.delFrag,1); save(); render(); return; }
  const dt = e.target.closest("[data-del-task]");
  if(dt){ dayData().tasks.splice(+dt.dataset.delTask,1); save(); render(); return; }
  const db = e.target.closest("[data-del-backlog]");
  if(db){ state.backlog.splice(+db.dataset.delBacklog,1); save(); render(); return; }
  const dO = e.target.closest("[data-del-occ]");
  if(dO){ state.schedule.splice(+dO.dataset.delOcc,1); save(); render(); return; }
  const ck = e.target.closest("[data-check]");
  if(ck){ const t=dayData().tasks[+ck.dataset.check]; t.done=!t.done; save(); render(); return; }
});

$("segEnergy").addEventListener("click", e=>{
  const b = e.target.closest("button"); if(!b) return;
  energy = b.dataset.v; [...$("segEnergy").children].forEach(x=>x.classList.toggle("on", x===b));
});
$("segScene").addEventListener("click", e=>{
  const b = e.target.closest("button"); if(!b) return;
  scene = b.dataset.v; [...$("segScene").children].forEach(x=>x.classList.toggle("on", x===b));
});
$("btnSuggest").addEventListener("click", suggest);

document.querySelectorAll(".modal-mask").forEach(m=>{
  m.addEventListener("click", e=>{ if(e.target===m) m.classList.remove("on"); });
});

/* ---------- 轻提示 ---------- */
let toastTimer;
function toast(msg){
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.classList.remove("show"), 1800);
}

/* ---------- 事项池拖拽排序（顺序即优先级） ---------- */
let dragIdx = null;
document.addEventListener("dragstart", e=>{
  const blk = e.target.closest(".blk"); if(!blk) return;
  dragIdx = +blk.dataset.idx;
  blk.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  try { e.dataTransfer.setData("text/plain", String(dragIdx)); } catch(err){}
});
document.addEventListener("dragover", e=>{
  const blk = e.target.closest(".blk"); if(!blk) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  document.querySelectorAll(".blk.dragover").forEach(x=>x.classList.remove("dragover"));
  blk.classList.add("dragover");
});
document.addEventListener("drop", e=>{
  const blk = e.target.closest(".blk"); if(!blk || dragIdx == null) return;
  e.preventDefault();
  const to = +blk.dataset.idx;
  if(to !== dragIdx){
    const [moved] = state.backlog.splice(dragIdx, 1);
    state.backlog.splice(to, 0, moved);
    save(); render();
  }
  cleanupDrag();
});
document.addEventListener("dragend", cleanupDrag);
function cleanupDrag(){
  dragIdx = null;
  document.querySelectorAll(".blk.dragging, .blk.dragover").forEach(x=>x.classList.remove("dragging","dragover"));
}

render();
