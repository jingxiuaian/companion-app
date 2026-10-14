/* ============================================================
 * 「陪伴·计划」演示数据 · 一键填充
 *
 * 用法：
 *   1. 打开应用（双击 companion-app/index.html）
 *   2. 按 F12 → 切到 Console（控制台）
 *   3. 全选粘贴下面整段 → 回车
 *   4. 页面立刻变成演示状态，不用刷新
 *
 * 注意：会覆盖当前数据。想先备份，在控制台执行：
 *   copy(localStorage.getItem("companion-plan-v2"))
 * 再把结果粘到记事本里存着。
 *
 * 它为什么这么写：不用手搓时间，而是调用应用自己的
 * genFromSchedule() 和 importTasks()，所以无论你哪天几点录，
 * 排出来的碎片和任务都跟你填的作息对得上。
 * ============================================================ */
(() => {
  const D = n => { const d = new Date(); d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const today = D(0);

  /* 每周固定占用：工作日一套，休息日一套（作息页会按「工作日 / 休息日 / 每天」分组显示） */
  state.schedule = [
    { days:[1,2,3,4,5],   start:"08:00", end:"12:00", label:"上课" },
    { days:[1,2,3,4,5],   start:"14:00", end:"17:00", label:"上课" },
    { days:[1,2,3,4,5,6,7], start:"12:00", end:"13:00", label:"午饭" },
    { days:[1,2,3,4,5,6,7], start:"18:00", end:"19:00", label:"晚饭" },
    { days:[6,7],         start:"09:00", end:"11:00", label:"休息日自习" },
    { days:[6,7],         start:"16:00", end:"17:30", label:"打球" },
  ];

  /* 事项池：习惯 + 截止型混着放，标签覆盖低/中/高精力和室内/室外 */
  state.backlog = [
    { id:"b-english", name:"英语单词", desc:"每天 50 个，别贪多", cat:"英语", min:20,
      energy:"高", scene:"不限", type:"habit", deadline:null, interval:1, lastDone:D(-3) },
    { id:"b-law", name:"法学网课", desc:"自考四门里最难的那门", cat:"法学", min:30,
      energy:"中", scene:"室内", type:"habit", deadline:null, interval:1, lastDone:D(-2) },
    { id:"b-ctf", name:"CTF-Web", desc:"靶场一次一道题", cat:"技能", min:60,
      energy:"高", scene:"室内", type:"habit", deadline:null, interval:2, lastDone:D(-5) },
    { id:"b-read", name:"读《被讨厌的勇气》", desc:"睡前读几页", cat:"读书", min:30,
      energy:"低", scene:"室内", type:"habit", deadline:null, interval:1, lastDone:null },
    { id:"b-gym", name:"低冲击健身", desc:"膝盖不好，别跑跳", cat:"健康", min:30,
      energy:"中", scene:"不限", type:"habit", deadline:null, interval:2, lastDone:D(-1) },
    { id:"b-exam", name:"专升本英语真题", desc:"一套真题 + 订正", cat:"英语", min:45, must:true,
      energy:"高", scene:"室内", type:"deadline", deadline:D(21), unit:"考试", interval:2, lastDone:null },
    { id:"b-cut", name:"剪参赛视频", desc:"配音 + 字幕 + 导出", cat:"技能", min:60,
      energy:"高", scene:"室内", type:"deadline", deadline:D(3), unit:"交片", interval:2, lastDone:null },
  ];

  state.days = {};
  state.notes = [
    { id:"n1", type:"note", text:"今天状态一般，但把英语接回来了，这就够了。", done:false, ts:Date.now() - 3600000 },
    { id:"n2", type:"todo", text:"周日把剪辑素材整理一下", done:false, ts:Date.now() - 7200000 },
  ];
  state.date = today;

  settings.importMode = "due";  // 一键导入 = 今天该做的
  saveSettings();

  /* 用应用自己的逻辑排今天的碎片和任务，保证跟你填的作息一致。
     注意一个真实行为：过了期的习惯（英语单词、法学网课、CTF-Web）会被
     autoGenHabits 自动列进今日计划 —— 这正是"断档即接回"在界面上的样子，
     所以录制时讲这几条"我断了 3 天、5 天，打开它已经躺在今天的计划里了"。 */
  dayData().fragments = genFromSchedule(state.schedule, today);
  importTasks(dueItems());

  /* 预先完成两条并填上实际耗时 —— 打开就能看到「实际 30m（预计 30m）」
     这种对比。剩两条（英语单词、读《被讨厌的勇气》）留给你在镜头前打卡。 */
  const preset = { "b-law":30, "b-ctf":50 };
  dayData().tasks.forEach(t => {
    if(!(t.backlogId in preset)) return;
    t.done = true;
    t.actual = preset[t.backlogId];
    const b = state.backlog.find(x => x.id === t.backlogId);
    if(b) b.lastDone = today;
  });

  lastSugg = null;
  save(); render();
  alert("演示数据已就绪：\n· 空闲碎片 " + dayData().fragments.length + " 段\n" +
        "· 今日计划 " + dayData().tasks.length + " 条（2 条已完成，2 条留给你打卡）\n" +
        "· 事项池 7 条：「英语单词」断了 3 天、「CTF-Web」断了 5 天");
})()
