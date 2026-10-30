# Chrome Web Store: Privacy practices

These are the English entries for the developer dashboard's **Privacy practices** tab. They are separate from the store description and cannot be supplied through the extension's manifest.

## Before completing the form

1. Upload the rebuilt `releases/chrome/m365-copilot-vscode-extension-chrome.zip` to replace the previous draft package.
2. The new manifest no longer requests `activeTab`: the extension does not need its temporary access. Once Chrome processes the new package, that justification field should disappear. Do not invent a justification for the previous package.
3. Paste each text block below into its matching field.
4. Select **No, I am not using remote code**.
5. Complete the data disclosures below, add the public privacy policy URL, review the certification statements, and save the draft.

## Single purpose description

```text
Connect the user's existing Microsoft 365 Copilot web session to the M365 Copilot extension for Visual Studio Code. The browser extension captures the Copilot authentication profile, synchronizes it with the companion server on the same computer, and manages token renewal and user-requested Microsoft sign-out. It does not provide a separate chat service or grant access to Microsoft services that the user's account does not already have.
```

## storage justification

```text
Store the captured Microsoft 365 Copilot authentication profile and the connection, synchronization and renewal state in chrome.storage.local so the popup and background service worker can share them and resume after the worker stops. The stored profile can include the token, account identifiers, Copilot endpoint, page origin, browser user agent, observed model choices and a captured chat invocation template. This data supports the browser-to-VS-Code connection and is not used for advertising or sold.
```

## tabs justification

```text
Locate existing Microsoft 365 Copilot tabs, request token rescans, reload a Copilot tab when renewal requires it, and open a background Copilot tab when none is available. The permission also supports opening the sign-in page and finding or closing Microsoft tabs during a user-requested full sign-out, so those pages cannot recreate the session being cleared. Tab URLs are used to identify relevant Microsoft pages, not to build an unrelated browsing-history database.
```

## alarms justification

```text
Schedule a one-minute heartbeat that wakes the Manifest V3 background service worker to check token expiry, perform bounded renewal attempts, retry synchronization when VS Code becomes available, and check for sign-out requests from the local companion. Normal JavaScript timers are not reliable when Chrome suspends the service worker. The alarm is used only to maintain this authentication connection.
```

## cookies justification

```text
Read and remove session cookies for the declared Microsoft authentication and Microsoft 365 domains during a user-requested full sign-out. Deleting the extension's captured token alone would leave the Microsoft session active and allow silent reauthentication with the same account. Cookie access is used to clear that session, not to capture unrelated cookies or track browsing. A full sign-out can also sign the user out of other Microsoft applications in the same browser profile.
```

## browsingData justification

```text
Clear the authentication caches and site storage of the defined Microsoft origins during a user-requested full sign-out. This includes local storage, IndexedDB, Cache Storage and service workers where supported, so MSAL and Microsoft pages cannot silently restore the old session. Removal is filtered to the relevant Microsoft origins or hostnames. The extension does not request deletion of the browser's global HTTP cache or unrelated websites' storage.
```

## Host permission justification

```text
Microsoft host permissions let the packaged content scripts capture the existing Copilot authentication profile and let the sign-out feature remove session cookies and site storage on the declared Microsoft authentication and Microsoft 365 domains. Domain wildcards cover session cookies shared across Microsoft subdomains. Access to http://localhost/* is used only for the companion VS Code server at http://localhost:51827, for profile synchronization, health checks and sign-out coordination. Chrome host match patterns cannot restrict access to a specific port. The extension does not request access to arbitrary websites.
```

## Remote code

Select **No, I am not using remote code**. Microsoft web requests and communication with the local VS Code server are not downloaded executable extension code.

If the dashboard still requires an explanatory text field, use:

```text
The extension does not download or execute remotely hosted code. Its background worker, content scripts, interceptor and popup JavaScript are included in the submitted package. HTTP requests exchange authentication profiles, status data and sign-out results with the local VS Code server. Microsoft sign-in and sign-out take place on Microsoft's websites. Received data and captured chat templates are handled as data, not evaluated as executable JavaScript.
```

## Data usage disclosures

Do not select "no user data" or "no data handling". Google requires disclosure even when data is processed locally or sent only to a native application on the same computer.

For the current implementation, disclose these categories using the dashboard's corresponding labels:

| Category | What the extension handles |
| --- | --- |
| Personally identifiable information | Account and tenant identifiers and, when present, the account name or email carried in the captured authentication profile. |
| Authentication information | Copilot access tokens, decoded token claims and Microsoft session cookies handled during sign-out. |
| Personal communications | The captured chat invocation template can contain the message sent to Copilot. |
| Web history | Microsoft page origins, Copilot service URLs and tab URLs inspected to find the relevant Microsoft session. This is not a request for the browser's history API. |
| User activity | Copilot-related network requests, outgoing chat invocations, capture timestamps and observed model selections; not general click or keystroke logging. |
| Website content | The captured Copilot invocation payload and any content included in that request template. |

These categories describe the existing capture behavior, not additional data collection. Do not claim that only an anonymous token is handled or that the browser extension encrypts its own local storage. Do not select unrelated categories solely because they appear in the form.

The captured profile is stored in browser extension storage and Microsoft page storage and is sent to the local VS Code companion. The browser extension has no developer-operated collection endpoint or advertising analytics. The Microsoft websites and the VS Code companion perform their own service requests.

## Privacy policy URL

After deploying the Hugo website, use:

https://cristiancastineiras.github.io/M365CopilotVSCode/privacy/

The source is `extensiones/web/content/privacy/index.en.md`. Confirm that the public URL loads before submitting the form. If Pages uses a custom domain or another base path, use that site's actual `/privacy/` URL instead.

## Publisher certification and saving

Review every certification statement in the dashboard and check it only if it accurately describes your use of data. The implementation uses captured data for the disclosed authentication connection, not for sale, unrelated purposes, targeted advertising, creditworthiness or lending decisions. The publisher must also ensure that their actual operations and support practices respect those limits.

The final developer-program-policy certification must be completed by the publisher. This document and the passing tests are not a legal review, a security audit or a guarantee of Chrome Web Store approval.

Click **Save draft**, then recheck the publishing errors. Uploading the ZIP or updating the store description does not automatically fill these dashboard fields or accept the certification.

## Official references

- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq