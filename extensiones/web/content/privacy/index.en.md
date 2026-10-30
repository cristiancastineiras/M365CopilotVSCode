---
title: "Browser extension privacy policy"
linkTitle: "Privacy policy"
heading: "Browser extension privacy policy"
description: "How the M365 Copilot browser extension handles authentication profiles, chat request templates and Microsoft session data."
---

Last updated: October 30, 2026.

## Scope and purpose

This policy covers the M365 Copilot browser extension maintained in the [M365CopilotVSCode project](https://github.com/cristiancastineiras/M365CopilotVSCode). It connects an existing Microsoft 365 Copilot web session to the companion extension for Visual Studio Code. It is an independent project, not a Microsoft product.

This policy describes the browser extension. Microsoft services, the VS Code companion and this website's analytics have their own behavior and settings. The website identifies its analytics separately in the footer.

## Data the extension handles

To provide the connection, the extension can capture and store:

- The Microsoft 365 Copilot access token and decoded token claims, including account and tenant identifiers and, when present, the account name or email.
- The Copilot service endpoint, the Microsoft page origin, the browser user agent, capture timestamps and model selections observed in outgoing chat requests.
- A captured chat invocation template. This is not just a token: the template can contain the message sent to Copilot and other content included in that request.
- Token expiry, renewal attempts, connection status, synchronization timestamps and error information needed to display and maintain the connection.

The extension observes Copilot WebSocket traffic, authorization headers and Microsoft authentication cache entries on its configured Microsoft pages. It inspects tab URLs to find relevant Microsoft pages. It does not build a general browsing-history database or log general clicks or keystrokes.

During a requested full sign-out, it also reads and removes session cookies and site storage for the configured Microsoft authentication and Microsoft 365 domains. It does not ask users to give the extension their Microsoft password.

## How data is used and transferred

Captured data is used to connect the Microsoft 365 Copilot session to VS Code, display status, retry synchronization and renew the token. The profile is sent to the companion server on the same computer at `http://localhost:51827/token`. Related local endpoints provide health checks and coordinate sign-out.

Captured profiles are stored in the extension's local browser storage and in a capture store on the relevant Microsoft page. The browser extension does not upload those profiles to a developer-operated server and does not include advertising or developer analytics. Microsoft pages continue communicating with Microsoft, and the VS Code companion can use the received credential to contact Microsoft services.

The popup's **Copy token** action places the credential on the clipboard only when requested. Clipboard history and other applications may retain or access that copy. Users should not paste it into public issues, shared documents or support conversations.

## Limited use

The extension's use and transfer of user data are limited to its disclosed, user-facing authentication connection, token renewal and requested sign-out, in accordance with the Chrome Web Store User Data Policy's Limited Use requirements. Captured data is not sold, used for targeted advertising, used for unrelated profiling, or used to determine creditworthiness or make lending decisions.

The browser extension does not provide a developer-operated service for people to inspect captured profiles or chat messages. Users must not submit tokens, cookies or private messages in public support reports.

## Storage, retention and security limits

The captured profile and operational state can persist until replaced, cleared during full sign-out, or deleted through the browser's storage controls. Some expired tokens are pruned from the page capture store, but expiration must not be treated as deletion of every stored copy. No fixed automatic deletion period is promised for the complete profile or chat template.

Browser storage relies on browser and operating-system protections; the extension does not add its own encryption layer to that storage. Communication with the same-computer VS Code server uses local HTTP, not HTTPS. This server must not be exposed to other computers or public networks. No independent security audit or certification is claimed.

## Deletion and full sign-out

Use the extension's Microsoft sign-out action to clear the captured profile and request removal of the configured Microsoft session cookies and site storage. The companion extension can request the same operation. Full sign-out may close Microsoft tabs, sign the user out of Office, Outlook, Teams or other Microsoft applications in the same browser profile, and remove their local site data. Save pending work and review the confirmation first.

Uninstalling the browser extension does not guarantee deletion of data in Microsoft website storage, the VS Code companion, clipboard history or backups. Clear those locations separately when required. For Microsoft account-level session revocation or deletion, use Microsoft's or your organization's account controls.

## Changes and contact

This policy may be updated when the extension's behavior changes. The current version and its history are available in the project repository.

For privacy questions, contact the maintainer through the [project's issue tracker](https://github.com/cristiancastineiras/M365CopilotVSCode/issues), without posting credentials, private messages or personal account details. For sensitive security reports, follow the repository's [security policy](https://github.com/cristiancastineiras/M365CopilotVSCode/blob/main/SECURITY.md).