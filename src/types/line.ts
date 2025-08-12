export interface LineEventBase {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
}

export interface LinePostbackEvent extends LineEventBase {
  type: "postback";
  postback: { data: string };
}

export interface LineWebhookRequestBody {
  events: Array<LineEventBase | LinePostbackEvent>;
}
