import { DateTime } from "luxon";
import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import fs from "node:fs";
import path from "node:path";

export type ConfirmationStatus = "done" | "miss";
export type TaskType = "vocab" | "grammar" | "listening" | "reading" | "all";

const DB_FILE = path.resolve("data.sqlite");
let SQL: SqlJsStatic;
let db: Database;

async function ensureReady(): Promise<void> {
  if (db) return;
  SQL = await initSqlJs({ locateFile: (file) => path.resolve("node_modules/sql.js/dist", file) });
  if (fs.existsSync(DB_FILE)) {
    const filebuffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(new Uint8Array(filebuffer));
  } else {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS confirmations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('done', 'miss')),
      createdAtJst TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS plan_state (
      version TEXT PRIMARY KEY,
      day INTEGER NOT NULL,
      toUserId TEXT,
      startedAtJst TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      userId TEXT PRIMARY KEY,
      displayName TEXT,
      pictureUrl TEXT,
      updatedAt TEXT
    );
  `);
  // 用户积分/连续天数
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      userId TEXT PRIMARY KEY,
      points INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      lastFullDoneDate TEXT
    );
  `);
  // 确保 confirmations 表存在 task 字段
  try {
    const info = db.exec("PRAGMA table_info(confirmations)");
    const hasTask = Array.isArray(info?.[0]?.values)
      ? info[0].values.some((row) => String(row?.[1]) === "task")
      : false;
    if (!hasTask) {
      db.run("ALTER TABLE confirmations ADD COLUMN task TEXT NOT NULL DEFAULT 'all'");
    }
  } catch {
    // 兼容性兜底，不影响主流程
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS study_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      startedAtJst TEXT NOT NULL,
      endedAtJst TEXT,
      durationMinutes INTEGER
    );
  `);
  // 番茄钟事件日志
  db.run(`
    CREATE TABLE IF NOT EXISTS pomodoro_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      task TEXT NOT NULL,
      event TEXT NOT NULL,
      atJst TEXT NOT NULL,
      meta TEXT
    );
  `);
  // 用户番茄配置
  db.run(`
    CREATE TABLE IF NOT EXISTS pomodoro_user_config (
      userId TEXT PRIMARY KEY,
      focus INTEGER NOT NULL,
      brk INTEGER NOT NULL,
      longBrk INTEGER NOT NULL,
      longEvery INTEGER NOT NULL
    );
  `);
  // 闪卡：卡片、SRS 状态、复习日志
  db.run(`
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      front TEXT NOT NULL,
      back TEXT,
      example TEXT,
      language TEXT,
      tags TEXT,
      createdAtJst TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS srs (
      cardId INTEGER NOT NULL,
      userId TEXT NOT NULL,
      ease REAL NOT NULL DEFAULT 2.5,
      intervalDays INTEGER NOT NULL DEFAULT 0,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      dueDateJst TEXT,
      lastGrade INTEGER,
      PRIMARY KEY (cardId, userId)
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cardId INTEGER NOT NULL,
      userId TEXT NOT NULL,
      reviewedAtJst TEXT NOT NULL,
      grade INTEGER NOT NULL,
      intervalBefore INTEGER,
      intervalAfter INTEGER,
      easeAfter REAL
    );
  `);
  // 任务分钟记录（手动上报）
  db.run(`
    CREATE TABLE IF NOT EXISTS task_minutes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      date TEXT NOT NULL,
      task TEXT NOT NULL,
      minutes INTEGER NOT NULL
    );
  `);
  // 任务进度（数量上报）
  db.run(`
    CREATE TABLE IF NOT EXISTS task_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      date TEXT NOT NULL,
      task TEXT NOT NULL,
      metric TEXT NOT NULL,
      amount INTEGER NOT NULL
    );
  `);
  persist();
}

function persist(): void {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

export async function insertConfirmation(
  userId: string,
  status: ConfirmationStatus,
  task: TaskType = "all"
): Promise<void> {
  await ensureReady();
  const createdAtJst = DateTime.now().setZone("Asia/Tokyo").toISO();
  const stmt = db.prepare("INSERT INTO confirmations (userId, status, createdAtJst, task) VALUES (?, ?, ?, ?)");
  stmt.bind([userId, status, createdAtJst, task]);
  stmt.step();
  stmt.free();
  persist();
}

export async function getConfirmationsByDateJst(date: string) {
  await ensureReady();
  const start = DateTime.fromISO(date, { zone: "Asia/Tokyo" }).startOf("day");
  const end = start.endOf("day");
  const stmt = db.prepare(
    "SELECT * FROM confirmations WHERE createdAtJst >= ? AND createdAtJst <= ? ORDER BY createdAtJst ASC"
  );
  stmt.bind([start.toISO(), end.toISO()]);
  const rows: any[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push(row);
  }
  stmt.free();
  const summary = rows.reduce((acc: Record<string, number>, row: any) => {
    acc[row.status as string] = (acc[row.status as string] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const byTask = rows.reduce((acc: Record<string, Record<string, number>>, row: any) => {
    const taskKey = (row.task as string) || "all";
    const statusKey = row.status as string;
    acc[taskKey] = acc[taskKey] || {};
    acc[taskKey][statusKey] = (acc[taskKey][statusKey] || 0) + 1;
    return acc;
  }, {} as Record<string, Record<string, number>>);
  return { date, summary, byTask, count: rows.length, rows };
}

export async function getConfirmationsByDateJstAndUser(date: string, userId: string) {
  await ensureReady();
  const start = DateTime.fromISO(date, { zone: "Asia/Tokyo" }).startOf("day");
  const end = start.endOf("day");
  const stmt = db.prepare(
    "SELECT * FROM confirmations WHERE userId = ? AND createdAtJst >= ? AND createdAtJst <= ? ORDER BY createdAtJst ASC"
  );
  stmt.bind([userId, start.toISO(), end.toISO()]);
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  const summary = rows.reduce((acc: Record<string, number>, row: any) => {
    acc[row.status as string] = (acc[row.status as string] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const byTask = rows.reduce((acc: Record<string, Record<string, number>>, row: any) => {
    const taskKey = (row.task as string) || "all";
    const statusKey = row.status as string;
    acc[taskKey] = acc[taskKey] || {};
    acc[taskKey][statusKey] = (acc[taskKey][statusKey] || 0) + 1;
    return acc;
  }, {} as Record<string, Record<string, number>>);
  return { date, summary, byTask, count: rows.length, rows };
}

export async function insertStudyStart(userId: string): Promise<void> {
  await ensureReady();
  const startedAtJst = DateTime.now().setZone("Asia/Tokyo").toISO();
  const stmt = db.prepare("INSERT INTO study_sessions (userId, startedAtJst) VALUES (?, ?)");
  stmt.bind([userId, startedAtJst]);
  stmt.step();
  stmt.free();
  persist();
}

export async function endLatestStudySession(userId: string): Promise<void> {
  await ensureReady();
  // 找到该用户最新且未结束的会话
  const findStmt = db.prepare("SELECT id, startedAtJst FROM study_sessions WHERE userId = ? AND endedAtJst IS NULL ORDER BY id DESC LIMIT 1");
  findStmt.bind([userId]);
  let session: any | null = null;
  if (findStmt.step()) {
    session = findStmt.getAsObject();
  }
  findStmt.free();
  if (!session) return;
  const endedAt = DateTime.now().setZone("Asia/Tokyo");
  const endedAtJst = endedAt.toISO() as string;
  const startedAtStr: string = String(session.startedAtJst || "");
  const startedAt = DateTime.fromISO(startedAtStr);
  const durationMinutes = Math.max(1, Math.round((endedAt.toMillis() - startedAt.toMillis()) / 60000));
  const upd = db.prepare("UPDATE study_sessions SET endedAtJst = ?, durationMinutes = ? WHERE id = ?");
  upd.bind([endedAtJst, durationMinutes, session.id]);
  upd.step();
  upd.free();
  persist();
}

export async function getStudySessionsByDateJst(date: string) {
  await ensureReady();
  const start = DateTime.fromISO(date, { zone: "Asia/Tokyo" }).startOf("day");
  const end = start.endOf("day");
  const stmt = db.prepare(
    "SELECT * FROM study_sessions WHERE (startedAtJst >= ? AND startedAtJst <= ?) OR (endedAtJst >= ? AND endedAtJst <= ?) ORDER BY id ASC"
  );
  stmt.bind([start.toISO(), end.toISO(), start.toISO(), end.toISO()]);
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  const totalMinutes = rows.reduce((acc, r: any) => acc + (Number(r.durationMinutes) || 0), 0);
  return { date, totalMinutes, count: rows.length, rows };
}

export async function getStudySessionsByDateJstAndUser(date: string, userId: string) {
  await ensureReady();
  const start = DateTime.fromISO(date, { zone: "Asia/Tokyo" }).startOf("day");
  const end = start.endOf("day");
  const stmt = db.prepare(
    "SELECT * FROM study_sessions WHERE userId = ? AND ((startedAtJst >= ? AND startedAtJst <= ?) OR (endedAtJst >= ? AND endedAtJst <= ?)) ORDER BY id ASC"
  );
  stmt.bind([userId, start.toISO(), end.toISO(), start.toISO(), end.toISO()]);
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  const totalMinutes = rows.reduce((acc, r: any) => acc + (Number(r.durationMinutes) || 0), 0);
  return { date, totalMinutes, count: rows.length, rows };
}

export async function getDistinctUserIds(): Promise<string[]> {
  await ensureReady();
  const rs = db.exec(
    "SELECT DISTINCT userId FROM confirmations UNION SELECT DISTINCT userId FROM study_sessions ORDER BY userId ASC"
  );
  const out: string[] = [];
  if (rs.length && rs[0].values) {
    for (const v of rs[0].values as any[]) out.push(String(v[0]));
  }
  return out;
}

export async function upsertUserProfile(userId: string, displayName?: string | null, pictureUrl?: string | null): Promise<void> {
  await ensureReady();
  const updatedAt = DateTime.now().toISO();
  const stmt = db.prepare(
    "INSERT INTO user_profiles (userId, displayName, pictureUrl, updatedAt) VALUES (?, ?, ?, ?) ON CONFLICT(userId) DO UPDATE SET displayName = excluded.displayName, pictureUrl = excluded.pictureUrl, updatedAt = excluded.updatedAt"
  );
  stmt.bind([userId, displayName ?? null, pictureUrl ?? null, updatedAt]);
  stmt.step();
  stmt.free();
  persist();
}

export async function getUserProfilesMap(): Promise<Record<string, { displayName?: string; pictureUrl?: string }>> {
  await ensureReady();
  const rs = db.exec("SELECT userId, displayName, pictureUrl FROM user_profiles");
  const map: Record<string, { displayName?: string; pictureUrl?: string }> = {};
  if (rs.length && rs[0].values) {
    for (const row of rs[0].values as any[]) {
      map[String(row[0])] = { displayName: row[1] ? String(row[1]) : undefined, pictureUrl: row[2] ? String(row[2]) : undefined };
    }
  }
  return map;
}

// --- Plan state helpers ---
export interface PlanState {
  version: string;
  day: number;
  toUserId?: string | null;
  startedAtJst: string;
}

export async function setPlanState(version: string, day: number, toUserId?: string | null): Promise<void> {
  await ensureReady();
  const startedAtJst = DateTime.now().setZone("Asia/Tokyo").toISO();
  const stmt = db.prepare(
    "INSERT INTO plan_state (version, day, toUserId, startedAtJst) VALUES (?, ?, ?, ?) ON CONFLICT(version) DO UPDATE SET day = excluded.day, toUserId = excluded.toUserId, startedAtJst = excluded.startedAtJst"
  );
  stmt.bind([version, day, toUserId ?? null, startedAtJst]);
  stmt.step();
  stmt.free();
  persist();
}

export async function getPlanState(version: string): Promise<PlanState | null> {
  await ensureReady();
  const stmt = db.prepare("SELECT version, day, toUserId, startedAtJst FROM plan_state WHERE version = ?");
  stmt.bind([version]);
  let out: PlanState | null = null;
  if (stmt.step()) {
    const r = stmt.getAsObject() as any;
    out = { version: String(r.version), day: Number(r.day), toUserId: r.toUserId ? String(r.toUserId) : null, startedAtJst: String(r.startedAtJst) };
  }
  stmt.free();
  return out;
}

export async function advancePlanDay(version: string, maxDay: number = 9999): Promise<number> {
  await ensureReady();
  const cur = await getPlanState(version);
  const next = Math.min(maxDay, (cur?.day || 1) + 1);
  await setPlanState(version, next, cur?.toUserId ?? null);
  return next;
}

// --- Points & streak helpers ---
export async function addPoints(userId: string, delta: number): Promise<number> {
  await ensureReady();
  // upsert user row
  const sel = db.prepare("SELECT points FROM users WHERE userId = ?");
  sel.bind([userId]);
  let points = 0;
  if (sel.step()) {
    points = Number(sel.getAsObject().points) || 0;
  }
  sel.free();
  points += delta;
  const up = db.prepare(
    "INSERT INTO users (userId, points, streak) VALUES (?, ?, COALESCE((SELECT streak FROM users WHERE userId = ?), 0)) ON CONFLICT(userId) DO UPDATE SET points = excluded.points"
  );
  up.bind([userId, points, userId]);
  up.step();
  up.free();
  persist();
  return points;
}

export async function getPointsAndStreak(userId: string): Promise<{ points: number; streak: number }> {
  await ensureReady();
  const sel = db.prepare("SELECT points, streak FROM users WHERE userId = ?");
  sel.bind([userId]);
  let points = 0; let streak = 0;
  if (sel.step()) { const r = sel.getAsObject() as any; points = Number(r.points||0); streak = Number(r.streak||0); }
  sel.free();
  return { points, streak };
}

export interface LeaderboardItem { userId: string; points: number; streak: number; displayName?: string }
export async function getUsersLeaderboard(): Promise<LeaderboardItem[]> {
  await ensureReady();
  const rs = db.exec("SELECT userId, points, streak FROM users ORDER BY points DESC, streak DESC, userId ASC");
  const list: LeaderboardItem[] = [];
  if (rs.length && rs[0].values) {
    for (const row of rs[0].values as any[]) {
      list.push({ userId: String(row[0]), points: Number(row[1]||0), streak: Number(row[2]||0) });
    }
  }
  // attach displayName if available
  const profiles = await getUserProfilesMap();
  return list.map(it => ({ ...it, displayName: profiles[it.userId]?.displayName }));
}

export async function updateStreakOnFullDone(userId: string, dateIso: string): Promise<number> {
  await ensureReady();
  const c = await getConfirmationsByDateJstAndUser(dateIso, userId);
  const required: TaskType[] = ["vocab", "grammar", "listening", "reading"];
  const allDone = required.every((t) => ((c.byTask?.[t]?.done || 0) as number) > 0);
  if (!allDone) return 0;
  const sel = db.prepare("SELECT streak, lastFullDoneDate FROM users WHERE userId = ?");
  sel.bind([userId]);
  let streak = 0;
  let last = "";
  if (sel.step()) {
    const row = sel.getAsObject() as any;
    streak = Number(row.streak) || 0;
    last = String(row.lastFullDoneDate || "");
  }
  sel.free();
  const today = DateTime.fromISO(dateIso, { zone: "Asia/Tokyo" }).startOf("day");
  const prev = today.minus({ days: 1 }).toISODate();
  if (last === prev) streak += 1; else streak = 1;
  const up = db.prepare(
    "INSERT INTO users (userId, points, streak, lastFullDoneDate) VALUES (?, COALESCE((SELECT points FROM users WHERE userId = ?),0), ?, ?) ON CONFLICT(userId) DO UPDATE SET streak = excluded.streak, lastFullDoneDate = excluded.lastFullDoneDate"
  );
  up.bind([userId, userId, streak, today.toISODate()]);
  up.step();
  up.free();
  persist();
  return streak;
}

export async function insertTaskMinutes(userId: string, task: TaskType, minutes: number): Promise<void> {
  await ensureReady();
  const date = DateTime.now().setZone("Asia/Tokyo").toISODate();
  const stmt = db.prepare("INSERT INTO task_minutes (userId, date, task, minutes) VALUES (?, ?, ?, ?)");
  stmt.bind([userId, date, task, minutes]);
  stmt.step();
  stmt.free();
  persist();
}

export async function insertTaskProgress(userId: string, task: TaskType, metric: string, amount: number): Promise<void> {
  await ensureReady();
  const date = DateTime.now().setZone("Asia/Tokyo").toISODate();
  const stmt = db.prepare("INSERT INTO task_progress (userId, date, task, metric, amount) VALUES (?, ?, ?, ?, ?)");
  stmt.bind([userId, date, task, metric, amount]);
  stmt.step();
  stmt.free();
  persist();
}

// --- Pomodoro persistence ---
export async function logPomodoroEvent(userId: string, task: Exclude<TaskType, "all">, event: string, meta?: any): Promise<void> {
  await ensureReady();
  const atJst = DateTime.now().setZone("Asia/Tokyo").toISO();
  const stmt = db.prepare("INSERT INTO pomodoro_events (userId, task, event, atJst, meta) VALUES (?, ?, ?, ?, ?)");
  stmt.bind([userId, task, event, atJst, meta ? JSON.stringify(meta) : null]);
  stmt.step();
  stmt.free();
  persist();
}

export interface PomodoroUserConfig { focus: number; brk: number; longBrk: number; longEvery: number }
export async function setPomodoroUserConfig(userId: string, cfg: PomodoroUserConfig): Promise<void> {
  await ensureReady();
  const stmt = db.prepare(
    "INSERT INTO pomodoro_user_config (userId, focus, brk, longBrk, longEvery) VALUES (?, ?, ?, ?, ?) ON CONFLICT(userId) DO UPDATE SET focus=excluded.focus, brk=excluded.brk, longBrk=excluded.longBrk, longEvery=excluded.longEvery"
  );
  stmt.bind([userId, cfg.focus, cfg.brk, cfg.longBrk, cfg.longEvery]);
  stmt.step();
  stmt.free();
  persist();
}

export async function getPomodoroUserConfig(userId: string): Promise<PomodoroUserConfig | null> {
  await ensureReady();
  const stmt = db.prepare("SELECT focus, brk, longBrk, longEvery FROM pomodoro_user_config WHERE userId = ?");
  stmt.bind([userId]);
  let out: PomodoroUserConfig | null = null;
  if (stmt.step()) {
    const r = stmt.getAsObject() as any;
    out = { focus: Number(r.focus), brk: Number(r.brk), longBrk: Number(r.longBrk), longEvery: Number(r.longEvery) };
  }
  stmt.free();
  return out;
}

export async function getPomodoroSummary(days: number, userId?: string) {
  await ensureReady();
  const end = DateTime.now().setZone("Asia/Tokyo").endOf("day");
  const start = end.minus({ days: days - 1 }).startOf("day");
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = start.plus({ days: i });
    dates.push(d.toISODate()!);
  }
  const whereUser = userId ? " AND userId = ?" : "";
  const stmt = db.prepare(
    `SELECT userId, task, event, atJst FROM pomodoro_events WHERE atJst >= ? AND atJst <= ?${whereUser}`
  );
  const bind = userId ? [start.toISO(), end.toISO(), userId] : [start.toISO(), end.toISO()];
  stmt.bind(bind as any);
  const rows: Array<{ userId: string; task: string; event: string; atJst: string }> = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as any);
  stmt.free();
  const perDay: Record<string, number> = {};
  const byTask: Record<string, number> = { vocab: 0, grammar: 0, listening: 0, reading: 0 } as any;
  for (const r of rows) {
    // 以 start_focus 计 1 个番茄
    if (r.event === "start_focus") {
      const d = DateTime.fromISO(String(r.atJst)).setZone("Asia/Tokyo").toISODate()!;
      perDay[d] = (perDay[d] || 0) + 1;
      if ((byTask as any)[r.task] !== undefined) (byTask as any)[r.task] += 1;
    }
  }
  const counts = dates.map((d) => perDay[d] || 0);
  return { dates, counts, byTask };
}

// --- Flashcards (SRS) ---
export interface CardInput { front: string; back?: string; example?: string; language?: string; tags?: string }
export interface CardRow extends CardInput { id: number; userId: string; createdAtJst: string }

export async function createCard(userId: string, input: CardInput): Promise<CardRow> {
  await ensureReady();
  const createdAtJst = DateTime.now().setZone("Asia/Tokyo").toISO();
  const stmt = db.prepare("INSERT INTO cards (userId, front, back, example, language, tags, createdAtJst) VALUES (?, ?, ?, ?, ?, ?, ?)");
  stmt.bind([userId, input.front, input.back ?? null, input.example ?? null, input.language ?? null, input.tags ?? null, createdAtJst]);
  stmt.step();
  stmt.free();
  const id = (db.exec("SELECT last_insert_rowid() AS id")[0].values[0][0]) as number;
  // 初始化 SRS：新卡今天到期
  const due = DateTime.now().setZone("Asia/Tokyo").endOf("day").toISO();
  const s = db.prepare("INSERT INTO srs (cardId, userId, ease, intervalDays, reps, lapses, dueDateJst, lastGrade) VALUES (?, ?, 2.5, 0, 0, 0, ?, NULL)");
  s.bind([id, userId, due]); s.step(); s.free();
  persist();
  return { id, userId, createdAtJst, ...input } as CardRow;
}

export async function listDueCards(userId: string, dateIso: string): Promise<CardRow[]> {
  await ensureReady();
  const end = DateTime.fromISO(dateIso, { zone: "Asia/Tokyo" }).endOf("day").toISO();
  const stmt = db.prepare(`
    SELECT c.id, c.userId, c.front, c.back, c.example, c.language, c.tags, c.createdAtJst
    FROM cards c JOIN srs s ON c.id = s.cardId AND c.userId = s.userId
    WHERE c.userId = ? AND (s.dueDateJst IS NULL OR s.dueDateJst <= ?)
    ORDER BY s.dueDateJst ASC, c.id ASC
    LIMIT 100
  `);
  stmt.bind([userId, end]);
  const rows: CardRow[] = [] as any;
  while (stmt.step()) rows.push(stmt.getAsObject() as any);
  stmt.free();
  return rows;
}

export async function reviewCard(userId: string, cardId: number, grade: number): Promise<{ nextDueDateJst: string; ease: number; intervalDays: number; reps: number; lapses: number }> {
  await ensureReady();
  // 读取现有 SRS
  const sel = db.prepare("SELECT ease, intervalDays, reps, lapses FROM srs WHERE cardId = ? AND userId = ?");
  sel.bind([cardId, userId]);
  let ease = 2.5, intervalDays = 0, reps = 0, lapses = 0;
  if (sel.step()) {
    const r = sel.getAsObject() as any;
    ease = Number(r.ease || 2.5);
    intervalDays = Number(r.intervalDays || 0);
    reps = Number(r.reps || 0);
    lapses = Number(r.lapses || 0);
  }
  sel.free();
  const today = DateTime.now().setZone("Asia/Tokyo").startOf("day");
  const gradeNum = Math.max(0, Math.min(5, Number(grade)));
  const intervalBefore = intervalDays;
  if (gradeNum >= 3) {
    // 成功回忆
    if (reps === 0) intervalDays = 1;
    else if (reps === 1) intervalDays = 6;
    else intervalDays = Math.max(1, Math.round(intervalDays * ease));
    reps += 1;
    // SM-2 ease 更新
    ease = ease + (0.1 - (5 - gradeNum) * (0.08 + (5 - gradeNum) * 0.02));
    if (ease < 1.3) ease = 1.3;
  } else {
    // 失败
    reps = 0;
    lapses += 1;
    intervalDays = 1;
  }
  const nextDue = today.plus({ days: intervalDays }).endOf("day").toISO() as string;
  // 写入 srs
  const up = db.prepare(
    "INSERT INTO srs (cardId, userId, ease, intervalDays, reps, lapses, dueDateJst, lastGrade) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(cardId, userId) DO UPDATE SET ease=excluded.ease, intervalDays=excluded.intervalDays, reps=excluded.reps, lapses=excluded.lapses, dueDateJst=excluded.dueDateJst, lastGrade=excluded.lastGrade"
  );
  up.bind([cardId, userId, ease, intervalDays, reps, lapses, nextDue, gradeNum]);
  up.step(); up.free();
  // 复习日志
  const reviewedAtJst = DateTime.now().setZone("Asia/Tokyo").toISO();
  const insr = db.prepare("INSERT INTO reviews (cardId, userId, reviewedAtJst, grade, intervalBefore, intervalAfter, easeAfter) VALUES (?, ?, ?, ?, ?, ?, ?)");
  insr.bind([cardId, userId, reviewedAtJst, gradeNum, intervalBefore, intervalDays, ease]);
  insr.step(); insr.free();
  persist();
  return { nextDueDateJst: nextDue, ease, intervalDays, reps, lapses };
}

export async function listRecentCards(userId?: string, limit: number = 100): Promise<CardRow[]> {
  await ensureReady();
  const lim = Math.max(1, Math.min(500, Number(limit || 100)));
  const sql = userId
    ? "SELECT id, userId, front, back, example, language, tags, createdAtJst FROM cards WHERE userId = ? ORDER BY id DESC LIMIT ?"
    : "SELECT id, userId, front, back, example, language, tags, createdAtJst FROM cards ORDER BY id DESC LIMIT ?";
  const stmt = db.prepare(sql);
  if (userId) stmt.bind([userId, lim]); else stmt.bind([lim]);
  const rows: CardRow[] = [] as any;
  while (stmt.step()) rows.push(stmt.getAsObject() as any);
  stmt.free();
  return rows;
}
