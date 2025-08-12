import { push } from "./line.js";
import type { TaskType } from "./db.js";
import { getPomodoroUserConfig, logPomodoroEvent } from "./db.js";

type TimerKey = string; // `${userId}:${task}:focus|break`
const timers = new Map<TimerKey, NodeJS.Timeout>();
const cycles = new Map<string, number>(); // `${userId}:${task}` -> number of completed focus sessions

function key(userId: string, task: TaskType): TimerKey {
  return `${userId}:${task}`;
}

function getDurations(userId?: string) {
  const envCfg = {
    focus: Number(process.env.POMODORO_FOCUS_MINUTES || 25),
    brk: Number(process.env.POMODORO_BREAK_MINUTES || 5),
    longBrk: Number(process.env.POMODORO_LONG_BREAK_MINUTES || 15),
    longEvery: Number(process.env.POMODORO_LONG_BREAK_EVERY || 4)
  };
  // 同步调用简化：用户配置通过异步获取，调用方（start）已是同步流程，这里只返回 envCfg。
  // 实际读取用户配置在 startPomodoro 中完成。
  return envCfg;
}

export function getPomodoroConfig() {
  return getDurations();
}

export async function startPomodoro(userId: string, toUserId: string, task: Exclude<TaskType, "all">): Promise<void> {
  cancelPomodoro(userId, task);
  const userCfg = await getPomodoroUserConfig(userId).catch(() => null);
  const base = getDurations();
  const { focus, brk, longBrk, longEvery } = userCfg || base;
  const focusMs = focus * 60 * 1000;
  const kFocus = `${userId}:${task}:focus`;
  const kBreak = `${userId}:${task}:break`;
  const cycleKey = `${userId}:${task}`;
  const currentCycles = cycles.get(cycleKey) || 0;
  cycles.set(cycleKey, currentCycles); // ensure key exists

  const startBreak = async () => {
    timers.delete(kFocus);
    const finished = (cycles.get(cycleKey) || 0) + 1; // completed one focus
    cycles.set(cycleKey, finished);
    await logPomodoroEvent(userId, task, "end_focus", { minutes: focus });
    const useLong = finished % longEvery === 0;
    const restMin = useLong ? longBrk : brk;
    const restMs = restMin * 60 * 1000;
    try {
      await push(toUserId, [{ type: "text", text: `⏰ 专注 ${focus} 分钟结束。进入 ${useLong ? "🛌 长休" : "☕ 短休"} ${restMin} 分钟。` }]);
    } catch {}
    await logPomodoroEvent(userId, task, useLong ? "start_long_break" : "start_break", { minutes: restMin });
    const tB = setTimeout(async () => {
      try {
        await push(toUserId, [{ type: "text", text: `${useLong ? "🛌 长休" : "☕ 短休"}结束，继续 ${taskLabel(task)} 吧！如需停止，请回复「${taskLabel(task)}已完成/未完成」` }]);
        await startPomodoro(userId, toUserId, task);
      } catch {}
    }, restMs);
    timers.set(kBreak, tB);
  };

  const tF = setTimeout(async () => {
    try {
      await push(toUserId, [
        { type: "text", text: `⏰ 专注 ${focus} 分钟到：请上报「${taskLabel(task)} 分钟/数量」或直接回复「${taskLabel(task)}已完成/未完成」` }
      ]);
      await startBreak();
    } catch {}
  }, focusMs);
  timers.set(kFocus, tF);
  await logPomodoroEvent(userId, task, "start_focus", { minutes: focus });
}

export function cancelPomodoro(userId: string, task: Exclude<TaskType, "all">): void {
  for (const phase of ["focus","break"] as const) {
    const k = `${userId}:${task}:${phase}`;
    const t = timers.get(k);
    if (t) { clearTimeout(t); timers.delete(k); }
  }
  cycles.delete(`${userId}:${task}`);
  // 异步记录，不阻塞
  logPomodoroEvent(userId, task, "stop").catch(()=>{});
}

export function pausePomodoro(userId: string, task: Exclude<TaskType, "all">): void {
  for (const phase of ["focus","break"] as const) {
    const k = `${userId}:${task}:${phase}`;
    const t = timers.get(k);
    if (t) { clearTimeout(t); timers.delete(k); }
  }
  logPomodoroEvent(userId, task, "pause").catch(()=>{});
}

function taskLabel(task: Exclude<TaskType, "all">): string {
  const map: Record<Exclude<TaskType, "all">, string> = {
    vocab: "词汇",
    grammar: "语法",
    listening: "听力",
    reading: "阅读"
  };
  return map[task];
}


