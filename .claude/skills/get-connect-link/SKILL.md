---
name: get-connect-link
description: >-
  Generate a fresh Unipile connect-account link to send someone over WhatsApp.
  Use whenever the user wants a connect link, a connect account link, an auth or
  hosted-auth link, a link to add a LinkedIn account or seat, wants to onboard a
  colleague, asks to "send Ali a link to connect his LinkedIn", asks for a
  WhatsApp link so someone can connect their account, or wants to add another
  Sales Navigator seat to the Unipile workspace.
---

# Get a connect-account link

Run the CLI in `C:\Users\zahan\OneDrive\Desktop\work\unipile-lead-extractor`. Do not call Unipile with curl and do not hand-build hosted-auth URLs.

## Inputs

Nothing is required. Optionally:

- A person's name or label, passed as `--label`. It comes back on the webhook, so it is how you tell who connected. Ask for it only if the user is clearly onboarding one named person.
- `--port` if 8787 is taken.

## Run

Default — tunneled link that anyone can open, and that keeps working for repeat visitors:

```bash
npm run connect
```

With a label:

```bash
npm run connect -- --label "ali"
```

**This command is long-lived and never exits on its own.** Run it in the background, then wait for the `Share:` line to appear in its output before reporting anything. Do not run it in the foreground and do not kill it once it is up — the link dies with the process.

First run downloads cloudflared (~35 MB) into `.cache/`. That is expected; it happens once.

Only if the user explicitly wants a single throwaway URL and no running process:

```bash
npm run connect -- --direct
```

## After it finishes starting

Report, in this order:

- The `Share:` URL
- The `WhatsApp:` block verbatim, so the user can paste it straight into the chat
- That the link works only while the process is running, and the hostname changes if it is restarted

Then leave the process running and stay available — when someone completes the wizard, the process prints `OK <name> connected - account_id <id>`. Relay that when it appears.

## Guardrails

- Never print `UNIPILE_API_KEY`, `UNIPILE_DSN`, or the value of `CONNECT_HOOK_TOKEN` into chat.
- The `?t=` token in the share URL is part of the link. Include it when handing over the URL, but do not discuss it as a secret to be pasted separately.
- Do not suggest ngrok, localtunnel, or a manual tunnel. The tunnel is automatic.
- If cloudflared cannot start, fall back to `npm run connect -- --direct` and tell the user that link is single-use.
- `--direct` links expire on Unipile's daily restart and are meant for one person. Say so when you hand one over.
