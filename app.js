"use strict";
/* =========================================================
 * 陪伴 · 计划 —— 最小原型
 * 核心闭环：排今日计划 → 打卡 → 空余时间建议
 * 数据存 localStorage；纯前端、零依赖。
 * ========================================================= */

const STORE_KEY = "companion-plan-v2";
const MS_DAY = 86400000;
function todayStr(){
  const d = new Date(); // 本地时区的"现在"
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
const DAY_START = "06:25";   // 可支配日窗口（起床后）
const DAY_END = "22:00";     // 熄灯
const MIN_FRAG = 10;         // 小于 10 分钟的碎片忽略
const DAY_NAMES = ["一","二","三","四","五","六","日"];

function pad(n){ return String(n).padStart(2, "0"); }
function daysUntil(deadline){ return Math.round((new Date(deadline+"T00:00:00") - new Date(todayStr()+"T00:00:00")) / MS_DAY); }
function daysSince(lastDone){ return Math.round((new Date(todayStr()+"T00:00:00") - new Date(lastDone+"T00:00:00")) / MS_DAY); }
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
function addMin(timeStr, m){
  const [h,mm] = timeStr.split(":").map(Number);
  const total = h*60 + mm + m;
  return pad(Math.floor(total/60)%24) + ":" + pad(total%60);
}
function addDaysStr(dateStr, n){
  const d = new Date(dateStr+"T00:00:00");
  d.setDate(d.getDate()+n);
  return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
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

/* ---------- 种子数据：空模板（默认不预置任何内容） ---------- */
function seedState(){
  const schedule = [];
  const backlog = [];
  const days = {};
  const notes = [];
  return { schedule, backlog, days, notes };
}

/* ---------- 状态 ---------- */
let state = load();
function load(){
  try {
    const s = localStorage.getItem(STORE_KEY);
    if(s) return Object.assign(seedState(), JSON.parse(s)); // 旧数据缺 notes 时自动补默认值
  } catch(e){}
  return seedState();
}
function save(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function dayData(){
  let d = state.days[state.date];
  if(!d) d = state.days[state.date] = {fragments:[], tasks:[], skipped:[]};
  if(!d.skipped) d.skipped = []; // 旧数据补默认值
  return d;
}

/* 每天打开时，把"今天到期"的日常习惯自动列进今日计划（只列任务、不排具体时间段） */
function autoGenHabits(){
  if(state.date !== todayStr()) return; // 只对"今天"自动生成，历史/未来不塞
  const d = dayData();
  let changed = false;
  state.backlog.forEach(b => {
    if(b.type !== "habit") return;
    const gap = b.lastDone ? daysSince(b.lastDone) : Infinity; // 从没做过 = 立即到期
    if(gap < (b.interval || 1)) return;                          // 还没到该做的日子
    if(d.skipped.includes(b.id)) return;                         // 今天手动删过，别再塞回来
    if(d.tasks.some(t => t.backlogId === b.id)) return;          // 已经列在今日计划里了
    d.tasks.push({ id: uid(), backlogId: b.id, title: b.name, min: b.min, done: false, kind: "habit" });
    changed = true;
  });
  if(changed) save();
}

state.date = todayStr(); // 每次打开都回到今天，不管上次停在哪
let view = "today";
let energy = "高", scene = "可外出";
let noteType = "todo"; // 记事本当前输入类型：todo=清单 / note=文字
let lastSugg = null; // 最近一次建议结果，render 后仍保留

/* ---------- 主题皮肤 ---------- */
const THEME_NAMES = { violet:"紫藤", teal:"青竹", amber:"暖阳", ink:"墨蓝" };
const THEME_META = { violet:"#16171F", teal:"#0F1415", amber:"#17130F", ink:"#12131C" };
function applyTheme(t){
  if(!THEME_NAMES[t]) t = "violet"; // 旧存的 auto 或非法值，统一归到紫藤
  document.body.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.content = THEME_META[t] || "#16171F";
  localStorage.setItem("companion-theme", t);
}
applyTheme(localStorage.getItem("companion-theme") || "violet");

function $(id){ return document.getElementById(id); }
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function uid(){ return "id"+Math.random().toString(36).slice(2,9); }

/* ---------- 渲染 ---------- */
function render(){
  autoGenHabits();
  $("datePicker").value = state.date;
  $("tabToday").classList.toggle("on", view==="today");
  $("tabBacklog").classList.toggle("on", view==="backlog");
  $("tabSchedule").classList.toggle("on", view==="schedule");
  $("tabWeek").classList.toggle("on", view==="week");
  $("tabNotes").classList.toggle("on", view==="notes");
  $("viewToday").classList.toggle("on", view==="today");
  $("viewBacklog").classList.toggle("on", view==="backlog");
  $("viewSchedule").classList.toggle("on", view==="schedule");
  $("viewWeek").classList.toggle("on", view==="week");
  $("viewNotes").classList.toggle("on", view==="notes");
  renderOverview(); renderFrags(); renderTasks(); renderBacklog(); renderSchedule(); renderSuggList(); renderWeek(); renderNotes();
}

function renderOverview(){
  const d = dayData();
  const totalMin = d.fragments.reduce((s,f)=>s+fragMin(f),0);
  const plannedMin = d.tasks.reduce((s,t)=>s+t.min,0);
  const doneCount = d.tasks.filter(t=>t.done).length;
  const freeMin = Math.max(0, totalMin - plannedMin);
  $("ovTitle").textContent = state.date === todayStr() ? "今天" : state.date;
  $("ovFree").textContent = fmtDur(freeMin);
  $("ovDone").textContent = doneCount + "/" + d.tasks.length;
  $("ovMeter").style.width = (totalMin ? Math.min(100, plannedMin/totalMin*100) : 0) + "%";
}

function renderFrags(){
  const d = dayData();
  const el = $("fragList");
  if(!d.fragments.length){ el.innerHTML = '<div class="empty">还没有空闲时间段。点"从作息生成"，或手动"＋ 添加"。</div>'; return; }
  el.innerHTML = d.fragments.map((f,i)=>{
    const inner = d.tasks
      .filter(t => t.start && t.end && t.start >= f.start && t.end <= f.end)
      .sort((a,b)=> a.start.localeCompare(b.start));
    const tasksHtml = inner.map(t=>`
      <div class="frag-task">
        <span class="ft-time">${t.start}–${t.end}</span>
        <span class="ft-name">${esc(t.title)}</span>
      </div>`).join("");
    return `
      <div class="frag-group">
        <div class="frag">
          <span class="time">${f.start}–${f.end}</span>
          <span class="dur">${fmtDur(fragMin(f))}</span>
          <span class="del" data-del-frag="${i}">✕</span>
        </div>
        ${tasksHtml}
      </div>`;
  }).join("");
}

function renderTasks(){
  const d = dayData();
  const el = $("taskList");
  if(!d.tasks.length){ el.innerHTML = '<div class="empty">还没安排任务，点"＋ 安排任务"。</div>'; return; }
  el.innerHTML = d.tasks.map((t,i)=>{
    const tag = t.kind === "habit"
      ? '<span class="t-tag">日常</span>'
      : '<span class="t-tag t-tag-tmp">临时</span>';
    return `
    <div class="task ${t.done?'done':''}">
      <div class="cb" data-check="${i}">${t.done?'✓':''}</div>
      <div class="t-body">
        <div class="t-title">${tag}${esc(t.title)}</div>
        <div class="t-meta">${fmtDur(t.min)}${(t.start&&t.end)?`<span class="t-time">${t.start}–${t.end}</span>`:""}</div>
      </div>
      <span class="t-del" data-del-task="${i}">✕</span>
    </div>`;
  }).join("");
}

function renderBacklog(){
  const el = $("backlogList");
  if(!state.backlog.length){ el.innerHTML = '<div class="empty">事项池为空，点"＋ 添加"。</div>'; return; }
  el.innerHTML = state.backlog.map((b,i)=>{
    let meta = "";
    if(b.type==="deadline"){ const dd=daysUntil(b.deadline); meta = `截止 ${b.deadline} · 剩 ${dd} 天`; }
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
  if(!state.schedule.length){ el.innerHTML = '<div class="empty">还没有固定占用。点下方"＋ 添加占用"。</div>'; return; }
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
  const el = $("suggList");
  if(!lastSugg){ el.innerHTML = ""; return; }
  if(lastSugg.empty){ el.innerHTML = '<div class="empty" style="padding-top:14px">暂时没有合适的事项——去事项池添加，或把时间调长一点试试。</div>'; return; }
  if(!lastSugg.singles.length && !lastSugg.combos.length){ el.innerHTML = ""; return; }
  let html = `<div style="font-size:12px;color:var(--sub);margin-top:12px">当前可支配 <b style="color:var(--brand)">${fmtDur(lastSugg.remaining)}</b>，建议：</div>`;
  html += lastSugg.singles.map((c,i)=>`
    <div class="sugg-card">
      <div class="rank">建议 ${i+1}</div>
      <div class="s-name">${esc(c.item.name)}<span class="s-fit">${c.fit}</span></div>
      <div class="s-reason">${esc(c.reason)} · 用 ${fmtDur(c.item.min)} 左右</div>
      <button class="sched-btn" data-sugg-single="${i}">排进空闲时间</button>
    </div>`).join("");
  if(lastSugg.combos.length){
    html += `<div class="combo-hd">组合建议 · 一次做两件</div>`;
    html += lastSugg.combos.map((c,i)=>`
      <div class="sugg-card combo">
        <div class="rank">组合 ${i+1}</div>
        <div class="s-name">${c.items.map(x=>esc(x.name)).join(" + ")}<span class="s-fit">${fmtDur(c.totalMin)}</span></div>
        <div class="s-reason">${esc(c.reason)} · 正好用满 ${fmtDur(c.totalMin)}</div>
        <button class="sched-btn" data-sugg-combo="${i}">一起排进</button>
      </div>`).join("");
  }
  el.innerHTML = html;
}

/* ---------- 建议引擎 ---------- */
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
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
        dyn = Math.max(0, 14 - dd) * 15; // 越接近截止越急，≤0 天最高 210
        reason = pick([
          `${b.unit||"截止"} 还剩 ${dd} 天，做一点就少一点`,
          `${b.unit||"截止"} 剩 ${dd} 天了，今天啃一小块就松一点`,
          `离 ${b.unit||"截止"} 还有 ${dd} 天，来得及，别攒到最后`,
          `${b.unit||"截止"} 还有 ${dd} 天，一天一点点就够`,
        ]);
      } else if(b.type === "habit"){
        const gap = daysSince(b.lastDone);
        const due = b.interval || 1;
        if(gap >= due){
          dyn = (gap - due + 1) * 10; // 到期后每多欠一天 +10
          reason = pick([
            `「${b.name}」断了 ${gap} 天，今天做一点就接上了`,
            `「${b.name}」歇了 ${gap} 天，没关系，今天补一小份就回来`,
            `「${b.name}」空窗 ${gap} 天了，现在接回来刚刚好`,
            `「${b.name}」有 ${gap} 天没碰，今天先做 5 分钟，别让它继续断`,
          ]);
        } else {
          dyn = -1000; // 还没到点 / 今天做过了：压到末尾
          reason = pick([
            `「${b.name}」最近有在做，保持住`,
            `「${b.name}」这几天的节奏不错，别松`,
            `「${b.name}」你在坚持，很好，继续保持`,
          ]);
        }
      }
      if(b.hint) reason = reason ? reason + " · " + b.hint : b.hint;
      else if(!reason && b.must) reason = pick([
        "这是你的主线，今天守住它",
        "这条对你最重要，今天别落下",
        "你的主线，今天就把它做完，别拖",
      ]);
      const over = remaining - b.min;
      const fit = over <= 15 ? 1.5 : (over <= 45 ? 0.8 : 0.2);
      const pri = state.backlog.length - state.backlog.indexOf(b); // 位置越靠前优先级越高
      const score = pri * 100 + dyn + fit; // pri 降权，紧迫度才能生效
      const fitTag = over <= 15 ? "刚刚好" : (over <= 45 ? "合适" : "时间有余");
      return { item:b, score, reason, fit:fitTag };
    })
    .sort((a,b)=> b.score - a.score);

  const singles = cands.slice(0,3);

  // 组合建议：从排名靠前的候选里两两配对，总时长能塞进 remaining 就成组
  const combos = [];
  const pool = cands.slice(0,6);
  for(let i=0;i<pool.length;i++){
    for(let j=i+1;j<pool.length;j++){
      const a = pool[i], b = pool[j];
      const total = a.item.min + b.item.min;
      if(total > remaining) continue;
      combos.push({ items:[a.item, b.item], totalMin: total, score: a.score + b.score, reason: a.reason });
    }
  }
  combos.sort((a,b)=> b.score - a.score);
  const topCombos = combos.slice(0,2);

  lastSugg = { remaining, singles, combos: topCombos, empty: cands.length === 0 };
  renderSuggList();
}

function energyAllow(user, need){
  const rank = {低:1, 中:2, 高:3};
  return rank[need] <= rank[user];
}

/* ---------- 排程：把建议落进具体时间块 ---------- */
function freeSlots(){
  const d = dayData();
  const slots = [];
  for(const f of d.fragments){
    const inner = d.tasks
      .filter(t => t.start && t.end && t.start >= f.start && t.end <= f.end)
      .sort((a,b)=> a.start.localeCompare(b.start));
    let cursor = f.start;
    for(const t of inner){
      if(t.start > cursor) slots.push({start:cursor, end:t.start});
      if(t.end > cursor) cursor = t.end;
    }
    if(f.end > cursor) slots.push({start:cursor, end:f.end});
  }
  return slots.filter(s => fragMin(s) >= MIN_FRAG);
}
function scheduleItems(list){
  const d = dayData();
  const placed = [], failed = [];
  for(const {item, min} of list){
    const slot = freeSlots().find(s => fragMin(s) >= min);
    if(!slot){ failed.push(item.name); continue; }
    const start = slot.start, end = addMin(start, min);
    d.tasks.push({ id:uid(), backlogId:item.id, title:item.name, min, start, end, done:false });
    placed.push(`${item.name} ${start}–${end}`);
  }
  lastSugg = null; // 排完清掉，重新点"给我一点建议"拿最新空闲
  save(); render();
  if(placed.length) toast("已排进：" + placed.join("、"));
  if(failed.length) toast("没排下：" + failed.join("、") + "（空闲时间不够）");
}

/* ---------- 周视图 ---------- */
function weekDates(){
  const wd = new Date(todayStr()+"T00:00:00").getDay(); // 0=周日
  const mondayOffset = wd === 0 ? -6 : 1 - wd;
  const out = [];
  for(let i=0;i<7;i++) out.push(addDaysStr(todayStr(), mondayOffset + i));
  return out;
}
function dayHasDone(ds){
  const d = state.days[ds];
  return !!(d && d.tasks.some(t => t.done));
}
function streakDays(){
  let n = 0;
  let ds = todayStr();
  if(!dayHasDone(ds)) ds = addDaysStr(ds, -1); // 今天还没打卡，从昨天往前算（今天没结束，不算断）
  while(dayHasDone(ds)){ n++; ds = addDaysStr(ds, -1); }
  return n;
}
function weekStats(){
  const dates = weekDates();
  let done=0, total=0;
  const byCat = {};
  for(const ds of dates){
    const d = state.days[ds];
    if(!d) continue;
    for(const t of d.tasks){
      total++;
      if(t.done){
        done++;
        const b = state.backlog.find(x=>x.id===t.backlogId);
        const cat = b ? (b.cat||"其他") : "其他";
        byCat[cat] = (byCat[cat]||0) + (t.min||0);
      }
    }
  }
  return {done, total, byCat, streak: streakDays()};
}
function cheerLine(streak, rate, total){
  if(streak >= 3) return `连续打卡 ${streak} 天，比上周更稳。`;
  if(streak >= 1) return `已经连续 ${streak} 天，今天也别断。`;
  if(total && rate >= 60) return `本周完成率 ${rate}%，节奏不错。`;
  if(total && rate > 0) return `本周开了个头，接着往下走。`;
  return `今天还没打卡，先做一件小的。`;
}
function renderWeek(){
  const st = weekStats();
  const cats = Object.entries(st.byCat).sort((a,b)=>b[1]-a[1]);
  const rate = st.total ? Math.round(st.done/st.total*100) : 0;
  $("weekStats").innerHTML = `
    <div class="cheer">${cheerLine(st.streak, rate, st.total)}</div>
    <div class="stat-row">
      <div class="stat"><div class="stat-n">${st.streak} 天</div><div class="stat-l">连续打卡</div></div>
      <div class="stat"><div class="stat-n">${st.done}/${st.total}</div><div class="stat-l">本周完成</div></div>
      <div class="stat"><div class="stat-n">${rate}%</div><div class="stat-l">完成率</div></div>
    </div>
    ${cats.length ? `<div class="stat-cats">${cats.map(([k,v])=>`<span class="scat"><b>${esc(k)}</b> ${fmtDur(v)}</span>`).join("")}</div>` : ""}`;

  const today = todayStr();
  let html = "";
  for(let i=0;i<7;i++){
    const ds = addDaysStr(today, i);
    const wd = "周" + DAY_NAMES[weekdayOf(ds)-1];
    const isToday = i===0;
    const items = [];
    for(const b of state.backlog){
      if(b.type==="deadline" && b.deadline && b.deadline === ds){
        items.push(`<span class="wk-deadline">${esc(b.name)} 截止</span>`);
      } else if(b.type==="habit"){
        const gap = daysSince(b.lastDone);
        const interval = b.interval || 1;
        const dueOffset = gap >= interval ? 0 : interval - gap; // 已逾期就归到今天，否则算还差几天
        if(dueOffset === i){
          items.push(`<span class="wk-habit">${esc(b.name)} ${gap >= interval ? "逾期" + gap + "天" : "该做了"}</span>`);
        }
      }
    }
    const label = isToday ? "今天" : (i===1 ? "明天" : ds.slice(5));
    html += `
      <div class="wk-day ${isToday?'today':''}">
        <div class="wk-hd"><div class="wk-date">${label}</div><div class="wk-wd">${wd}</div></div>
        <div class="wk-body">${items.length ? items.join("") : '<span class="wk-none">—</span>'}</div>
      </div>`;
  }
  $("weekList").innerHTML = html;
}

/* ---------- 记事本 ---------- */
function fmtNoteTime(ts){
  const d = new Date(ts), now = new Date();
  const md = (d.getMonth()+1) + "-" + pad(d.getDate());
  const hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
  return d.getFullYear() === now.getFullYear() ? md + " " + hm : d.getFullYear() + "-" + md + " " + hm;
}
function renderNotes(){
  const el = $("noteList");
  if(!state.notes.length){ el.innerHTML = '<div class="empty">还没记任何东西——上面输入框随手记一条，回车即存。</div>'; return; }
  el.innerHTML = state.notes.map((n,i)=>{
    const time = fmtNoteTime(n.ts);
    const del = `<span class="t-del" data-note-del="${i}">✕</span>`;
    if(n.type === "note"){
      return `<div class="note-item note-text">
        <div class="n-body"><div class="n-text">${esc(n.text)}</div><div class="n-time">${time}</div></div>
        ${del}
      </div>`;
    }
    return `<div class="note-item ${n.done?'done':''}">
      <div class="cb" data-note-check="${i}">${n.done?'✓':''}</div>
      <div class="n-body"><div class="n-text">${esc(n.text)}</div><div class="n-time">${time}</div></div>
      ${del}
    </div>`;
  }).join("");
}

/* ---------- 事件 ---------- */
function openModal(id){ $(id).classList.add("on"); }
function closeModal(id){ $(id).classList.remove("on"); }

$("datePicker").addEventListener("change", e => { state.date = e.target.value; save(); render(); });

/* 主题皮肤切换 */
$("themeBtn").addEventListener("click", e => {
  e.stopPropagation();
  $("themeMenu").classList.toggle("open");
});
$("themeMenu").addEventListener("click", e => {
  const b = e.target.closest("button[data-theme]");
  if(!b) return;
  applyTheme(b.dataset.theme);
  $("themeMenu").classList.remove("open");
  toast("皮肤：" + THEME_NAMES[b.dataset.theme]);
});
document.addEventListener("click", () => $("themeMenu").classList.remove("open"));
$("tabToday").addEventListener("click", ()=>{ view="today"; render(); });
$("tabBacklog").addEventListener("click", ()=>{ view="backlog"; render(); });
$("tabSchedule").addEventListener("click", ()=>{ view="schedule"; render(); });
$("tabWeek").addEventListener("click", ()=>{ view="week"; render(); });
$("tabNotes").addEventListener("click", ()=>{ view="notes"; render(); });

/* 从作息生成今日空闲 */
$("genFrag").addEventListener("click", ()=>{
  if(!state.schedule.length){ alert("先到「作息」页添加固定占用。"); return; }
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
$("bType").addEventListener("change", e=>{
  const isDeadline = e.target.value === "deadline";
  $("bDeadlineWrap").style.display = isDeadline ? "" : "none";
  $("bIntervalWrap").style.display = isDeadline ? "none" : "";
});
$("mBacklogOk").addEventListener("click", ()=>{
  const name = $("bName").value.trim();
  if(name){
    state.backlog.push({
      id: uid(), name, desc: $("bDesc").value.trim(), cat:"自定义",
      min: parseInt($("bMin").value,10)||20,
      energy: $("bEnergy").value, scene: $("bScene").value,
      type: $("bType").value, deadline: $("bType").value==="deadline" ? ($("bDeadline").value || null) : null,
      interval: parseInt($("bInterval").value,10) || 2, lastDone: todayStr(),
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
/* 点击委托：删除 / 打卡 */
document.addEventListener("click", e=>{
  const ss = e.target.closest("[data-sugg-single]");
  if(ss && lastSugg){
    const c = lastSugg.singles[+ss.dataset.suggSingle];
    if(c) scheduleItems([{item:c.item, min:c.item.min}]);
    return;
  }
  const sc = e.target.closest("[data-sugg-combo]");
  if(sc && lastSugg){
    const c = lastSugg.combos[+sc.dataset.suggCombo];
    if(c) scheduleItems(c.items.map(x=>({item:x, min:x.min})));
    return;
  }
  const df = e.target.closest("[data-del-frag]");
  if(df){ dayData().fragments.splice(+df.dataset.delFrag,1); save(); render(); return; }
  const dt = e.target.closest("[data-del-task]");
  if(dt){
    const d = dayData();
    const t = d.tasks[+dt.dataset.delTask];
    if(t && t.kind === "habit" && t.backlogId && !d.skipped.includes(t.backlogId)) d.skipped.push(t.backlogId);
    d.tasks.splice(+dt.dataset.delTask,1);
    save(); render(); return;
  }
  const db = e.target.closest("[data-del-backlog]");
  if(db){ state.backlog.splice(+db.dataset.delBacklog,1); save(); render(); return; }
  const dO = e.target.closest("[data-del-occ]");
  if(dO){ state.schedule.splice(+dO.dataset.delOcc,1); save(); render(); return; }
  const nd = e.target.closest("[data-note-del]");
  if(nd){ state.notes.splice(+nd.dataset.noteDel,1); save(); render(); return; }
  const nc = e.target.closest("[data-note-check]");
  if(nc){ state.notes[+nc.dataset.noteCheck].done = !state.notes[+nc.dataset.noteCheck].done; save(); render(); return; }
  const ck = e.target.closest("[data-check]");
  if(ck){
    const t = dayData().tasks[+ck.dataset.check];
    t.done = !t.done;
    if(t.done){
      if(t.backlogId){
        const b = state.backlog.find(x => x.id === t.backlogId);
        if(b) b.lastDone = todayStr();
      }
      toast(pick(CHEER)); // 打卡成功，弹一句鼓励
    }
    save(); render(); return;
  }
});

$("segEnergy").addEventListener("click", e=>{
  const b = e.target.closest("button"); if(!b) return;
  energy = b.dataset.v; [...$("segEnergy").children].forEach(x=>x.classList.toggle("on", x===b));
});
$("segScene").addEventListener("click", e=>{
  const b = e.target.closest("button"); if(!b) return;
  scene = b.dataset.v; [...$("segScene").children].forEach(x=>x.classList.toggle("on", x===b));
});

/* 记事本：类型切换 / 记下 */
$("segNoteType").addEventListener("click", e=>{
  const b = e.target.closest("button"); if(!b) return;
  noteType = b.dataset.v; [...$("segNoteType").children].forEach(x=>x.classList.toggle("on", x===b));
});
function addNote(){
  const text = $("noteInput").value.trim();
  if(!text){ $("noteInput").focus(); return; }
  state.notes.unshift({ id:uid(), type:noteType, text, done:false, ts:Date.now() }); // 最新在前
  $("noteInput").value = "";
  save(); render();
  $("noteInput").focus();
}
$("btnAddNote").addEventListener("click", addNote);
$("noteInput").addEventListener("keydown", e=>{
  if(e.key !== "Enter" || e.ctrlKey) return; // 普通回车保存；Ctrl+回车交给浏览器默认换行
  e.preventDefault();
  addNote();
});
$("btnSuggest").addEventListener("click", suggest);

document.querySelectorAll(".modal-mask").forEach(m=>{
  m.addEventListener("click", e=>{ if(e.target===m) m.classList.remove("on"); });
});

/* ---------- 轻提示 ---------- */
const CHEER = [
  "做完了，漂亮",
  "这一件拿下",
  "又往前挪了一步",
  "不错，接着来",
  "搞定，比昨天强",
  "今天也没落下",
];
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

/* ---------- PWA：主屏图标 / 离线缓存 / 打开时提醒 ---------- */
if("serviceWorker" in navigator){
  window.addEventListener("load", ()=>{
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  });
}
function maybeRemind(){
  if(!("Notification" in window) || Notification.permission !== "granted") return;
  const d = state.days[todayStr()];
  // 找"逾期且今天还没做"的习惯，断得最久的排前面，只弹它一条接回文案
  const overdue = state.backlog
    .filter(b => b.type === "habit")
    .map(b => ({ b, gap: b.lastDone ? daysSince(b.lastDone) : Infinity }))
    .filter(x => x.gap >= (x.b.interval || 1))
    .filter(x => !(d && d.tasks.some(t => t.backlogId === x.b.id && t.done)))
    .sort((a,b) => b.gap - a.gap);
  if(!overdue.length) return;
  const { b, gap } = overdue[0];
  const body = isFinite(gap)
    ? pick([
        `「${b.name}」断了 ${gap} 天，今天做一点就接上了`,
        `「${b.name}」空窗 ${gap} 天了，现在接回来刚刚好`,
        `「${b.name}」有 ${gap} 天没碰，今天先做 5 分钟，别让它继续断`,
      ])
    : pick([
        `「${b.name}」好久没碰了，今天做一点就接上`,
        `「${b.name}」该回来了，今天做一小份就续上`,
      ]);
  new Notification("陪伴·计划", { body });
}
if("Notification" in window && Notification.permission === "default"){
  window.addEventListener("load", ()=>{ Notification.requestPermission(); });
}
window.addEventListener("load", ()=>{ setTimeout(maybeRemind, 800); });
