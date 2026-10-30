# M365 Copilot for VS Code: connect from Chrome

Connect your Microsoft 365 Copilot web session to the M365 Copilot extension for Visual Studio Code. This Chrome extension captures the token used by your browser session and syncs it with VS Code so you do not have to copy and paste it manually.

Its purpose is specific: to maintain the authentication link between the browser and the editor. It is not a standalone chat, does not replace Microsoft 365 Copilot, and does not include an account, a subscription, or additional permissions for Microsoft services. You need a valid session and access to the features you want to use.

## What it is for

If you use the M365 Copilot extension for VS Code, the browser is where you sign in to Microsoft and where the web application obtains its credentials. This extension makes it easier to transfer the token to the editor and manages renewal attempts as it approaches expiration.

Instead of looking for a credential and repeating a manual operation every time it changes, you can check its status in the Chrome popup. The popup shows the available token, the connection to VS Code, and renewal separately. This helps you identify whether you need to sign in, open the editor, or restore the local connection.

The extension is designed to support your work in the editor, not to add another chat interface to the browser. Any chat and coding features provided by the VS Code extension belong to that component and depend on its configuration.

## What you need

- Chrome with this extension installed and enabled.
- The M365 Copilot extension for VS Code installed in the editor.
- Access to Microsoft 365 Copilot with the account you intend to use.
- A valid Microsoft session in the Chrome profile where you installed the extension.
- A browser that can communicate with the VS Code extension's local server.

Installing the extension does not grant access to services that are not enabled for your account. If your organization requires a license, additional verification, or specific access conditions, you must also meet those requirements when using this connection.

The connection described here uses localhost. Do not assume that a browser on one computer and an editor on another can communicate through this setup. Remote environments, containers, and restricted desktop sessions may require checking where each component runs.

## Getting started

1. Install and enable the M365 Copilot extension for VS Code.
2. Open the editor and check that the extension is active.
3. In Chrome, go to https://m365.cloud.microsoft/chat/.
4. Sign in with the account you want to use and send a message.
5. Open this extension's popup to check the token and connection.
6. If the token is available but has not been sent yet, use the corresponding action in the popup.

Sending a message on the website allows the application to make the requests in which the token can be detected. Simply having a tab open does not necessarily mean that a valid credential has already been captured.

If you open VS Code after the browser, the extension can send the token again when it detects that the editor is available. An initial disconnection does not necessarily mean a permanent failure: first check that both components are open and active.

## How token capture works

The extension works with the session already used by the web application. Token capture uses the WebSocket URL, request headers, and the MSAL authentication cache. These mechanisms allow it to detect the token used by the website without you having to extract it manually.

Token capture does not replace signing in. If Microsoft asks you to enter your credentials, confirm your identity, or complete an organizational check, you must do so on the relevant page. The extension cannot guarantee silent renewal when the service requires your involvement.

In addition to the Microsoft 365 Copilot page, the project includes Office, Outlook, and Teams pages in its Microsoft session integration. This does not make the extension a general-purpose tool for managing those services or imply that any open page will produce a usable token.

A token is an access credential. Although it is not your password, you must treat it as sensitive information. Do not publish it in issues, screenshots, shared conversations, or repository files.

## Syncing with the editor

The background process sends the token to the VS Code extension's local server. The address used for this delivery is http://localhost:51827/token.

This communication connects two components: the browser extension and the editor extension. A working web session does not, by itself, prove that the editor is ready to receive the token. Likewise, having VS Code open does not guarantee that its extension is active or that the local server is available.

If the editor is not ready yet, the extension supports sending the token again later. You can check the status in the popup and use the send action when it is available, without signing out of Microsoft as your first troubleshooting step.

Localhost identifies the computer from which the connection is made. It is not a support address or a public service to which you should send credentials from another device. Avoid changing this setup or exposing the port to other networks without understanding the consequences.

## What the popup shows

The popup brings together the token status, the connection to VS Code, and renewal. An illustration represents the link between Microsoft 365 and the editor, while the text and actions indicate the next available step.

The interface is available in English and Spanish based on your browser language. The extension's name and description are also translated through the browser's localization system.

The primary action changes depending on the situation. It may offer to open Microsoft 365 Copilot, renew the token, or send it to VS Code. There is also an action to copy the token when you need to perform a manual operation.

Read each status separately:

- The token status indicates whether a credential is available and helps you assess whether it is still valid.
- The connection status indicates whether the extension can communicate with VS Code.
- The renewal status helps you identify whether a credential recovery attempt is underway or whether you need to intervene.

Do not treat an animation as a guarantee that every operation has finished. Check the popup messages and, if the editor still does not work, also check the status of its own extension.

## Token renewal

Tokens have a limited lifetime. The extension attempts to renew them approximately twelve minutes before they expire to reduce interruptions while using the editor. This margin determines when to act; it does not extend the permissions or lifetime set by Microsoft.

Renewal follows a sequence: first, it requests a credential from the Microsoft 365 tab; it may then reload that tab and, if no tab is available, open one in the background. This is why you may notice browser activity even while working in VS Code.

Attempts use progressively longer delays when they fail to recover the token. This does not mean requests are repeated indefinitely or that an expired session is guaranteed to recover automatically. If signing in is required, the extension displays a red indicator.

Renewal depends on Chrome being able to run the extension and on the web session remaining valid. Closing the browser, putting the computer to sleep, losing the connection, or having an identity check pending may prevent the process from finishing when expected.

When you return to your computer, check the popup before assuming that the token is still valid. If your involvement is required, open Microsoft 365 Copilot and complete the sign-in process. Then check that the new token reaches the editor.

## Available actions

### Open Microsoft 365 Copilot

This action takes you to the web application to sign in or generate the activity needed to capture a credential. Use it when no token is available yet or when the browser needs to restore a valid session.

Check the account shown on the website before continuing. In a browser with multiple Microsoft sessions, having access to an application does not necessarily mean you are using the identity you want to connect to the editor.

### Renew now

Requests a renewal attempt without waiting for the next scheduled time. This is useful when the token is about to expire or when you have just restored the web session after an interruption.

This action does not bypass the service's authentication requirements. If a sign-in screen, confirmation request, or organizational notice appears, resolve it on the website before checking the status again.

### Send to VS Code

Sends the available credential to the editor's local component. This can help when you opened VS Code after Chrome or when capture has finished but the connection to the editor still needs to be restored.

If sending fails, first check that VS Code is open and that its extension is active. Sending repeatedly does not, by itself, fix a stopped local server, a communication restriction, or a credential that has already expired.

### Copy token

Provides a manual alternative for situations where you need to copy the credential. Use it only if you know the destination and understand why it is necessary. Automatic syncing avoids the need to use the clipboard during normal operation.

The clipboard may be accessible to other applications or included in a clipboard history. Do not paste the token into search engines, support forms, shared documents, or conversations. Also avoid accidentally including it in a screenshot.

## Permissions and their purpose

The extension needs permissions related to its role as a link between the web session and the editor. These permissions are not equivalent to a Microsoft 365 license and do not grant additional rights over your organization's data.

- Storage: retain the state and data needed for the extension to operate.
- Tabs: locate and manage the pages used for capture, renewal, and sign-out.
- Alarms: schedule checks and renewal attempts.
- Cookies: manage cookies for the relevant domains during a full sign-out.
- Browsing data: remove storage for the relevant origins during that sign-out.
- Access to Microsoft domains: allow integration with the pages where the session is used.
- Access to localhost: deliver the token to the VS Code extension's local server.

Review the permissions Chrome displays when installing or updating the extension. If you use a managed browser, your organization's policies may prevent installation, limit execution, or restrict communication with local services.

Do not disable corporate controls to make it work. Consult the person responsible for your environment if you are unsure whether connecting the web session to an editor tool is permitted.

## Signing out of Microsoft

A full sign-out is different from closing the popup, stopping the editor, or closing a tab. It is designed to remove the items that maintain the Microsoft session in the browser and requires confirmation.

The process uses sign-out endpoints, closes other Microsoft tabs, and removes cookies and storage for the relevant domains. The order matters because a page that remains open could write authentication data again.

This operation may affect other Microsoft applications open in the same Chrome profile. You may need to sign in again to services such as Outlook, Teams, or Office. Save any pending work first and review the confirmation prompt.

Do not use a full sign-out as your first step when troubleshooting a connection problem with VS Code. If the token exists and the website works, first check the editor and the local connection. Deleting a valid session may add steps without resolving the original cause.

Signing out does not uninstall the browser extension or the editor extension. It should not be confused with revoking all of an account's sessions across all its devices. To manage account security, use the options provided by Microsoft or your organization.

## Responsible handling of credentials

The token allows actions within its assigned scope and validity period. Being temporary does not make it public information. Treat it with the same care as any other access credential.

Use the extension on computers and browser profiles you control. On a shared computer, pay attention to which account is connected and who can access the editor, the clipboard, or the profile's storage.

Do not send tokens when asking for help. To describe a problem, it is usually enough to state which status appears, which action fails, and whether the web application works. Also hide email addresses, identifiers, and organizational data when they are not needed.

Delivery to localhost describes the destination used to sync with the editor; it does not mean that Microsoft 365 works offline. Authentication and use of its services still depend on communication with Microsoft.

No guarantees of additional encryption, audits, or certifications are provided. Review the code.

## If no token appears

Check that you have signed in to Microsoft 365 Copilot in the same Chrome profile where the extension is installed. A session open in another browser or profile is not the same session.

Open the web application and send a message to trigger the requests in which the credential can be detected. If the page shows an access error, resolve it there first: the extension cannot create authorization that the account does not have.

Also check that the extension is enabled and allowed to run on the relevant pages. If you have just installed it and the page was already open, reload the page so the integration can start.

## If VS Code appears disconnected

Check that the editor is open and that the M365 Copilot extension for VS Code is installed and active. Then return to the popup and check whether the connection status changes.

If the token is available, use the send action when appropriate. Do not copy the credential to alternative destinations or expose the port to other networks to try to fix a disconnection.

In remote environments, check where the token receiver runs.

## If renewal requires signing in

Open Microsoft 365 Copilot and complete any checks that appear. A password change, an expired session, or an access policy may require interaction that the extension cannot perform for you.

After signing in, check token capture and delivery to the editor.

## If you change accounts

Check the account used in Microsoft 365 Copilot and its synchronization with VS Code.

Wait for a credential from the intended session to be captured and check the sync status. If you decide to use a full sign-out to switch identities, remember that it may affect other Microsoft sessions in the same profile.