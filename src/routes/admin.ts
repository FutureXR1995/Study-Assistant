import { Router, Request, Response } from "express";

const router = Router();

router.get("/admin", async (_req: Request, res: Response) => {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Toeic Reminder Admin</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;max-width:960px;margin:24px auto;padding:0 12px;color:#222}
    header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
    h1{font-size:20px;margin:0}
    .card{border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:12px}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left}
    th{background:#f8fafc}
    small{color:#666}
    .row{display:flex;gap:12px;flex-wrap:wrap}
    .row>.card{flex:1 1 300px}
    input[type=date]{padding:6px 8px}
    button{padding:6px 10px;border:1px solid #e5e7eb;background:#fff;border-radius:6px;cursor:pointer}
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
</head>
<body>
  <header>
    <h1>Toeic Reminder Admin</h1>
    <div>
      <label>用户: <select id="user"></select></label>
      <input id="date" type="date" />
      <button id="reload" type="button">刷新</button>
      <button id="backfill" type="button">回填昵称</button>
      <span id="msg" style="margin-left:8px;color:#0a7"> </span>
    </div>
  </header>
  <div class="row">
    <div class="card" style="flex:2">
      <h3>当日确认</h3>
      <div id="summary"></div>
      <div id="byTask"></div>
      <details style="margin-top:6px"><summary>原始数据</summary><pre id="rawConf" style="white-space:pre-wrap"></pre></details>
    </div>
    <div class="card" style="flex:1">
      <h3>学习会话</h3>
      <div id="sessions"></div>
      <details style="margin-top:6px"><summary>原始数据</summary><pre id="rawSess" style="white-space:pre-wrap"></pre></details>
    </div>
    <div class="card" style="flex:1">
      <h3>积分榜</h3>
      <div id="leaderboard"></div>
    </div>
  </div>
  <div class="card">
    <h3>说明</h3>
    <small>本页读取接口：/admin/confirmations 与 /admin/sessions。可选日期后点击刷新。</small>
  </div>
  <div class="card">
    <h3>近 7 天趋势</h3>
    <div>
      <canvas id="chartCount" height="120"></canvas>
      <canvas id="chartMinutes" height="120" style="margin-top:12px"></canvas>
      <canvas id="chartTasks" height="140" style="margin-top:12px"></canvas>
    </div>
    <div style="margin-top:8px">
      <button id="dlCsv" type="button">导出当日 CSV</button>
    </div>
    <details style="margin-top:6px"><summary>原始数据</summary><pre id="rawWeekly" style="white-space:pre-wrap"></pre></details>
  </div>
  <div class="card">
    <h3>番茄统计（14 天）</h3>
    <canvas id="chartPomo" height="120"></canvas>
    <div id="byTaskPomo" style="margin-top:8px"></div>
  </div>
  <script>
    const $ = (id) => document.getElementById(id);
    const fmt = (n) => Number(n||0).toLocaleString();
    function todayISO(){ const d = new Date(); const z = new Date(d.getTime()-d.getTimezoneOffset()*60000); return z.toISOString().slice(0,10); }
    function getToken(){ try { const u = new URL(window.location.href); return u.searchParams.get('token')||''; } catch(e){ return ''; } }
    async function load(date){
      const userId = $('user').value || '';
      const token = getToken();
      const qsUser = userId ? ('&userId='+encodeURIComponent(userId)) : '';
      const qsToken = token ? ('&token='+encodeURIComponent(token)) : '';
      const [c,s,lb] = await Promise.all([
        fetch('/admin/confirmations?date='+date+qsUser+qsToken).then(r=>r.json()),
        fetch('/admin/sessions?date='+date+qsUser+qsToken).then(r=>r.json()),
        fetch('/admin/leaderboard'+(token?('?token='+encodeURIComponent(token)):'')).then(r=>r.json())
      ]);
      $('rawConf').textContent = JSON.stringify(c,null,2);
      $('rawSess').textContent = JSON.stringify(s,null,2);
      $('summary').innerHTML = '<div>总计：<b>' + fmt(c.count) + '</b> 条，✅ ' + fmt((c.summary&&c.summary.done)||0) + '，❌ ' + fmt((c.summary&&c.summary.miss)||0) + '</div>';
      const tasks = ['vocab','grammar','listening','reading'];
      const labels = {vocab:'词汇',grammar:'语法',listening:'听力',reading:'阅读'};
      let t = '<table><thead><tr><th>任务</th><th>✅ 完成</th><th>❌ 未完成</th></tr></thead><tbody>';
      for(const k of tasks){ const d=(c.byTask&&c.byTask[k])||{}; t += '<tr><td>'+labels[k]+'</td><td>'+fmt(d.done||0)+'</td><td>'+fmt(d.miss||0)+'</td></tr>'; }
      t+='</tbody></table>';
      $('byTask').innerHTML = t;
      $('sessions').innerHTML = '<div>总会话：<b>'+fmt(s.count)+'</b>，总时长：<b>'+fmt(s.totalMinutes)+'</b> 分钟</div>';
      // leaderboard
      let lbHtml = '<table><thead><tr><th>名次</th><th>用户</th><th>积分</th><th>连击</th></tr></thead><tbody>';
      (lb||[]).forEach((u,i)=>{ lbHtml += '<tr><td>'+(i+1)+'</td><td>'+(u.displayName||u.userId)+'</td><td>'+fmt(u.points)+'</td><td>'+fmt(u.streak)+'</td></tr>'; });
      lbHtml += '</tbody></table>';
      $('leaderboard').innerHTML = lbHtml;
      // weekly
      const w = await fetch('/admin/weekly?days=7'+qsUser+qsToken).then(r=>r.json());
      $('rawWeekly').textContent = JSON.stringify(w,null,2);
      // 绘制图表
      const ctxC = document.getElementById('chartCount');
      const ctxM = document.getElementById('chartMinutes');
      const labelsArr = w.dates;
      const color = (hex)=> hex;
      new Chart(ctxC,{ type:'line', data:{ labels: labelsArr, datasets:[
        {label:'总确认', data:w.totalCount, borderColor:color('#2563eb'), backgroundColor:color('#93c5fd')}
      ]}});
      // 番茄统计（14 天）
      const p = await fetch('/admin/pomodoro/summary?days=14'+qsUser+qsToken).then(r=>r.json());
      const ctxP = document.getElementById('chartPomo');
      new Chart(ctxP,{ type:'bar', data:{ labels:p.dates, datasets:[{label:'番茄数', data:p.counts, backgroundColor:'#f43f5e'}]}});
      const taskMap={vocab:'词汇',grammar:'语法',listening:'听力',reading:'阅读'}; let html='<ul style="margin:8px 0 0 16px">';
      for(const k of Object.keys(p.byTask||{})){ html+='<li>'+taskMap[k]+': '+(p.byTask[k]||0)+'</li>'; } html+='</ul>';
      document.getElementById('byTaskPomo').innerHTML = html;
      new Chart(ctxM,{ type:'bar', data:{ labels: labelsArr, datasets:[
        {label:'总时长(分)', data:w.totalMinutes, backgroundColor:color('#10b981')}
      ]}});
      // 各任务完成趋势
      const ctxT = document.getElementById('chartTasks');
      new Chart(ctxT,{ type:'line', data:{ labels: labelsArr, datasets:[
        {label:'词汇✅', data:(w.perTask.vocab||[]).map(x=>x.done||0), borderColor:'#ef4444'},
        {label:'语法✅', data:(w.perTask.grammar||[]).map(x=>x.done||0), borderColor:'#f59e0b'},
        {label:'听力✅', data:(w.perTask.listening||[]).map(x=>x.done||0), borderColor:'#10b981'},
        {label:'阅读✅', data:(w.perTask.reading||[]).map(x=>x.done||0), borderColor:'#3b82f6'}
      ]}});
      $('dlCsv').onclick = function(){
        const userId = $('user').value || '';
        const token = getToken();
        const date = $('date').value;
        let url = '/admin/export.csv?date='+encodeURIComponent(date);
        if (userId) url += '&userId='+encodeURIComponent(userId);
        if (token) url += '&token='+encodeURIComponent(token);
        window.open(url, '_blank');
      };
    }
    async function loadUsers(){
      const token = getToken();
      const arr = await fetch('/admin/users'+(token?('?token='+encodeURIComponent(token)):'')).then(r=>r.json()).catch(()=>[]);
      const sel = $('user'); sel.innerHTML = '<option value="">全部</option>';
      for (const u of arr) { const opt = document.createElement('option'); opt.value=u.userId; opt.textContent=(u.displayName||u.userId); sel.appendChild(opt); }
    }
    (async function init(){
      await loadUsers();
      $('date').value = todayISO();
      $('reload').onclick = function(){ load($('date').value); };
      $('backfill').onclick = async function(){
        const btn = $('backfill'); const msg=$('msg');
        btn.disabled = true; btn.textContent = '回填中...'; msg.textContent='';
        try {
          // 尝试 GET 以规避某些环境的 CORS/CSRF 拦截
          const resp = await fetch('/admin/backfill-profiles', { method:'GET' });
          const r = await resp.json();
          msg.textContent = '已更新 '+ (r.count||0) +' 个用户';
        } catch(e){ msg.style.color='#b00'; msg.textContent = '回填失败'; }
        await loadUsers();
        btn.disabled = false; btn.textContent = '回填昵称';
      };
      load($('date').value);
    })();
  </script>
  </body>
  </html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
});

router.get("/admin/plan-editor", async (_req: Request, res: Response) => {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>计划编辑器</title>
  <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;max-width:960px;margin:24px auto;padding:0 12px;color:#222} textarea{width:100%;min-height:340px} input,button,select{padding:6px 8px;margin-right:8px}</style></head>
  <body>
    <h2>计划可视化编辑器</h2>
    <div>
      <label>版本：</label>
      <input id="version" value="toeic-12d-v1"/>
      <button id="load">读取</button>
      <button id="save">保存</button>
      <span id="msg" style="margin-left:8px;color:#0a7"></span>
    </div>
    <textarea id="json"></textarea>
    <script>
    const $=id=>document.getElementById(id);
    async function load(){ const v=$('version').value.trim(); if(!v) return; const token=(new URL(location.href)).searchParams.get('token')||''; const u='/admin/plan?version='+encodeURIComponent(v)+(token?('&token='+encodeURIComponent(token)):''); const txt=await fetch(u).then(r=>r.ok?r.text():Promise.reject(r.status)).catch(()=>'{"version":"'+v+'","days":[]}'); $('json').value=txt; }
    async function save(){ const v=$('version').value.trim(); const token=(new URL(location.href)).searchParams.get('token')||''; let obj; try{ obj=JSON.parse($('json').value); }catch(e){ $('msg').style.color='#b00'; $('msg').textContent='JSON 解析失败'; return; } const u='/admin/plan?version='+encodeURIComponent(v)+(token?('&token='+encodeURIComponent(token)):''); const r=await fetch(u,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)}); $('msg').style.color = r.ok ? '#0a7' : '#b00'; $('msg').textContent = r.ok ? '已保存' : '保存失败'; }
    $('load').onclick=load; $('save').onclick=save; load();
    </script>
  </body></html>`;
  res.setHeader("Content-Type","text/html; charset=utf-8");
  return res.send(html);
});

// 轻量番茄钟页面（单用户本地体验）：/pomodoro
router.get("/pomodoro", async (_req: Request, res: Response) => {
  const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>番茄钟</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#0f172a;color:#e2e8f0}
.card{width:min(520px,92vw);border:1px solid #1f2937;border-radius:16px;padding:24px;background:#111827;box-shadow:0 10px 25px rgba(0,0,0,.35)}
label{display:block;margin:8px 0 4px;color:#94a3b8;font-size:12px}
select,input,button{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:#e2e8f0}
button{cursor:pointer}
.row{display:flex;gap:8px;margin-top:12px}
.row>*{flex:1}
.timer{font-size:48px;letter-spacing:1px;text-align:center;margin:16px 0 8px}
.hint{color:#94a3b8;text-align:center;margin-bottom:12px}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin:0 2px;background:#334155}
.dot.on{background:#22c55e}
</style>
</head>
<body>
  <div class="card">
    <div class="row">
      <div>
        <label>任务</label>
        <select id="task"><option value="vocab">词汇</option><option value="grammar">语法</option><option value="listening">听力</option><option value="reading">阅读</option></select>
      </div>
      <div>
        <label>模式</label>
        <select id="mode"><option value="focus">专注</option><option value="break">休息</option></select>
      </div>
    </div>
    <div class="timer" id="timer">25:00</div>
    <div class="hint" id="hint">默认 25/5/15，长休每 4 轮</div>
    <div class="row">
      <button id="start">开始</button>
      <button id="pause">暂停</button>
      <button id="resume">继续</button>
      <button id="stop">停止</button>
      <label style="display:flex;align-items:center;gap:6px"><input id="sound" type="checkbox" checked /> 声音提醒</label>
    </div>
    <div style="text-align:center;margin-top:10px" id="cycles"></div>
  </div>
<script>
const $=id=>document.getElementById(id);
let t=null, remain=0, cycles=0, conf={focus:25,brk:5,longBrk:15,longEvery:4};
fetch('/api/pomodoro/config').then(r=>r.json()).then(c=>{ conf=c; updateDisplay(conf.focus*60); $('hint').textContent = '默认 '+conf.focus+'/'+conf.brk+'/'+conf.longBrk+'，长休每 '+conf.longEvery+' 轮'; });
function updateDisplay(sec){ remain=sec; const m=String(Math.floor(sec/60)).padStart(2,'0'); const s=String(sec%60).padStart(2,'0'); $('timer').textContent=m+':'+s; }
function tick(next){ clearInterval(t); t=setInterval(()=>{ if(remain<=0){ clearInterval(t); next&&next(); return;} updateDisplay(remain-1); },1000); }
let audioCtx=null; function ensureAudio(){ try{ if(!$('sound')||!$('sound').checked) return; const C=window.AudioContext||window.webkitAudioContext; if(!audioCtx&&C){ audioCtx=new C(); } if(audioCtx&&audioCtx.state==='suspended'){ audioCtx.resume(); } }catch(e){} }
function beepOnce(freq=880,duration=180){ try{ if(!$('sound')||!$('sound').checked||!audioCtx) return; const ctx=audioCtx; const o=ctx.createOscillator(); const g=ctx.createGain(); o.type='sine'; o.frequency.value=freq; o.connect(g); g.connect(ctx.destination); const now=ctx.currentTime; g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.2, now+0.01); g.gain.exponentialRampToValueAtTime(0.0001, now+duration/1000); o.start(now); o.stop(now+duration/1000+0.02);}catch(e){} }
function playPattern(kind){ ensureAudio(); if(kind==='focusEnd'){ beepOnce(880,160); setTimeout(()=>beepOnce(880,160),260); setTimeout(()=>beepOnce(880,160),520); } else if(kind==='breakEnd'){ beepOnce(660,180); setTimeout(()=>beepOnce(660,180),280); } else if(kind==='start'){ beepOnce(880,180); } }
function startCycle(){ const useLong = (cycles>0 && cycles % conf.longEvery===0); const isFocus=$('mode').value==='focus'; const dur = isFocus? conf.focus*60 : (useLong? conf.longBrk*60 : conf.brk*60); if(isFocus){ playPattern('start'); } updateDisplay(dur); tick(()=>{ if(isFocus){ playPattern('focusEnd'); cycles++; $('mode').value='break'; } else { playPattern('breakEnd'); $('mode').value='focus'; } updateCycles(); startCycle(); }); }
function updateCycles(){ const n=cycles%conf.longEvery; const arr=[]; for(let i=1;i<=conf.longEvery;i++){ arr.push('<span class="dot '+(i<=n?'on':'')+'"></span>'); } $('cycles').innerHTML=arr.join(''); }
$('start').onclick=()=>{ startCycle(); };
$('pause').onclick=()=>{ clearInterval(t); };
$('resume').onclick=()=>{ tick(()=>{ startCycle(); }); };
$('stop').onclick=()=>{ clearInterval(t); updateDisplay(conf.focus*60); cycles=0; updateCycles(); };
// Auto select task & autostart from URL
(function(){ try{ const u=new URL(window.location.href); const task=u.searchParams.get('task'); const autostart=u.searchParams.get('autostart'); if(task){ const sel=$('task'); if(sel){ sel.value=task; } } if(autostart==='1'){ $('start').click(); } }catch(e){} })();
</script>
</body></html>`;
  res.setHeader("Content-Type","text/html; charset=utf-8");
  return res.send(html);
});

export default router;


