import crypto from "crypto";
import axios from "axios";
import { DateTime } from "luxon";
import dotenv from "dotenv";
dotenv.config();

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN as string;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET as string;

export function verifySignature(rawBody: string, signature: string | undefined, channelSecret = CHANNEL_SECRET): boolean {
  if (!signature) return false;
  if (!channelSecret) return false;
  const hmac = crypto
    .createHmac("sha256", channelSecret)
    .update(Buffer.from(rawBody, "utf8"))
    .digest("base64");
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
}

export async function push(to: string, messages: any[]) {
  const url = "https://api.line.me/v2/bot/message/push";
  const res = await axios.post(
    url,
    { to, messages },
    {
      headers: {
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
  return res.data;
}

export async function reply(replyToken: string, messages: any[]) {
  const url = "https://api.line.me/v2/bot/message/reply";
  const res = await axios.post(
    url,
    { replyToken, messages },
    {
      headers: {
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
  return res.data;
}

export async function getUserProfile(userId: string) {
  const url = `https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` }
  });
  return res.data as { userId: string; displayName?: string; pictureUrl?: string };
}

export const buildTasksText = () =>
  [
    "📘 今日托业计划（4h）",
    "1) 词汇 60m（新50+复50）",
    "2) 语法 60m（Part5/6）",
    "3) 听力 90m（Part2 + Part3/4精听/跟读）",
    "4) 阅读/复盘 30m（Part7或精读1篇）"
  ].join("\n");

export const MorningMessageText = (to: string) => ({
  to,
  messages: [
    {
      type: "text",
      text: `${buildTasksText()}\n晚间我会来确认✅`,
      quickReply: {
        items: [
          {
            type: "action",
            action: { type: "message", label: "开始学习 ▶️", text: "开始学习" }
          },
          { type: "action", action: { type: "message", label: "番茄钟 ▶️", text: "番茄钟" } },
          { type: "action", action: { type: "message", label: "主页 ▶️", text: "主页" } },
          { type: "action", action: { type: "message", label: "管理 ▶️", text: "管理" } }
        ]
      }
    }
  ]
});

export const EveningMessageText = (to: string) => ({
  to,
  messages: [
    {
      type: "text",
      text: `${buildTasksText()}\n\n小确认：今天各任务是否完成？\n可直接回复：词汇已完成/未完成、语法已完成/未完成、听力已完成/未完成、阅读已完成/未完成，或点下方按钮。`,
      quickReply: {
        items: [
          { type: "action", action: { type: "postback", label: "词汇 ✅", data: "task=vocab&status=done" } },
          { type: "action", action: { type: "postback", label: "词汇 ❌", data: "task=vocab&status=miss" } },
          { type: "action", action: { type: "postback", label: "语法 ✅", data: "task=grammar&status=done" } },
          { type: "action", action: { type: "postback", label: "语法 ❌", data: "task=grammar&status=miss" } },
          { type: "action", action: { type: "postback", label: "听力 ✅", data: "task=listening&status=done" } },
          { type: "action", action: { type: "postback", label: "听力 ❌", data: "task=listening&status=miss" } },
          { type: "action", action: { type: "postback", label: "阅读 ✅", data: "task=reading&status=done" } },
          { type: "action", action: { type: "postback", label: "阅读 ❌", data: "task=reading&status=miss" } },
          { type: "action", action: { type: "message", label: "番茄钟 ▶️", text: "番茄钟" } },
          { type: "action", action: { type: "message", label: "主页 ▶️", text: "主页" } },
          { type: "action", action: { type: "message", label: "管理 ▶️", text: "管理" } }
        ]
      }
    }
  ]
});

export const MorningFlexBubble = (to: string) => ({
  to,
  messages: [
    {
      type: "flex",
      altText: "今日托业计划",
      contents: {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          contents: [
            { type: "text", text: "今日托业计划", weight: "bold", size: "lg" }
          ]
        },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            { type: "text", text: "1) 词汇 60m（新50+复50）" },
            { type: "text", text: "2) 语法 60m（Part5/6）" },
            { type: "text", text: "3) 听力 90m（Part2 + Part3/4精听/跟读）" },
            { type: "text", text: "4) 阅读/复盘 30m（Part7或精读1篇）" }
          ]
        },
        footer: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "button",
              style: "primary",
              action: { type: "message", label: "开始学习 ▶️", text: "开始学习" }
            }
          ]
        }
      }
    }
  ]
});

export function buildMorningMessages(to: string, useFlex = false) {
  return useFlex ? MorningFlexBubble(to) : MorningMessageText(to);
}

export function buildEveningMessages(to: string) {
  return EveningMessageText(to);
}

export function buildHelpText(): string {
  return [
    "可用指令：",
    "- 开始学习：记录学习开始时间",
    "- 词汇/语法/听力/阅读 已完成或未完成：记录该任务状态",
    "  例：词汇已完成、语法未完成、听力✅、阅读❌",
    "- 状态/统计/進度：查看今日各任务与学习时长",
    "- 计划：查看今日学习任务清单",
    "- 周报：查看近 7 天统计",
    "- 番茄钟：获取计时页面链接",
    "- 主页：聚合入口（番茄、闪卡、任务）",
  ].join("\n");
}

export function buildHelpMessages(to: string) {
  return {
    to,
    messages: [
      { type: "text", text: buildHelpText(), quickReply: { items: [
        { type: "action", action: { type: "message", label: "番茄钟 ▶️", text: "番茄钟" } },
        { type: "action", action: { type: "message", label: "管理 ▶️", text: "管理" } }
      ] } }
    ]
  };
}

export function buildCountdownMessage(to: string, examIso?: string) {
  const zone = "Asia/Tokyo";
  const targetIso = (examIso || process.env.EXAM_DATE || "2025-08-22").slice(0, 10);
  const today = DateTime.now().setZone(zone).startOf("day");
  const target = DateTime.fromISO(targetIso, { zone }).startOf("day");
  const diffDays = Math.max(0, Math.ceil(target.diff(today, "days").days));
  const weekday = ["一","二","三","四","五","六","日"][((target.weekday % 7)) % 7];
  const text = `📅 托业倒计时：${diffDays} 天\n目标日期：${target.toFormat("MM/dd")}（周${weekday}）\n坚持到底，今天也要加油！`;
  return { to, messages: [{ type: "text", text }] };
}
