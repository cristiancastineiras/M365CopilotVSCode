/**
 * 中文目录（简体）——BizChat 层中已翻译的部分。
 *
 * 这是一个“部分翻译”的目录，刻意的：类型是 Partial，未收录的键会逐键回退到
 * locales/en.ts。目前只覆盖客户端错误与图片相关提示（client.*）以及账户相关
 * 文案，因为终端 TUI 会直接显示它们；模型指令类文案（protocol.*、hint.* 等）
 * 是针对 BizChat 调校过的英文原文，暂不翻译，避免无意改变行为。
 */
import type { en } from "./en";

export const zh: Readonly<Partial<Record<keyof typeof en, string>>> = {
  // ------------------------------------------------------------ 账户
  "account.unknownUser": "M365 Copilot 用户",

  // ------------------------------------------------------------ 客户端（BizChat）
  "client.error.401":
    "M365 Copilot 拒绝了该令牌（401 Unauthorized）。令牌可能已过期，或服务器在其过期时间之前就将其作废。" +
    "请在 m365.cloud.microsoft 重新捕获令牌，然后用“M365 Copilot: 粘贴配置文件或令牌”重新粘贴。",
  "client.error.403":
    "M365 Copilot 拒绝访问（403 Forbidden）。你的账户可能没有 Copilot 许可证，或捕获的令牌不允许在此端点上使用。" +
    "请重新捕获配置文件后重试。",
  "client.error.foreignAudience":
    "M365 Copilot 拒绝了这个令牌（{0}）：保存的令牌属于 {1}，而不是 Copilot。请在 m365.cloud.microsoft/chat 打开 " +
    "DevTools → 网络，筛选 chathub，复制聊天 WebSocket 的 URL，再用“M365 Copilot: 粘贴配置文件或令牌”粘贴。",
  "client.error.429": "M365 Copilot 正在限流（429 Too Many Requests）。请等待几秒后重试。",
  "client.error.upgrade": "M365 Copilot 拒绝了 WebSocket 连接（HTTP {0}）。",
  "client.error.turnTimeout":
    "本轮回答超过 5 分钟仍未完成，已取消。模型可能卡在很长的回答上——请试着一次少问一些（例如一次一个文件）。",
  "client.error.repetition":
    "M365 Copilot 陷入重复同一片段、毫无进展（模型循环），本轮已取消。请重试；若再次出现，请把问题问得更具体或拆成更少步骤。",
  "client.error.idle": "M365 Copilot 没有响应（超时）。",
  "client.error.handshake": "Copilot WebSocket 未完成握手。",
  "client.error.connection": "连接 Copilot 失败：{0}",
  "client.error.closed": "Copilot 关闭了连接（代码 {0}）。",
  "client.error.handshakeRejected": "握手被拒绝：{0}",
  "client.error.rejected": "服务拒绝了该请求（{0}）{1}",
  "client.error.modelUnavailable":
    "M365 Copilot 没有为你的账户运行“{0}”（{1}）。新模型按阶段向组织推送，Anthropic 和 OpenAI 的模型需要管理员启用。" +
    "请选择“M365 Copilot（自动）”，或运行“M365 Copilot: 检查模型”查看可用的模型。",
  "client.error.disengaged": "M365 Copilot 拒绝回答该请求（未作回复便结束了对话）。",
  "client.error.serverSaid": " M365 Copilot 表示：“{0}”",
  "client.error.throttled":
    "M365 Copilot 正在限制你账户的请求（{0}）：短时间内请求过多。停止请求大约一小时后会自动解除；" +
    "提前重试只会延长限制。内联补全和自动检查将暂停到约 {1}。",
  "client.error.quotaDay":
    "你对 {0} 的优先访问今日已用尽。它将在 UTC 午夜重置（你所在时区的时间 {1}）；在此之前请选择其他模型。",
  "client.error.quotaWeek":
    "你对 {0} 的优先访问本周已用尽。它将在周一 UTC 午夜重置（你所在时区的时间 {1}）；在此之前请选择其他模型。",
  "client.error.license":
    "M365 Copilot 表示你的账户没有用于此请求的有效许可证（{0}）。请与 Microsoft 365 管理员确认。",
  "client.error.premiumRequired":
    "“{0}”需要 Microsoft 365 Copilot 许可证，而 M365 Copilot 表示你的账户没有（仅有 Copilot Chat 不够）。" +
    "请选择其他模型，例如“M365 Copilot（自动）”。",
  "client.image.tooMany": "每个请求最多携带最后 {1} 张图片（{0} 张被舍弃）",
  "client.image.type": "不支持 {0} 格式的图片（PNG、JPEG、GIF、WebP 或 BMP）",
  "client.image.tooBig": "{0} MB 的图片超过 {1} MB 的限制",
  "client.image.upload": "上传失败：{0}",
};
