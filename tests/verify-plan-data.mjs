/* 冲刺数据完整性验收台：直接读 plan-data.js，验证
   ① 每个考点都有完整正文（不再被截断）
   ② 曾经的"半句"条目已补全（马原第3条等）
   ③ 数字/页码等提取噪声没混进要点
   纯数据检查，不依赖 DOM。跑法：node tests/verify-plan-data.mjs */
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../plan-data.js", import.meta.url), "utf8");
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: "companion-app/plan-data.js" });

const plan = ctx.window.PLAN;
const days = (plan && plan.days) || [];
const all = [];
for (const d of days) for (const it of d.items) all.push(it);
const kaodian = all.filter(i => i.kind === "kaodian");
const find = id => all.find(i => i.id === id);

const results = [];
const ok = (name, cond, extra) => results.push({ pass: !!cond, name, extra: extra || "" });

/* ---- 规模 ---- */
ok("计划数据已加载", !!plan && days.length === 11, "days=" + days.length);
ok("学习单元 >= 420", all.length >= 420, "total=" + all.length);
ok("考点 >= 360", kaodian.length >= 360, "kaodian=" + kaodian.length);

/* ---- 每条考点都有正文 ---- */
const emptyBody = kaodian.filter(i => !i.point || !i.point.replace(/^考期：[^·]*/, "").trim());
ok("没有「只有考期、没有正文」的条目", emptyBody.length === 0,
   emptyBody.map(i => i.id).join(","));
const onlyKaoqi = kaodian.filter(i => /^考期：[^·]*$/.test(i.point.trim()));
ok("没有正文只剩考期标注的条目", onlyKaoqi.length === 0, onlyKaoqi.map(i => i.id).join(","));

/* ---- 要点不再是"一句话砍半"：正文普遍更长 ---- */
const long = kaodian.filter(i => i.point.length >= 100);
ok("正文 >= 100 字的考点 >= 150 条", long.length >= 150, "long=" + long.length);
const lens = kaodian.map(i => i.point.length).sort((a, b) => a - b);
ok("要点中位长度 >= 100 字", lens[Math.floor(lens.length / 2)] >= 100,
   "median=" + lens[Math.floor(lens.length / 2)]);

/* ---- 曾经的半句条目：逐个复核（回归护栏） ---- */
const myF03 = find("my-f-03");
ok("马原第3条 唯物主义和唯心主义的分类 存在", !!myF03, "");
ok("马原第3条含完整第三种形态（原先截断在「辩」）",
   !!myF03 && myF03.point.includes("辩证唯物主义和历史唯物主义"), myF03 ? myF03.point.slice(-40) : "");
ok("马原第3条含原先被丢掉的第2小点（客观唯心主义）",
   !!myF03 && myF03.point.includes("客观唯心主义") && myF03.point.includes("绝对精神"), "");

const myF05 = find("my-f-05");
ok("运动和物质含完整第3点（原先截断在「动中有静,」）",
   !!myF05 && myF05.point.includes("静中有动"), myF05 ? myF05.point.slice(-30) : "");

const myF02 = find("my-f-02");
ok("马克思主义理论来源含第3条（英法空想社会主义，原先整条丢失）",
   !!myF02 && myF02.point.includes("英法两国空想社会主义"), myF02 ? myF02.point.slice(-30) : "");

const gsfK89 = find("gsf-k-89");
ok("公司债与公司股份的区别 含第4点（原先截断在「投资人」）",
   !!gsfK89 && gsfK89.point.includes("发行时间上的差异") && gsfK89.point.includes("股票既可以在公司设立过程中发行"), "");

const myK19 = find("my-k-19");
ok("意识的起源 不再混入下一个标题的残句", !!myK19 && !myK19.point.includes("解放思想"), myK19 ? myK19.point.slice(-24) : "");
ok("标题「解放思想，实事求是」被正确复原",
   all.some(i => i.title.replace(/[，,]/g, "").includes("解放思想实事求是")), "");

const myF18 = find("my-f-18");
ok("社会主义从空想到科学 不再把页脚页码混进正文",
   !!myF18 && !/[0-9]\s*\/\s*；?\s*[0-9]*\s*$/.test(myF18.point), myF18 ? myF18.point.slice(-20) : "");

/* ---- 提取噪声回归：数字没丢、没有裸露的"世纪" ---- */
const myK01 = find("my-k-01");
ok("马原·马克思主义的产生 恢复了年份（19世纪40年代中期）",
   !!myK01 && myK01.point.includes("19世纪40年代中期"), myK01 ? myK01.point : "");
const bareCentury = kaodian.filter(i => /[（(]世纪|[^\d]年月发表/.test(i.point));
ok("要点里没有「（世纪」这类丢数字的残迹", bareCentury.length === 0,
   bareCentury.slice(0, 3).map(i => i.id).join(","));
const pageNoise = kaodian.filter(i => /[0-9]{1,3}\s*\/\s*；?\s*[0-9]{0,3}\s*$/.test(i.point));
ok("要点里没有页脚页码残迹", pageNoise.length === 0, pageNoise.slice(0, 3).map(i => i.id).join(","));

/* ---- 旧截断长度指纹：不该再有大片"正好卡在 N 字且半句结束"的要点 ---- */
const limits = [48, 52, 56, 60];
const cutAt = kaodian.filter(i => limits.includes(i.point.length) && !/[。！？…）)]$/.test(i.point));
ok("几乎没有「卡在旧截断长度且半句收尾」的要点（<=2）", cutAt.length <= 2,
   "n=" + cutAt.length + " " + cutAt.map(i => i.id).join(","));

/* ---- 单词组仍然完整 ---- */
const wordItem = all.find(i => i.kind === "words");
ok("英语词表组仍有 words 数组", !!wordItem && Array.isArray(wordItem.words) && wordItem.words.length === 200,
   wordItem ? "words=" + wordItem.words.length : "");

let failed = 0;
console.log("冲刺数据完整性验收（plan-data.js，纯数据）\n");
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.extra ? "   [" + r.extra + "]" : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
