import { Router, Request, Response } from "express";
import { push, buildMorningMessages, buildEveningMessages, buildHelpMessages, buildCountdownMessage } from "../lib/line.js";
import { getPlanMessages, loadPlan } from "../lib/plan.js";
import { setPlanState, getPlanState, advancePlanDay } from "../lib/db.js";

const router = Router();

router.post("/push", async (req: Request, res: Response) => {
  try {
    // 日志精简
  const { type, to, useFlex, examDate } = req.body as { type: "morning" | "evening" | "help" | "countdown" | "flashcards" | "home"; to?: string; useFlex?: boolean; examDate?: string };
    const target = to || (process.env.DEFAULT_LINE_USER_ID as string);
    if (!type || !target) {
      return res.status(400).json({ error: "type and to (or DEFAULT_LINE_USER_ID) required" });
    }

    const payload =
      type === "morning"
        ? buildMorningMessages(target, Boolean(useFlex))
        : type === "evening"
          ? buildEveningMessages(target)
          : type === "help"
            ? buildHelpMessages(target)
            : type === "countdown"
              ? buildCountdownMessage(target, examDate)
              : type === "flashcards"
                ? { to: target, messages: [ { type: 'text', text: '闪卡复习时间到，点击进入：' + (((process.env.PUBLIC_BASE_URL||'').replace(/\/$/, ''))||'http://localhost:3000') + '/flashcards?autostart=1' } ] }
                : (() => {
                    const base = (((process.env.PUBLIC_BASE_URL||'').replace(/\/$/, ''))||'http://localhost:3000');
                    const urlHome = base + '/home';
                    const urlFlash = base + '/flashcards?autostart=1';
                    const urlList = base + '/flashcards/list';
                    const urlDaily = base + '/daily';
                    return {
                      to: target,
                      messages: [
                        {
                          type: 'text',
                          text: `学习主页：${urlHome}`,
                          quickReply: {
                            items: [
                              { type: 'action', action: { type: 'uri', label: '打开主页 ▶️', uri: urlHome } },
                              { type: 'action', action: { type: 'uri', label: '闪卡 ▶️', uri: urlFlash } },
                              { type: 'action', action: { type: 'uri', label: '历史 📚', uri: urlList } },
                              { type: 'action', action: { type: 'uri', label: '今日任务 📆', uri: urlDaily } }
                            ]
                          }
                        }
                      ]
                    };
                  })();
    await push(target, payload.messages as any[]);

    return res.json({ ok: true });
  } catch (err) {
    console.error("/api/push error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// 从计划配置推送：POST /api/push/plan { version, day, slot, to? }
router.post("/push/plan", async (req: Request, res: Response) => {
  try {
    const { version, day, slot, to } = req.body as { version: string; day: number; slot: "morning"|"evening"|"flexMorning"; to?: string };
    if (!version || !day || !slot) return res.status(400).json({ error: "version, day, slot required" });
    const payload = getPlanMessages(version, Number(day), slot, to);
    await push(payload.to, payload.messages as any[]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("/api/push/plan error", err);
    return res.status(500).json({ error: String((err as any)?.message || "internal") });
  }
});

// 初始化计划天数：POST /api/plan/init { version, day, to? }
router.post("/plan/init", async (req: Request, res: Response) => {
  try {
    const { version, day, to } = req.body as { version: string; day: number; to?: string };
    if (!version || !day) return res.status(400).json({ error: "version, day required" });
    await setPlanState(version, Number(day), to);
    return res.json({ ok: true });
  } catch (err) {
    console.error("/api/plan/init error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// 推送当前天 morning/evening，并可在晚间后推进天数
router.post("/plan/trigger", async (req: Request, res: Response) => {
  try {
    const { version, slot } = req.body as { version: string; slot: "morning"|"evening"|"flexMorning" };
    if (!version || !slot) return res.status(400).json({ error: "version, slot required" });
    const state = await getPlanState(version);
    if (!state) return res.status(400).json({ error: "plan not initialized" });
    const plan = loadPlan(version);
    const maxDay = Math.max(...plan.days.map(d => d.day));
    const payload = getPlanMessages(version, state.day, slot, state.toUserId || undefined);
    await push(payload.to, payload.messages as any[]);
    // 晚间推送后自动推进到下一天
    if (slot === "evening") await advancePlanDay(version, maxDay);
    return res.json({ ok: true, day: state.day, advanced: slot === "evening" });
  } catch (err) {
    console.error("/api/plan/trigger error", err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
