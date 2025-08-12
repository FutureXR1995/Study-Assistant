import { Router, Request, Response } from "express";
import { verifySignature, reply, buildTasksText, getUserProfile } from "../lib/line.js";
import {
  insertConfirmation,
  insertStudyStart,
  endLatestStudySession,
  getConfirmationsByDateJst,
  getStudySessionsByDateJst,
  insertTaskMinutes,
  insertTaskProgress
} from "../lib/db.js";
import type { TaskType } from "../lib/db.js";
import { matchTextToAction } from "../lib/keywords.js";
import { upsertUserProfile, addPoints, getPointsAndStreak, updateStreakOnFullDone } from "../lib/db.js";
import { getPointsConfig } from "../lib/points.js";
import { startPomodoro, cancelPomodoro, pausePomodoro } from "../lib/pomodoro.js";
import { setPomodoroUserConfig } from "../lib/db.js";
import type { LineWebhookRequestBody, LinePostbackEvent } from "../types/line.js";

const router = Router();

router.post("/webhook", async (req: Request, res: Response) => {
  try {
    const signature = req.get("x-line-signature");
    const rawBody = (req as any).rawBody as string;
    if (!verifySignature(rawBody || "", signature)) {
      return res.status(403).json({ error: "invalid signature" });
    }

    const body = req.body as LineWebhookRequestBody;
    if (!body?.events?.length) {
      return res.status(200).json({ ok: true });
    }

    // 同时支持 postback 与文本消息回复
    await Promise.all(
      body.events.map(async (e: any) => {
        const type = e?.type;
        const replyToken = e?.replyToken as string | undefined;
        const userId = e?.source?.userId as string | undefined;

        if (!replyToken || !userId) return;
        // 抓取并缓存用户昵称（若尚无缓存，或可定期刷新）
        try {
          const prof = await getUserProfile(userId);
          await upsertUserProfile(userId, prof.displayName, prof.pictureUrl);
        } catch {}

        let status: "done" | "miss" | undefined;
        let task: TaskType = "all";

        if (type === "postback") {
          const event = e as LinePostbackEvent;
          const data = event?.postback?.data || "";
          const params = new URLSearchParams(data);
          const t = params.get("task");
          const s = params.get("status");
          if (t) task = (t as TaskType);
          status = s === "done" ? "done" : s === "miss" ? "miss" : undefined;
        } else if (type === "message") {
          const text = (e?.message?.text || "").trim();
          const act = matchTextToAction(text);
          if (act) {
            if (act.action === "start") {
              await insertStudyStart(userId);
              await reply(replyToken, [{ type: "text", text: "▶️ 已记录开始时间，加油！" }]);
              return;
            }
            if (act.action === "startTimer") {
              // 记录学习开始，启动服务端番茄钟，并返回一键打开计时器链接
              await insertStudyStart(userId);
              await startPomodoro(userId, userId, act.task);
              const baseEnv = process.env.PUBLIC_BASE_URL || "";
              const proto = (req.headers["x-forwarded-proto"] as string) || "http";
              const host = (req.headers["host"] as string) || "";
              const baseHdr = host ? `${proto}://${host}` : "";
              const base = (baseEnv || baseHdr).replace(/\/$/, "");
              const url = (base ? `${base}/pomodoro` : "http://localhost:3000/pomodoro") + `?task=${act.task}&autostart=1`;
              await reply(replyToken, [
                {
                  type: "text",
                  text: `⏱️ ${act.task} 番茄钟已开始！点下方按钮打开计时器页面（已为你自动选择任务并开始倒计时）：\n${url}`,
                  quickReply: {
                    items: [
                      { type: "action", action: { type: "uri", label: "打开计时器 ▶️", uri: url } }
                    ]
                  }
                }
              ]);
              return;
            }
            if (act.action === "status") {
              const date = new Date().toISOString().slice(0, 10);
              const [conf, sess] = await Promise.all([
                getConfirmationsByDateJst(date),
                getStudySessionsByDateJst(date)
              ]);
              const label: Record<string, string> = { all: "总体", vocab: "词汇", grammar: "语法", listening: "听力", reading: "阅读" };
              const lines: string[] = [
                `📊 今日进度（${date}）`,
                ...(["vocab", "grammar", "listening", "reading"] as const).map((k) => {
                  const done = ((conf as any).byTask?.[k]?.done || 0) as number;
                  const miss = ((conf as any).byTask?.[k]?.miss || 0) as number;
                  return `${label[k]}：✅${done} ❌${miss}`;
                }),
                `总确认：${(conf as any).count} 条`,
                `学习总时长：${(sess as any).totalMinutes} 分钟`
              ];
              await reply(replyToken, [{ type: "text", text: lines.join("\n") }]);
              return;
            }
            if (act.action === "admin") {
              const baseEnv = process.env.PUBLIC_BASE_URL || "";
              const proto = (req.headers["x-forwarded-proto"] as string) || "http";
              const host = (req.headers["host"] as string) || "";
              const baseHdr = host ? `${proto}://${host}` : "";
              const base = (baseEnv || baseHdr).replace(/\/$/, "");
              const url = base ? `${base}/admin` : "http://localhost:3000/admin";
              await reply(replyToken, [{ type: "text", text: `管理页：${url}` }]);
              return;
            }
            if (act.action === "plan") {
              await reply(replyToken, [{ type: "text", text: buildTasksText() }]);
              return;
            }
            if (act.action === "help") {
              const lines = [
                "可用指令：",
                "- 开始学习：记录学习开始时间",
                "- 词汇/语法/听力/阅读 已完成或未完成：记录该任务状态",
                "- 状态/统计/進度：查看今日各任务与学习时长",
                "- 计划：查看今日学习任务清单",
                "- 周报：查看近 7 天统计",
                "- 番茄钟：获取计时页面链接"
              ];
              await reply(replyToken, [{ type: "text", text: lines.join("\n") }]);
              return;
            }
            if (act.action === "home") {
              const baseEnv = process.env.PUBLIC_BASE_URL || "";
              const proto = (req.headers["x-forwarded-proto"] as string) || "http";
              const host = (req.headers["host"] as string) || "";
              const baseHdr = host ? `${proto}://${host}` : "";
              const base = (baseEnv || baseHdr).replace(/\/$/, "");
              const home = (base ? `${base}/home` : "http://localhost:3000/home");
              const flash = (base ? `${base}/flashcards` : "http://localhost:3000/flashcards") + `?autostart=1&userId=${encodeURIComponent(userId)}`;
              const list = (base ? `${base}/flashcards/list` : "http://localhost:3000/flashcards/list") + `?userId=${encodeURIComponent(userId)}`;
              const daily = (base ? `${base}/daily` : "http://localhost:3000/daily");
              await reply(replyToken, [{ type: "text", text: `学习主页：\n${home}`, quickReply: { items: [
                { type: "action", action: { type: "uri", label: "打开主页 ▶️", uri: home } },
                { type: "action", action: { type: "uri", label: "闪卡 ▶️", uri: flash } },
                { type: "action", action: { type: "uri", label: "历史 📚", uri: list } },
                { type: "action", action: { type: "uri", label: "今日任务 📆", uri: daily } }
              ] } }]);
              return;
            }
            if (act.action === "pomodoro") {
              const baseEnv = process.env.PUBLIC_BASE_URL || "";
              const proto = (req.headers["x-forwarded-proto"] as string) || "http";
              const host = (req.headers["host"] as string) || "";
              const baseHdr = host ? `${proto}://${host}` : "";
              const base = (baseEnv || baseHdr).replace(/\/$/, "");
              const url = base ? `${base}/pomodoro` : "http://localhost:3000/pomodoro";
              await reply(replyToken, [{ type: "text", text: `番茄钟页面：${url}` }]);
              return;
            }
            if (act.action === "flashcards") {
              const baseEnv = process.env.PUBLIC_BASE_URL || "";
              const proto = (req.headers["x-forwarded-proto"] as string) || "http";
              const host = (req.headers["host"] as string) || "";
              const baseHdr = host ? `${proto}://${host}` : "";
              const base = (baseEnv || baseHdr).replace(/\/$/, "");
              const url = (base ? `${base}/flashcards` : "http://localhost:3000/flashcards") + `?autostart=1&userId=${encodeURIComponent(userId)}`;
              await reply(replyToken, [{
                type: "text",
                text: `闪卡复习入口：\n${url}`,
                quickReply: {
                  items: [
                    { type: "action", action: { type: "uri", label: "打开闪卡 ▶️", uri: url } }
                  ]
                }
              }]);
              return;
            }
            if ((act as any).action === "pomodoroConfig") {
              const a = act as any;
              await setPomodoroUserConfig(userId, { focus: a.focus, brk: a.brk, longBrk: a.longBrk, longEvery: a.longEvery });
              await reply(replyToken, [{ type: "text", text: `✅ 已更新你的番茄配置：专注${a.focus}/休息${a.brk}/长休${a.longBrk}，每 ${a.longEvery} 轮长休。` }]);
              return;
            }
            if (act.action === "weekly") {
              const today = new Date();
              const dates: string[] = [];
              for (let i = 0; i < 7; i++) {
                const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
                dates.push(d.toISOString().slice(0, 10));
              }
              const confs = await Promise.all(dates.map((d) => getConfirmationsByDateJst(d)));
              const sess = await Promise.all(dates.map((d) => getStudySessionsByDateJst(d)));
              const sumByTask: Record<string, { done: number; miss: number }> = { vocab: { done: 0, miss: 0 }, grammar: { done: 0, miss: 0 }, listening: { done: 0, miss: 0 }, reading: { done: 0, miss: 0 } };
              let totalMinutes = 0;
              for (let i = 0; i < dates.length; i++) {
                const c: any = confs[i];
                (Object.keys(sumByTask) as Array<keyof typeof sumByTask>).forEach((k) => {
                  sumByTask[k].done += (c.byTask?.[k]?.done || 0) as number;
                  sumByTask[k].miss += (c.byTask?.[k]?.miss || 0) as number;
                });
                totalMinutes += (sess[i] as any).totalMinutes || 0;
              }
              const label: Record<string, string> = { vocab: "词汇", grammar: "语法", listening: "听力", reading: "阅读" };
              const lines = [
                "📈 近 7 天周报",
                ...(["vocab", "grammar", "listening", "reading"] as const).map((k) => `${label[k]}：✅${sumByTask[k].done} ❌${sumByTask[k].miss}`),
                `学习总时长：${totalMinutes} 分钟`
              ];
              await reply(replyToken, [{ type: "text", text: lines.join("\n") }]);
              return;
            }
            if (act.action === "task") {
              status = act.status;
              task = act.task;
              // 完成或未完成都终止对应番茄钟
              // task 在此分支恒为具体任务，不是 "all"
              cancelPomodoro(userId, task as Exclude<TaskType, "all">);
            }
            if ((act as any).action === "timerControl") {
              const a = act as any;
              const knownTasks: Array<Exclude<TaskType, "all">> = ["vocab","grammar","listening","reading"];
              const targets = a.task ? [a.task] : knownTasks;
              for (const t of targets) {
                if (a.op === "pause") pausePomodoro(userId, t);
                if (a.op === "resume") startPomodoro(userId, userId, t);
                if (a.op === "stop") cancelPomodoro(userId, t);
              }
              await reply(replyToken, [{ type: "text", text: `⏱️ 计时器已${a.op === 'pause' ? '暂停' : a.op === 'resume' ? '继续' : '停止' }。` }]);
              return;
            }
            if ((act as any).action === "reportMinutes") {
              const a = act as any;
              await insertTaskMinutes(userId, a.task, a.minutes);
              await reply(replyToken, [{ type: "text", text: `🕒 已记录 ${a.task} ${a.minutes} 分钟` }]);
              return;
            }
            if ((act as any).action === "reportProgress") {
              const a = act as any;
              await insertTaskProgress(userId, a.task, a.metric, a.amount);
              await reply(replyToken, [{ type: "text", text: `📈 已记录 ${a.task} ${a.amount}${a.metric}` }]);
              return;
            }
          }

          // 状态/统计：返回今日按任务的汇总与学习总时长
          if (/^(状态|進度|统计|統計|status)$/i.test(text)) {
            const date = new Date().toISOString().slice(0, 10);
            const [conf, sess] = await Promise.all([
              getConfirmationsByDateJst(date),
              getStudySessionsByDateJst(date)
            ]);
            const label: Record<string, string> = {
              all: "总体",
              vocab: "词汇",
              grammar: "语法",
              listening: "听力",
              reading: "阅读"
            };
            const lines: string[] = [
              `📊 今日进度（${date}）`,
              ...(["vocab", "grammar", "listening", "reading"] as const).map((k) => {
                const done = ((conf as any).byTask?.[k]?.done || 0) as number;
                const miss = ((conf as any).byTask?.[k]?.miss || 0) as number;
                return `${label[k]}：✅${done} ❌${miss}`;
              }),
              `总确认：${(conf as any).count} 条`,
              `学习总时长：${(sess as any).totalMinutes} 分钟`
            ];
            await reply(replyToken, [{ type: "text", text: lines.join("\n") }]);
            return;
          }

          // 帮助/菜单
          if (/^(帮助|幫助|菜单|菜單|help|menu)$/i.test(text)) {
            const lines = [
              "可用指令：",
              "- 开始学习：记录学习开始时间",
              "- 词汇/语法/听力/阅读 已完成或未完成：记录该任务状态",
              "- 状态/统计/進度：查看今日各任务与学习时长",
              "- 计划：查看今日学习任务清单",
              "- 周报：查看近 7 天统计"
            ];
            await reply(replyToken, [{ type: "text", text: lines.join("\n") }]);
            return;
          }

          // 今日计划
          if (/^(计划|今日计划|今日計劃|計劃)$/i.test(text)) {
            await reply(replyToken, [{ type: "text", text: buildTasksText() }]);
            return;
          }

          // 周报（近 7 天聚合）
          if (/^(周报|週報|weekly|week)$/i.test(text)) {
            const today = new Date();
            const dates: string[] = [];
            for (let i = 0; i < 7; i++) {
              const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
              dates.push(d.toISOString().slice(0, 10));
            }
            const confs = await Promise.all(dates.map((d) => getConfirmationsByDateJst(d)));
            const sess = await Promise.all(dates.map((d) => getStudySessionsByDateJst(d)));
            const sumByTask: Record<string, { done: number; miss: number }> = {
              vocab: { done: 0, miss: 0 },
              grammar: { done: 0, miss: 0 },
              listening: { done: 0, miss: 0 },
              reading: { done: 0, miss: 0 }
            };
            let totalMinutes = 0;
            for (let i = 0; i < dates.length; i++) {
              const c: any = confs[i];
              (Object.keys(sumByTask) as Array<keyof typeof sumByTask>).forEach((k) => {
                sumByTask[k].done += (c.byTask?.[k]?.done || 0) as number;
                sumByTask[k].miss += (c.byTask?.[k]?.miss || 0) as number;
              });
              totalMinutes += (sess[i] as any).totalMinutes || 0;
            }
            const label: Record<string, string> = { vocab: "词汇", grammar: "语法", listening: "听力", reading: "阅读" };
            const lines = [
              "📈 近 7 天周报",
              ...(["vocab", "grammar", "listening", "reading"] as const).map((k) => `${label[k]}：✅${sumByTask[k].done} ❌${sumByTask[k].miss}`),
              `学习总时长：${totalMinutes} 分钟`
            ];
            await reply(replyToken, [{ type: "text", text: lines.join("\n") }]);
            return;
          }
          if (/^(开始学习|開始學習|開始学习|start|go|开学)$/i.test(text)) {
            await insertStudyStart(userId);
            await reply(replyToken, [{ type: "text", text: "▶️ 已记录开始时间，加油！" }]);
            return;
          }
          // 文本解析：前缀匹配任务名 + 完成状态
          const map: Array<{ re: RegExp; task: TaskType }> = [
            { re: /^(词汇|單字|词彙|vocab)/i, task: "vocab" },
            { re: /^(语法|文法|grammar)/i, task: "grammar" },
            { re: /^(听力|聽力|listening)/i, task: "listening" },
            { re: /^(阅读|閱讀|reading)/i, task: "reading" }
          ];
          const stDone = /(已完成|完成|✅|done)/i;
          const stMiss = /(未完成|没完成|❌|miss)/i;
          for (const m of map) {
            if (m.re.test(text)) {
              task = m.task;
              if (stDone.test(text)) status = "done";
              else if (stMiss.test(text)) status = "miss";
              break;
            }
          }
          // 兼容无任务名的通用确认
          if (!status) {
            if (/^(✅|已完成|完成|done)$/i.test(text)) status = "done";
            else if (/^(❌|未完成|没完成|miss|未達成)$/i.test(text)) status = "miss";
          }
        }

          if (!status) return;

        await insertConfirmation(userId, status, task);
        // 计分规则：完成 +10 分，未完成 +0
        if (status === "done") {
          const cfg = getPointsConfig();
          const newPts = await addPoints(userId, cfg.completeTaskPoints);
          // 若四项均完成则更新 streak
          const today = new Date().toISOString().slice(0,10);
          const newStreak = await updateStreakOnFullDone(userId, today);
          if (newStreak > 0 && cfg.milestones.includes(newStreak)) {
            await reply(replyToken, [{ type: "text", text: `🎉 连续达成 ${newStreak} 天！积分 ${newPts} 分` }]);
          }
        }

        if (status === "done" && task === "all") {
          // 结束最新一次会话
          await endLatestStudySession(userId);
        }
        const taskLabel: Record<TaskType, string> = {
          all: "总体",
          vocab: "词汇",
          grammar: "语法",
          listening: "听力",
          reading: "阅读"
        };
        const { points, streak } = await getPointsAndStreak(userId);
        const replyText = status === "done"
          ? `✅ ${taskLabel[task]}：已记录完成！\n积分：${points} 分｜连续：${streak} 天`
          : `❌ ${taskLabel[task]}：已记录未完成。\n积分：${points} 分｜连续：${streak} 天`;
        await reply(replyToken, [{ type: "text", text: replyText }]);
        })
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("/line/webhook error", err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;