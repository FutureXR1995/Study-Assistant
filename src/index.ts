import express from "express";
import dotenv from "dotenv";
import webhookRouter from "./routes/webhook.js";
import pushRouter from "./routes/push.js";
import healthRouter from "./routes/health.js";
import adminPageRouter from "./routes/admin.js";
import { getConfirmationsByDateJst, getConfirmationsByDateJstAndUser, getDistinctUserIds, getUserProfilesMap, upsertUserProfile, getUsersLeaderboard } from "./lib/db.js";
import fs from "node:fs";
import path from "node:path";
import { getUserProfile } from "./lib/line.js";
import { getPomodoroConfig } from "./lib/pomodoro.js";
import { getStudySessionsByDateJst, getStudySessionsByDateJstAndUser } from "./lib/db.js";
import { getPomodoroSummary, createCard, listDueCards, reviewCard, listRecentCards } from "./lib/db.js";
import { buildTasksText } from "./lib/line.js";

dotenv.config();

const app = express();

// 捕获原始请求体用于 LINE 签名校验
app.use(express.json({ verify: (req, _res, buf) => ((req as any).rawBody = buf.toString("utf8")) }));

// 简易管理保护（可选）：设置 ADMIN_TOKEN 则需要通过 ?token=... 访问 /admin 页面与 /admin/* 接口
app.use((req, res, next) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return next();
  const ok = req.path.startsWith('/admin') ? (req.query.token === token) : true;
  if (!ok) return res.status(401).send('Unauthorized');
  return next();
});

app.use("/line", webhookRouter);
app.use("/api", pushRouter);
app.use("/", healthRouter);
app.use("/", adminPageRouter);
// 根路径重定向到聚合主页
app.get("/", (_req, res) => res.redirect(302, "/home"));

// 聚合主页：番茄钟、闪卡（输入/历史）、今日任务
app.get("/home", (_req, res) => {
  const liffId = process.env.LIFF_ID || "";
  const html = `<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/><title>学习主页</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;max-width:960px;margin:24px auto;padding:0 12px;color:#222}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
    .card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;background:#fff}
    .card h3{margin:0 0 8px 0}
    a.btn{display:inline-block;margin-top:8px;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;text-decoration:none;color:#111;background:#fafafa}
    .muted{color:#666;font-size:12px;margin-bottom:8px}
  </style>
  <script src=\"https://static.line-scdn.net/liff/edge/2/sdk.js\"></script>
  </head><body>
  <h2>学习主页</h2>
  <div class=\"muted\" id=\"who\">正在识别用户...</div>
  <div class=\"grid\">
    <div class=\"card\">
      <h3>番茄钟</h3>
      <div>专注计时，自动短休/长休。</div>
      <a id=\"goPomo\" class=\"btn\" href=\"/pomodoro\">打开番茄钟 ▶️</a>
    </div>
    <div class=\"card\">
      <h3>闪卡复习</h3>
      <div>SM-2 记忆曲线，支持新增与复习。</div>
      <a id=\"goFlash\" class=\"btn\" href=\"/flashcards\">进入闪卡 ▶️</a>
      <a id=\"goList\" class=\"btn\" href=\"/flashcards/list\" style=\"margin-left:6px\">查看历史 📚</a>
    </div>
    <div class=\"card\">
      <h3>今日任务</h3>
      <div>查看今日学习安排与说明。</div>
      <a id=\"goDaily\" class=\"btn\" href=\"/daily\">查看今日任务 📆</a>
    </div>
  </div>
  <script>
    const LIFF_ID='${liffId}';
    async function init(){ let uid=''; try{ if(LIFF_ID){ await liff.init({ liffId: LIFF_ID }); const prof=await liff.getProfile(); uid=prof.userId||''; } }catch(e){}
      document.getElementById('who').textContent = '当前用户：' + (uid||'(未识别，使用默认)');
      if(uid){
        const setQ=(id,path)=>{ const a=document.getElementById(id); if(a){ const u=new URL(a.getAttribute('href'), window.location.origin); u.searchParams.set('userId', uid); a.setAttribute('href', u.toString()); }};
        setQ('goFlash','/flashcards'); setQ('goList','/flashcards/list'); setQ('goDaily','/daily');
      }
    }
    init();
  </script>
  </body></html>`;
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.send(html);
});
// 简单的听力训练页与上报接口
app.get("/listening", (_req, res) => {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>听力训练</title>
  <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;max-width:720px;margin:24px auto;padding:0 12px;color:#222} input,button{padding:6px 8px} audio{width:100%;margin-top:8px}</style></head>
  <body>
    <h2>听力训练（最小版）</h2>
    <div>
      <input id="url" placeholder="粘贴音频链接 (mp3/m4a)" style="width:70%"/>
      <button id="load">加载</button>
    </div>
    <audio id="player" controls></audio>
    <div style="margin-top:8px">
      <label>A 点</label><input id="a" type="number" value="0" style="width:80px"/> s
      <label style="margin-left:8px">B 点</label><input id="b" type="number" value="0" style="width:80px"/> s
      <button id="loop">AB 循环</button>
    </div>
    <div style="margin-top:8px">
      <label>本次学习分钟</label><input id="mins" type="number" value="15" style="width:80px"/> 
      <button id="report">上报</button> <span id="msg" style="margin-left:8px;color:#0a7"></span>
    </div>
    <script>
    const $=id=>document.getElementById(id); let h=null;
    $('load').onclick=()=>{ const u=$('url').value.trim(); if(!u) return; $('player').src=u; };
    $('loop').onclick=()=>{ const a=Number($('a').value||0), b=Number($('b').value||0); if(h) clearInterval(h); if(b>a){ const p=$('player'); h=setInterval(()=>{ if(p.currentTime>=b){ p.currentTime=a; } }, 250); } };
    $('report').onclick=async()=>{ const m=Number($('mins').value||0); if(!m) return; const r=await fetch('/listening/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ minutes:m })}); const ok=r.ok; $('msg').style.color= ok?'#0a7':'#b00'; $('msg').textContent= ok?'已上报':'失败'; };
    </script>
  </body></html>`;
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.send(html);
});

// 今日任务（展示静态计划文本，可后续接入 plan 配置）
app.get("/daily", (_req, res) => {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>今日任务</title>
  <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;max-width:720px;margin:24px auto;padding:0 12px;color:#222} pre{white-space:pre-wrap;background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;padding:12px}</style></head>
  <body>
    <h2>今日任务</h2>
    <div style="margin-bottom:8px"><a href="/home">返回主页</a></div>
    <pre>${buildTasksText()}</pre>
  </body></html>`;
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.send(html);
});
app.post("/listening/report", express.json(), async (req, res) => {
  try {
    const user = (process.env.DEFAULT_LINE_USER_ID as string) || '';
    const minutes = Math.max(1, Number((req.body||{}).minutes||0));
    if (!user) return res.status(400).json({ error: 'no default user' });
    if (!minutes) return res.status(400).json({ error: 'invalid minutes' });
    // 复用任务分钟入库
    const { insertTaskMinutes } = await import('./lib/db.js');
    await insertTaskMinutes(user, 'listening' as any, minutes);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message||e) });
  }
});

// Flashcards MVP
app.get("/flashcards", (req, res) => {
  const liffId = process.env.LIFF_ID || "";
  const html = `<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/><title>闪卡 (SRS)</title>
  <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;max-width:820px;margin:24px auto;padding:0 12px;color:#222} .card{border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:12px 0} textarea,input,button{padding:6px 8px}</style>
  <script src=\"https://static.line-scdn.net/liff/edge/2/sdk.js\"></script>
  </head>
  <body>
    <h2>闪卡（支持 SM-2）</h2>
    <div id="who" style="margin:4px 0;color:#666"></div>
    <div style="margin-bottom:8px"><a id="linkList" href="/flashcards/list">查看输入记录</a></div>
    <div class="card">
      <h3>新增卡片</h3>
      <div><input id="front" placeholder="单词/正面" style="width:40%"/> <input id="back" placeholder="释义" style="width:55%"/></div>
      <div style="margin-top:6px"><input id="example" placeholder="例句 (可选)" style="width:96%"/></div>
      <div style="margin-top:6px"><input id="tags" placeholder="标签 (逗号分隔)" style="width:40%"/> <button id="add">添加</button> <span id="msg" style="margin-left:8px;color:#0a7"></span></div>
    </div>
    <div class="card">
      <h3>今日到期</h3>
      <div id="review"></div>
    </div>
    <script>
    const $=id=>document.getElementById(id);
    const tts = (txt)=>{ try{ const u=new SpeechSynthesisUtterance(txt); speechSynthesis.cancel(); speechSynthesis.speak(u);}catch(e){} };
    const LIFF_ID='${liffId}';
    let LIFF_UID='';
    async function tryInitLiff(){ if(!LIFF_ID){ return ''; } try{ await liff.init({ liffId: LIFF_ID }); const prof= await liff.getProfile(); return prof.userId||''; }catch(e){ return ''; } }
    function getUser(){ try{ const u=new URL(window.location.href); return u.searchParams.get('userId')||''; }catch(e){ return ''; } }
    (async function initUser(){ let uid=getUser(); if(!uid){ uid = await tryInitLiff(); } LIFF_UID = uid; $('who').textContent = '当前用户：' + (uid||'(默认)'); const a=document.getElementById('linkList'); if(a){ a.href = '/flashcards/list' + (uid?('?userId='+encodeURIComponent(uid)):''); } })();
    async function loadDue(){ const uid=(LIFF_UID||getUser()); const u='/api/cards?due=today'+(uid?('&userId='+encodeURIComponent(uid)):''); const r=await fetch(u).then(r=>r.json()); const arr=r||[]; if(!arr.length){ $('review').innerHTML='<small>今日无到期</small>'; return; }
      let i=0; const el=$('review'); function render(){ const c=arr[i]; if(!c){ el.innerHTML='<small>已完成</small>'; return; }
        el.innerHTML = '<div><b>'+c.front+'</b> <button id="speak">🔊</button></div>'
          + '<div id="back" style="margin-top:6px;display:none">'+((c.back||'')+(c.example?('<div style="color:#555">'+c.example+'</div>'):''))+'</div>'
          + '<div style="margin-top:8px"><button id="flip">翻面</button>'
          + '<button data-g="0">忘记</button><button data-g="3">一般</button><button data-g="4">容易</button><button data-g="5">非常容易</button>'
          + '<button id="mn">生成联想（预留）</button></div>';
        $('flip').onclick=()=>{ const b=$('back'); b.style.display=b.style.display==='none'?'block':'none'; };
        $('speak').onclick=()=>tts(c.front);
        Array.from(el.querySelectorAll('button[data-g]')).forEach(btn=>{ btn.onclick=async()=>{ const g=Number(btn.getAttribute('data-g')); await fetch('/api/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cardId:c.id,grade:g})}); i++; render(); } });
        $('mn').onclick=()=>{ alert('将在下一阶段接入 AI 生成联想。'); };
      }
      render();
    }
    $('add').onclick=async()=>{ const uid=(LIFF_UID||getUser()); const front=$('front').value.trim(); if(!front){ return; } const body={ front, back:$('back').value, example:$('example').value, tags:$('tags').value, userId: uid }; const r=await fetch('/api/cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); $('msg').style.color=r.ok?'#0a7':'#b00'; $('msg').textContent=r.ok?'已添加':'失败'; if(r.ok){ $('front').value=''; $('back').value=''; $('example').value=''; $('tags').value=''; loadDue(); } };
    loadDue();
    </script>
  </body></html>`;
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.send(html);
});

app.get("/api/cards", async (req, res) => {
  const user = (String(req.query.userId || '') || (process.env.DEFAULT_LINE_USER_ID as string) || 'local');
  const today = new Date().toISOString().slice(0,10);
  const list = await listDueCards(user, today);
  res.json(list);
});
app.post("/api/cards", express.json(), async (req, res) => {
  try{
    const input = req.body || {};
    const user = String(input.userId || '') || (process.env.DEFAULT_LINE_USER_ID as string) || 'local';
    if (!input.front) return res.status(400).json({ error: 'front required' });
    const row = await createCard(user, { front: input.front, back: input.back, example: input.example, language: input.language, tags: input.tags });
    res.json(row);
  }catch(e:any){ res.status(500).json({ error: String(e?.message||e) }); }
});
app.post("/api/review", express.json(), async (req, res) => {
  try{
    const { cardId, grade, userId } = req.body || {};
    const user = String(userId || '') || (process.env.DEFAULT_LINE_USER_ID as string) || 'local';
    if (!cardId) return res.status(400).json({ error: 'cardId required' });
    const out = await reviewCard(user, Number(cardId), Number(grade));
    res.json(out);
  }catch(e:any){ res.status(500).json({ error: String(e?.message||e) }); }
});

// 最近输入的卡片列表
app.get("/api/cards/recent", async (req, res) => {
  const all = String(req.query.all || "").trim() === "1";
  const overrideUser = String(req.query.userId || '').trim();
  const user = overrideUser ? overrideUser : (all ? undefined : (((process.env.DEFAULT_LINE_USER_ID as string) || 'local')));
  const limit = Number(req.query.limit || 100);
  const rows = await listRecentCards(user, limit);
  res.json(rows);
});

// 显示最近输入记录的页面
app.get("/flashcards/list", (_req, res) => {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>闪卡输入记录</title>
  <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;max-width:900px;margin:24px auto;padding:0 12px;color:#222} table{border-collapse:collapse;width:100%} th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left} th{background:#f8fafc}</style></head>
  <body>
    <h2>最近输入的卡片</h2>
    <div style="margin-bottom:8px"><a href="/flashcards">返回闪卡</a></div>
    <table id="t"><thead><tr><th>ID</th><th>用户</th><th>单词</th><th>释义</th><th>例句</th><th>标签</th><th>时间</th></tr></thead><tbody></tbody></table>
    <script>
    function getUser(){ try{ const u=new URL(window.location.href); return u.searchParams.get('userId')||''; }catch(e){ return ''; } }
    async function load(){ const uid=getUser(); const url = uid ? ('/api/cards/recent?limit=200&userId='+encodeURIComponent(uid)) : '/api/cards/recent?limit=200&all=1'; const rows=await fetch(url).then(r=>r.json()); const tb=document.querySelector('#t tbody'); tb.innerHTML=''; for(const r of rows){ const tr=document.createElement('tr'); tr.innerHTML='<td>'+r.id+'</td><td>'+escapeHtml(r.userId||'')+'</td><td>'+escapeHtml(r.front||'')+'</td><td>'+escapeHtml(r.back||'')+'</td><td>'+escapeHtml(r.example||'')+'</td><td>'+escapeHtml(r.tags||'')+'</td><td>'+r.createdAtJst+'</td>'; tb.appendChild(tr);} }
    function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
    load();
    </script>
  </body></html>`;
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.send(html);
});

// 静默处理 favicon 请求，避免控制台 404
app.get("/favicon.ico", (_req, res) => res.status(204).end());
// 用户列表
app.get("/admin/users", async (_req, res) => {
  const [ids, profiles] = await Promise.all([getDistinctUserIds(), getUserProfilesMap()]);
  const list = ids.map((id) => ({ userId: id, displayName: profiles[id]?.displayName || id }));
  return res.json(list);
});

// 回填昵称：遍历现有 userId 拉取 LINE Profile 并缓存
app.post("/admin/backfill-profiles", async (_req, res) => {
  try {
    const ids = await getDistinctUserIds();
    const updated: string[] = [];
    const errors: Array<{ userId: string; error: string }> = [];
    for (const userId of ids) {
      try {
        const prof = await getUserProfile(userId);
        await upsertUserProfile(userId, prof.displayName, prof.pictureUrl);
        updated.push(userId);
      } catch (e: any) {
        errors.push({ userId, error: String(e?.message || e) });
      }
    }
    return res.json({ count: updated.length, errors });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// 方便从浏览器直接触发（无需 JS）
app.get("/admin/backfill-profiles", async (req, res) => {
  try {
    const ids = await getDistinctUserIds();
    const updated: string[] = [];
    const errors: Array<{ userId: string; error: string }> = [];
    for (const userId of ids) {
      try {
        const prof = await getUserProfile(userId);
        await upsertUserProfile(userId, prof.displayName, prof.pictureUrl);
        updated.push(userId);
      } catch (e: any) {
        errors.push({ userId, error: String(e?.message || e) });
      }
    }
    return res.json({ count: updated.length, errors });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// 计划文件上传/获取
// PUT /admin/plan?version=toeic-12d-v1 (body 为完整 JSON)
app.put("/admin/plan", async (req, res) => {
  try {
    const version = String(req.query.version || "");
    if (!version) return res.status(400).json({ error: "version required" });
    const file = path.resolve("config", `plan-${version}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(req.body || {}, null, 2), "utf8");
    return res.json({ ok: true, file });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// GET /admin/plan?version=toeic-12d-v1 返回当前计划 JSON
app.get("/admin/plan", async (req, res) => {
  try {
    const version = String(req.query.version || "");
    if (!version) return res.status(400).json({ error: "version required" });
    const file = path.resolve("config", `plan-${version}.json`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "plan not found" });
    const raw = fs.readFileSync(file, "utf8");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.send(raw);
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// 简报接口：GET /admin/confirmations?date=YYYY-MM-DD
app.get("/admin/confirmations", async (req, res) => {
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  const userId = (req.query.userId as string) || "";
  const data = userId ? await getConfirmationsByDateJstAndUser(date, userId) : await getConfirmationsByDateJst(date);
  return res.json(data);
});

// 学习会话简报：GET /admin/sessions?date=YYYY-MM-DD
app.get("/admin/sessions", async (req, res) => {
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  const userId = (req.query.userId as string) || "";
  const data = userId ? await getStudySessionsByDateJstAndUser(date, userId) : await getStudySessionsByDateJst(date);
  return res.json(data);
});

// 近 N 天聚合：GET /admin/weekly?days=7
app.get("/admin/weekly", async (req, res) => {
  const days = Math.max(1, Math.min(31, Number(req.query.days || 7)));
  const userId = (req.query.userId as string) || "";
  const today = new Date();
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    dates.push(d.toISOString().slice(0, 10));
  }
  const confirmations = await Promise.all(dates.map((d) => userId ? getConfirmationsByDateJstAndUser(d, userId) : getConfirmationsByDateJst(d)));
  const sessions = await Promise.all(dates.map((d) => userId ? getStudySessionsByDateJstAndUser(d, userId) : getStudySessionsByDateJst(d)));
  const perTaskKeys = ["vocab", "grammar", "listening", "reading"] as const;
  const perTask: Record<string, Array<{ done: number; miss: number }>> = {
    vocab: [], grammar: [], listening: [], reading: []
  };
  const totalMinutes: number[] = [];
  const totalCount: number[] = [];
  confirmations.forEach((c, idx) => {
    perTaskKeys.forEach((k) => {
      const done = ((c as any).byTask?.[k]?.done || 0) as number;
      const miss = ((c as any).byTask?.[k]?.miss || 0) as number;
      perTask[k].push({ done, miss });
    });
    totalCount.push((c as any).count || 0);
    totalMinutes.push((sessions[idx] as any).totalMinutes || 0);
  });
  return res.json({ dates, perTask, totalCount, totalMinutes });
});

// 导出 CSV：/admin/export.csv?date=YYYY-MM-DD[&userId=Uxxx]
app.get("/admin/export.csv", async (req, res) => {
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  const userId = (req.query.userId as string) || "";
  const data = userId ? await getConfirmationsByDateJstAndUser(date, userId) : await getConfirmationsByDateJst(date);
  const rows: any[] = (data as any).rows || [];
  const header = ["id","userId","task","status","createdAtJst"]; 
  const csv = [header.join(",")].concat(
    rows.map((r:any)=> [r.id, r.userId, r.task||"", r.status, r.createdAtJst].map((x:any)=>`"${String(x||"").split('"').join('""')}"`).join(","))
  ).join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=export_${date}.csv`);
  return res.send(csv);
});

// 排行榜：/admin/leaderboard
app.get("/admin/leaderboard", async (_req, res) => {
  const data = await getUsersLeaderboard();
  return res.json(data);
});

// 番茄统计 API：/admin/pomodoro/summary?days=14[&userId=Uxxx]
app.get("/admin/pomodoro/summary", async (req, res) => {
  const days = Math.max(1, Math.min(60, Number(req.query.days || 14)));
  const userId = (req.query.userId as string) || undefined;
  const data = await getPomodoroSummary(days, userId);
  return res.json(data);
});

// 番茄配置 API：/api/pomodoro/config
app.get("/api/pomodoro/config", (_req, res) => {
  return res.json(getPomodoroConfig());
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});