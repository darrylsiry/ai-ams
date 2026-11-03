# Inbound email: forward an email, get a task

Any email forwarded or copied to the AMS becomes one task in the right person's queue, with the email
and its attachments filed on the client. This is how an account manager works from Outlook or Gmail
without retyping anything.

## Addresses

| Address | Lands with |
|---|---|
| `<alias>@INBOUND_EMAIL_DOMAIN` (e.g. `mrivera@amsinbox.siryous.app`) | that person. Each user's alias is on Admin > Users. |
| `service@`, `inbox@`, `ams@`, `intake@` | the matched client's account manager, or the triage list when no client matches |
| any address, sent by a staff member | the staff member who forwarded it |
| `you+<alias>@...` | the alias after the `+` (handy behind a catch-all) |

## What happens to each email

1. **Route.** The envelope recipient is checked first, then To and Cc, then who forwarded it.
2. **Unwrap the forward.** For a forwarded email, the original sender, subject and body are recovered.
3. **Match the client.** The strongest evidence wins: a policy number in the text, then the sender as a known contact, then the sender's company domain, then a client name in the subject or opening lines.
4. **Classify.** Claude reads the email when `ANTHROPIC_API_KEY` is set; keyword rules decide otherwise. The result is an activity code such as certificate request, endorsement, billing question, claim notice, cancellation request or non-payment notice. That code sets the task's priority, due date and checklist.
5. **Create the task.** It goes to the person routed to. When the client match is weak or the code is the generic "email received", the email also waits in Inbox > Needs triage.

The webhook is idempotent on Message-ID, so a provider retrying a delivery does not create a second task.

## Connect a mail provider

Every option posts to one endpoint and authenticates with `INBOUND_EMAIL_TOKEN`:

```
POST https://<your-app>/api/inbound/email
```

The token can travel as an `X-Inbound-Token` header, a Bearer token, or the password of a Basic-auth
URL. `?token=` also works, for providers that can't send a header; a URL ends up in logs, so rotate the
token if those logs are shared. Bodies over 30 MB get a 413, and only the first 20 attachments are kept.

The From header proves nothing by itself, and anyone can write authentication headers into a message. So
the app only believes results it can tie to your provider. **Until one of these is set, no sender counts
as verified:**

- `INBOUND_AUTHSERV_ID`: the server name your provider puts first in its own `Authentication-Results`
  header. Send yourself a test message and read that header to get it. The first header with that name is
  the one used; any other is ignored.
- `INBOUND_TRUST_RECEIVED_SPF=1`: only for a provider that always adds its own `Received-SPF` on top of the
  message. Confirm this on a real message first.

SendGrid's `dkim` field and Mailgun's check results are read directly. A relay posting generic JSON passes
on what it was told, as `authenticationResults` (the header's text) or `senderVerified: true`.

Until then every sender is unverified. A client's address on an unverified email is only a claim: the email waits in
the inbox for review, its task carries a warning, and its attachments stay off the client's file until someone confirms
the client. Mail claiming to be from staff without that goes to the shared inbox for triage and is labelled unverified,
as is anything forwarded from outside the agency. When an unverified sender or a message's text is all that
ties an email to a client, its attachments stay on the email until someone confirms the client in the Inbox.

The webhook token, on Fly:

```bash
fly ssh console -a siryous-ams -C 'printenv INBOUND_EMAIL_TOKEN'
```

Point the MX record of the inbound domain (e.g. `amsinbox.siryous.app`) at the provider you choose.
Use a subdomain so the agency's normal mail is untouched.

### Postmark (JSON)

1. Create an inbound stream and add the inbound domain, or use Postmark's own inbound address.
2. Set the webhook URL to `https://ams:<INBOUND_EMAIL_TOKEN>@siryous-ams.fly.dev/api/inbound/email`.
3. Turn on "Include raw email content" only if you want it. The app reads Postmark's JSON fields, attachments included, and routes by `OriginalRecipient`.
4. Postmark's sample webhook carries `Received-SPF` and no `Authentication-Results`. So confirm on a real message that Postmark's own header comes first, then set `INBOUND_TRUST_RECEIVED_SPF=1` instead of `INBOUND_AUTHSERV_ID`.

### Mailgun (form post)

Create a route that matches the inbound domain, with the action "forward" to
`https://siryous-ams.fly.dev/api/inbound/email?token=<INBOUND_EMAIL_TOKEN>`. Mailgun posts form fields
and attachments. The app routes by the `recipient` field.

### SendGrid Inbound Parse (form post)

Add the host and URL `https://siryous-ams.fly.dev/api/inbound/email?token=<INBOUND_EMAIL_TOKEN>`.
Ticking "POST the raw, full MIME message" gives the most faithful result. The app routes by the
`envelope` field.

### Cloudflare Email Routing (Email Worker)

Free when the domain is already on Cloudflare. Create a Worker, set the secrets `AMS_WEBHOOK` and
`INBOUND_EMAIL_TOKEN`, and route the inbound domain's catch-all to it:

```js
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    const res = await fetch(env.AMS_WEBHOOK, {
      method: "POST",
      headers: {
        "Content-Type": "message/rfc822",
        "X-Inbound-Token": env.INBOUND_EMAIL_TOKEN,
        "X-Envelope-To": message.to,   // the alias it was sent to, for auto-forwarded mail
      },
      body: raw,
    });
    if (!res.ok) message.setReject(`AMS could not accept this message (${res.status})`);
  },
};
```

### Anything else

Post the raw RFC 822 message with `Content-Type: message/rfc822`. Pass the envelope recipient in an
`X-Envelope-To` header if the relay knows it. A generic JSON body also works:
`{ from, to, cc, subject, text, html, messageId, envelopeTo, attachments: [{ filename, contentType, content(base64) }] }`.

## Auto-forward rules

An Outlook or Gmail rule that forwards client mail keeps the original To header. The app still routes
it, as long as the provider reports the envelope recipient. Postmark, Mailgun, SendGrid and the Worker
above all do. Without it the email falls back to the matched client's account manager.

## Try it

From the app: Inbox > Simulate sends a sample through the same pipeline.

From a terminal, with the dev server running:

```bash
scripts/send-test-email.sh
```

Against Fly:

```bash
AMS_URL=https://siryous-ams.fly.dev INBOUND_EMAIL_TOKEN=<token> scripts/send-test-email.sh
```

Pass a saved `.eml` file to post a real message instead.

## Sending mail from the AMS

Replies and certificate deliveries are emailed once `SMTP_URL` is set, and only logged until then. Mail
goes out from the sender's alias on `INBOUND_EMAIL_DOMAIN`, so that domain must be verified with the
provider. For Postmark: `smtp://<server token>:<server token>@smtp.postmarkapp.com:587`. A client's reply
arrives as a new email and a new task. Renewal reissues are not emailed automatically.

Mailbox sync (reading a user's whole inbox over Microsoft Graph
or Gmail) is on Admin > Roadmap.
