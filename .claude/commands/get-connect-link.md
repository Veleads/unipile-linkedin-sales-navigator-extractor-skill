---
description: Start the tunneled Unipile connect hook and get a WhatsApp-ready link, or mint one direct wizard URL
argument-hint: "[name | direct]"
---

Get a Unipile **connect account** link for **$ARGUMENTS**.

Do not curl Unipile. Do not print API keys or the `CONNECT_HOOK_TOKEN` value.

## Tunneled link (default)

If `$ARGUMENTS` is empty or is a person's name/label (not `direct`):

From the project root:

```bash
npm run connect
```

If a name/label was given:

```bash
npm run connect -- --label "<label>"
```

**Long-lived — run it in the background** and wait for the `Share:` line. First run downloads cloudflared into `.cache/`, which is expected.

Then report:

- The `Share:` URL
- The `WhatsApp:` block verbatim
- That the link is live only while the process runs, and the hostname changes on restart

Leave it running. When someone completes the wizard it prints `OK <name> connected - account_id <id>` — relay that.

## Direct one-shot URL

If `$ARGUMENTS` is `direct`, or the user wants a single URL with no running process:

```bash
npm run connect -- --direct
```

Print the wizard URL and the WhatsApp message. Say that it is single-use and that Unipile expires hosted-auth URLs on its daily restart, so it should be sent immediately and not forwarded to a second person.
