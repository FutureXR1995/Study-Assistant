import fs from "node:fs";
import path from "node:path";

export type PlanSlot = "morning" | "evening" | "flexMorning";

interface PlanMessageSlot {
  to: string;
  messages: any[];
}

interface PlanDay {
  day: number;
  morning?: PlanMessageSlot;
  evening?: PlanMessageSlot;
  flexMorning?: PlanMessageSlot;
}

interface PlanFile {
  version: string;
  timezone?: string;
  placeholderUserKey?: string;
  notes?: string;
  days: PlanDay[];
}

export function loadPlan(version: string): PlanFile {
  const file = path.resolve("config", `plan-${version}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`plan config not found: ${file}`);
  }
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw) as PlanFile;
}

export function getPlanMessages(
  version: string,
  day: number,
  slot: PlanSlot,
  toOverride?: string
): { to: string; messages: any[] } {
  const plan = loadPlan(version);
  const placeholder = plan.placeholderUserKey || "__LINE_USER_ID__";
  const d = plan.days.find((x) => Number(x.day) === Number(day));
  if (!d) throw new Error(`day not found: ${day}`);
  const s = (d as any)[slot] as PlanMessageSlot | undefined;
  if (!s) throw new Error(`slot not found for day ${day}: ${slot}`);
  const to = toOverride || process.env.DEFAULT_LINE_USER_ID || s.to;
  const serialized = JSON.stringify(s.messages);
  const replaced = serialized.split(placeholder).join(String(to));
  const messages = JSON.parse(replaced);
  return { to: String(to), messages };
}


