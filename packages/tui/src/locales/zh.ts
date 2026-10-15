/**
 * 中文目录（简体）。
 *
 * 这是一个“部分翻译”的目录，刻意的：它的类型是 Partial，未收录的键会
 * 逐键回退到 locales/en.ts（`t()` 与占位符校验都已支持回退）。首批覆盖：
 *   - 终端 TUI（tui/*）的全部界面文案；
 *   - 客户端错误与图片相关提示（client.*），TUI 会直接显示它们；
 *   - 账户与语言选择器（account.*、language.*）。
 *
 * 模型指令类的文案（prompt.*、protocol.*、hint.* 等）暂不翻译：它们是对
 * BizChat 调校过的英文原文，等确有必要时再逐条翻译，避免无意改变行为。
 * 新增键时必须同时出现在 en.ts 与 es.ts，否则英文参考目录缺键。
 */
import type { en } from "./en";

export const zh: Readonly<Partial<Record<keyof typeof en, string>>> = {
  // ------------------------------------------------------------ 语言
  "language.en": "英语",
  "language.es": "西班牙语",
  "language.zh": "中文",
  "language.auto": "自动（跟随 VS Code 显示语言：{0}）",
  "language.pick.title": "M365 Copilot — 语言",
  "language.pick.placeholder": "消息、工具结果以及发送给模型的指令所使用的语言",

  // ------------------------------------------------------------ 账户菜单
  "account.unknownUser": "M365 Copilot 用户",
  "account.signIn.title": "使用 M365 Copilot 登录",
  "account.signIn.placeholder": "你想如何把 M365 Copilot 会话带到 VS Code？",
  "account.signIn.browser": "在浏览器中打开 M365 Copilot",
  "account.signIn.browserDetail": "浏览器扩展或用户脚本会自动把令牌发送到 VS Code。",
  "account.signIn.paste": "粘贴配置文件或令牌",
  "account.signIn.pasteDetail": "在浏览器扩展或用户脚本中点击“复制令牌”即可获得。",
  "account.signIn.waiting": "正在等待来自浏览器的令牌……（请在那里登录 M365 Copilot）",
  "account.signIn.timeout":
    "M365 Copilot：没有收到来自浏览器的令牌。浏览器扩展或用户脚本安装了吗？也可以直接粘贴令牌。",
  "account.signInCancelled": "M365 Copilot 登录已取消。",

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

  // ------------------------------------------------------------ 终端 TUI（tui/）
  "tui.banner.title": "M365 Copilot · 终端聊天",
  "tui.banner.version": "v{0}",
  "tui.banner.tip": "/help 查看命令 · Ctrl+C 取消正在生成的回答 · /exit 退出",
  "tui.banner.log": "诊断日志：{0}",
  "tui.ui.placeholder": "输入消息…（/help 查看命令）",
  "tui.ui.hints": "Enter 发送 · Tab 补全 · ↑↓ 历史 · Ctrl+C 取消 · Ctrl+D 退出",
  "tui.help.title": "命令",
  "tui.help.body":
    "/model [n|id|tone]  列出模型或选择模型（如 /model 3、/model Claude_Sonnet@paid）\n" +
    "/web [on|off]       以 Web 应用的方式发送轮次（Bing 搜索，不带工作区工具）\n" +
    "/img <文件>…        为下一轮预置图片；/img 单独使用列出，/img clear 清空\n" +
    "/new                开始新对话\n" +
    "/clear              清屏\n" +
    "/status             账户、令牌、模型与连接详情\n" +
    "/login [令牌]       粘贴 Copilot 令牌、“Bearer …” 请求头、Chathub URL 或 JSON 配置文件\n" +
    "/logout             忘记已保存的令牌\n" +
    "/exit               退出（也可用 /quit 或 Ctrl+D）\n" +
    "\n其他内容会直接发送给 M365 Copilot；在提示符下粘贴令牌即可登录。",
  "tui.you": "你",
  "tui.assistant": "M365 Copilot",
  "tui.thinking": "正在思考…",
  "tui.meta": "{0} 秒 · {1} 字符",
  "tui.meta.sources": " · {0} 个来源",
  "tui.sources": "来源：",
  "tui.cancelled": "已取消——已向服务发送“停止”",
  "tui.goodbye": "再见。令牌保存在 {0}；只要浏览器里开着 M365 Copilot，扩展或用户脚本就会持续刷新它。",
  "tui.status.user": "已登录：{0}",
  "tui.status.noUser": "尚未登录",
  "tui.status.token": "令牌约 {0} 分钟",
  "tui.status.tokenUnknown": "令牌有效期未知",
  "tui.status.tokenExpired": "令牌已过期",
  "tui.status.model": "模型：{0}",
  "tui.status.web.on": "Web 轮次",
  "tui.status.web.off": "工具轮次",
  "tui.status.tier.paid": "M365 Copilot 许可证",
  "tui.status.tier.included": "Copilot Chat（包含版）",
  "tui.status.tier.unknown": "许可证未知",
  "tui.status.receiver": "自动同步监听 localhost:{0}",
  "tui.status.receiverOff": "自动同步关闭（localhost:{0} 被占用）",
  "tui.onboarding.title": "连接 M365 Copilot",
  "tui.onboarding.body":
    "还没有可用的令牌。两种获取方式：\n" +
    "  1. 在浏览器中保持 M365 Copilot 打开，并安装扩展或用户脚本——\n" +
    "     令牌会自动推送到这里（localhost:{0}）。\n" +
    "  2. 在下方直接粘贴：JWT、“Bearer …”，或 Chathub WebSocket URL\n" +
    "     （DevTools → 网络 → 筛选 “chathub” → 复制 URL）。\n" +
    "以后也可以随时用 /login 粘贴。",
  "tui.token.saved": "令牌已保存 ✓ {0} · 约 {1} 分钟后过期",
  "tui.token.savedNoExp": "令牌已保存 ✓ {0}",
  "tui.token.pushed": "已收到来自浏览器的令牌 ✓ {0}",
  "tui.token.bad": "这看起来不是 Copilot 令牌：{0}",
  "tui.token.badAudience": "这不是 M365 Copilot 的令牌，而是 {0} 的；用它每条消息都会失败并返回 401。",
  "tui.token.gone": "已忘记令牌。当浏览器打开 M365 Copilot 时，扩展或用户脚本会推送新的令牌。",
  "tui.model.catalog.fetching": "正在获取在线模型目录…",
  "tui.model.catalog.failed": "无法获取在线模型目录，显示已知的模型。",
  "tui.model.title": "模型——用 /model <n|id> 选择：",
  "tui.model.current": "当前",
  "tui.model.set": "模型：{0}",
  "tui.model.unknown": "没有匹配“{0}”的模型。/model 可查看全部。",
  "tui.web.on": "Web 模式已开启：轮次将按 Web 应用的方式发送（Bing 搜索，不带工作区工具）。",
  "tui.web.off": "Web 模式已关闭：轮次使用工具协议。",
  "tui.new": "新对话已开始。",
  "tui.login.hint": "请在下方粘贴令牌、“Bearer …” 请求头、Chathub URL 或 JSON 配置文件。",
  "tui.logout.hint": "已从 {0} 清除令牌。",
  "tui.cmd.unknown": "未知命令“{0}”。/help 可查看全部。",
  "tui.image.queued": "已为下一轮预置：{0}",
  "tui.image.list": "已预置 {0} 张图片：{1}",
  "tui.image.none": "没有预置图片。/img <文件> 可为下一轮预置一张。",
  "tui.image.cleared": "图片队列已清空。",
  "tui.image.failed": "无法读取 {0}：{1}",
  "tui.err.auth": "提示：令牌被拒绝——请重新捕获（浏览器扩展/用户脚本会自动同步到这里），或用 /login 粘贴新的令牌。",
  "tui.err.model": "提示：该模型对你的账户不可用——用 /model 换一个。",
  "tui.err.quota": "提示：该模型的优先访问已用尽，将在 {0} 重置。",
  "tui.err.license": "提示：你的账户没有用于该请求的许可证。",
  "tui.interrupted": "再按一次 Ctrl+C 退出。",
  "tui.remoteWork": "提示：该操作在 M365 云沙箱中执行（{0}），不是在本机",
  "tui.cli.body":
    "m365-copilot-tui [选项] [首条消息]\n" +
    "\n" +
    "  -t, --token <令牌>     保存 Copilot 令牌（JWT、“Bearer …”、Chathub URL 或 JSON）\n" +
    "  -m, --model <模型>     轮次使用的模型（如 Claude_Sonnet@paid；留空 = 自动）\n" +
    "  -w, --web              以 Web 应用的方式发送轮次（Bing 搜索）\n" +
    "      --lang <语言>      界面语言：auto、en、es 或 zh\n" +
    "      --config-dir <目录> 令牌、设置与历史的存放位置\n" +
    "  -v, --verbose          将深度诊断写入日志文件\n" +
    "  -h, --help             显示此帮助\n" +
    "  -V, --version          显示版本",
  "tui.cli.unknown": "未知选项“{0}”。试试 --help。",
  "tui.needTty": "终端聊天需要交互式终端（stdin 与 stdout 均为 TTY）。",
  "tui.needFfi":
    "终端界面需要 Node 的实验性 FFI 模块：请以 `node --experimental-ffi dist/m365-copilot-tui.mjs` 启动" +
    "（或设置 NODE_OPTIONS=--experimental-ffi）。",
};
