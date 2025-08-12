import fs from "node:fs";
import path from "node:path";
import type { TaskType } from "./db.js";

export interface KeywordsConfig {
  start: string[];
  startTimer: Record<"vocab"|"grammar"|"listening"|"reading", string[]>; // 词汇开始计时 等
  reportMinutes: string[]; // e.g. "45 分钟", "30m"
  reportProgress: string[]; // e.g. "50 单词", "2 篇"
  timerPause: string[]; // 暂停
  timerResume: string[]; // 继续/恢复
  timerStop: string[]; // 停止
  status: string[];
  help: string[];
  plan: string[];
  weekly: string[];
  admin: string[];
  pomodoro?: string[]; // 进入番茄钟网页
  flashcards?: string[]; // 进入闪卡网页
  home?: string[]; // 聚合主页
  tasks: Record<Exclude<TaskType, "all">, { aliases: string[]; done: string[]; miss: string[] }>;
}

const defaultConfig: KeywordsConfig = {
  start: ["开始学习", "開始學習", "開始学习", "start", "开学"],
  startTimer: {
    vocab: ["词汇开始计时", "單字開始計時", "vocab start"],
    grammar: ["语法开始计时", "文法開始計時", "grammar start"],
    listening: ["听力开始计时", "聽力開始計時", "listening start"],
    reading: ["阅读开始计时", "閱讀開始計時", "reading start"]
  },
  reportMinutes: ["分钟", "分鐘", "min", "m"],
  reportProgress: ["单词", "單字", "题", "題", "篇"],
  timerPause: ["暂停", "暫停", "pause"],
  timerResume: ["继续", "繼續", "恢复", "恢復", "resume", "continue"],
  timerStop: ["停止", "結束", "stop"],
  status: ["状态", "進度", "统计", "統計", "status"],
  help: ["帮助", "幫助", "菜单", "菜單", "help", "menu"],
  plan: ["计划", "今日计划", "計劃", "今日計劃"],
  weekly: ["周报", "週報", "weekly", "week"],
  admin: ["管理", "后台", "後台", "admin"],
  pomodoro: ["番茄钟", "番茄", "pomodoro"],
  flashcards: ["闪卡", "卡片", "flashcards"],
  home: ["主页", "首页", "home"],
  tasks: {
    vocab: { aliases: ["词汇", "單字", "词彙", "vocab"], done: ["已完成", "完成", "✅", "done"], miss: ["未完成", "没完成", "❌", "miss"] },
    grammar: { aliases: ["语法", "文法", "grammar"], done: ["已完成", "完成", "✅", "done"], miss: ["未完成", "没完成", "❌", "miss"] },
    listening: { aliases: ["听力", "聽力", "listening"], done: ["已完成", "完成", "✅", "done"], miss: ["未完成", "没完成", "❌", "miss"] },
    reading: { aliases: ["阅读", "閱讀", "reading"], done: ["已完成", "完成", "✅", "done"], miss: ["未完成", "没完成", "❌", "miss"] }
  }
};

function loadExternalConfig(): Partial<KeywordsConfig> | null {
  try {
    const file = path.resolve("config/keywords.json");
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw) as Partial<KeywordsConfig>;
  } catch {
    return null;
  }
}

export function getKeywords(): KeywordsConfig {
  const ext = loadExternalConfig() || {};
  const merged: KeywordsConfig = {
    ...defaultConfig,
    ...ext,
    tasks: { ...defaultConfig.tasks, ...(ext.tasks || {}) }
  } as KeywordsConfig;
  return merged;
}

export type MatchResult =
  | { action: "start" }
  | { action: "startTimer"; task: Exclude<TaskType, "all"> }
  | { action: "reportMinutes"; task: Exclude<TaskType, "all">; minutes: number }
  | { action: "reportProgress"; task: Exclude<TaskType, "all">; metric: string; amount: number }
  | { action: "timerControl"; op: "pause"|"resume"|"stop"; task?: Exclude<TaskType, "all"> }
  | { action: "status" }
  | { action: "admin" }
  | { action: "help" }
  | { action: "plan" }
  | { action: "weekly" }
  | { action: "pomodoro" }
  | { action: "flashcards" }
  | { action: "home" }
  | { action: "pomodoroConfig"; focus: number; brk: number; longBrk: number; longEvery: number }
  | { action: "task"; task: Exclude<TaskType, "all">; status: "done" | "miss" };

export function matchTextToAction(textRaw: string): MatchResult | null {
  const text = textRaw.trim();
  const cfg = getKeywords();
  const includesAny = (arr: string[]) => arr.some((k) => text.includes(k));

  if (includesAny(cfg.start)) return { action: "start" };
  // startTimer
  for (const t of ["vocab", "grammar", "listening", "reading"] as const) {
    if (includesAny(cfg.startTimer[t])) return { action: "startTimer", task: t };
  }
  if (includesAny(cfg.status)) return { action: "status" };
  if (includesAny(cfg.admin)) return { action: "admin" };
  if (includesAny(cfg.help)) return { action: "help" };
  if (includesAny(cfg.plan)) return { action: "plan" };
  if (includesAny(cfg.weekly)) return { action: "weekly" };
  if (includesAny(cfg.pomodoro || [])) return { action: "pomodoro" };
  if (includesAny(cfg.flashcards || [])) return { action: "flashcards" };
  if (includesAny(cfg.home || [])) return { action: "home" };

  // 番茄钟配置：支持“番茄 50/10/20 每4”或“pomodoro 25/5/15 4”
  const cfgRe = /^(?:番茄(?:钟|鐘)?|pomodoro)\s+(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)(?:\s*(?:每|x|X)?\s*(\d+))?\s*$/i;
  const mmCfg = text.match(cfgRe);
  if (mmCfg) {
    const f = Number(mmCfg[1]);
    const b = Number(mmCfg[2]);
    const lb = Number(mmCfg[3]);
    const le = Number(mmCfg[4] || 4);
    if ([f,b,lb,le].every(n=>Number.isFinite(n) && n>0)) {
      return { action: "pomodoroConfig", focus: f, brk: b, longBrk: lb, longEvery: le } as any;
    }
  }

  const entries = Object.entries(cfg.tasks) as Array<[
    Exclude<TaskType, "all">,
    { aliases: string[]; done: string[]; miss: string[] }
  ]>;
  for (const [task, def] of entries) {
    if (includesAny(def.aliases)) {
      if (includesAny(def.done)) return { action: "task", task, status: "done" };
      if (includesAny(def.miss)) return { action: "task", task, status: "miss" };
      if (includesAny(cfg.timerPause)) return { action: "timerControl", op: "pause", task };
      if (includesAny(cfg.timerResume)) return { action: "timerControl", op: "resume", task };
      if (includesAny(cfg.timerStop)) return { action: "timerControl", op: "stop", task };
      // 报告分钟/进度：如 "听力 45 分钟" 或 "阅读 2 篇"
      const minRe = /(\d+)\s*(分钟|分鐘|min|m)\b/i;
      const progRe = /(\d+)\s*(单词|單字|题|題|篇)\b/i;
      const mm = text.match(minRe);
      if (mm) return { action: "reportMinutes", task, minutes: Number(mm[1]) };
      const pm = text.match(progRe);
      if (pm) return { action: "reportProgress", task, amount: Number(pm[1]), metric: pm[2] } as any;
    }
  }
  // 无任务名的计时控制（作用于常用任务）
  if (includesAny(cfg.timerPause)) return { action: "timerControl", op: "pause" } as any;
  if (includesAny(cfg.timerResume)) return { action: "timerControl", op: "resume" } as any;
  if (includesAny(cfg.timerStop)) return { action: "timerControl", op: "stop" } as any;
  return null;
}


