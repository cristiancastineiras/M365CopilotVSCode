---
"m365-copilot-vscode": minor
---

**Models: the M365 Copilot web app's own menu, and a clear answer when a model is not available on your account.**

- The built-in models follow the web app's menu and labels: **Auto**, **Quick response** and **Think deeper** (M365 Copilot picks the model, fast or thorough — tones `Chat` / `Reasoning`), then GPT 5.6 Think deeper, GPT 5.5 Quick response / Think deeper, Claude Sonnet and the new **Claude Sonnet Think deeper**. `GPT 5.6` (tone `Gpt_5_6_Chat`), which the web app does not offer, is gone; the online catalog also hides it, and the retired GPT 5.4 / 5.3 / 5.2 tones, for installed versions.
- Models detected in the web app get its labels too: `Gpt_6_1_Sol_Reasoning` reads "GPT 6.1 Sol Think deeper", `Gpt_5_7_Chat` "GPT 5.7 Quick response". The newest models (GPT-6.1 Sol, Claude Sonnet 5.5…) roll out per organisation and their tones are not public, so they appear once you use them on M365 Copilot with the browser extension or the userscript.
- **Auto is Auto everywhere**: web-search turns used to reuse whichever model you last picked in the web app.
- When the service turns a forced model down, or answers with its own canned reply instead of the model, the extension says the model is not available on your account (with the service's reason, suggesting Auto) instead of showing that reply as the answer, does not retry it, and flags the model in the chat's model picker for 12 h or until it works again.
- New command **M365 Copilot: Check models** (also the first entry of *Update models*): one short message per model, then the list of the ones that work on your account.
