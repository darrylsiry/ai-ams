import nodemailer from "nodemailer";

// Outbound email (WRK-25O), over the SMTP server in SMTP_URL. For Postmark:
//   smtp://<server token>:<server token>@smtp.postmarkapp.com:587
// Mail goes out from the sender's own alias on INBOUND_EMAIL_DOMAIN, so a reply comes back through
// intake. Without SMTP_URL nothing is sent, and the callers say the action was only logged.

export type Sender = { full_name: string; inbox_alias: string };
export type OutboundEmail = {
  from: Sender;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string | null;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
};

export const emailEnabled = () => !!process.env.SMTP_URL?.trim();

/** One plain address. Typed addresses go through this, so a comma can't add a second recipient. */
export const isEmailAddress = (s: string) => /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(s);

/** The address replies come back to. Throws when the domain isn't configured. */
export function senderAddress(u: Sender) {
  const domain = process.env.INBOUND_EMAIL_DOMAIN?.trim();
  if (!domain) throw new Error("INBOUND_EMAIL_DOMAIN is not set");
  return { name: u.full_name, address: `${u.inbox_alias}@${domain}` };
}

/** Hand one message to the SMTP server and return its Message-ID. Throws when it isn't accepted. */
export async function sendEmail(m: OutboundEmail): Promise<string> {
  const url = process.env.SMTP_URL?.trim();
  if (!url) throw new Error("SMTP_URL is not set");
  const local = ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
  // Credentials and client data never cross the network in the clear, except to a local test server.
  const transport = nodemailer.createTransport({ url, requireTLS: !local, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 } as Parameters<typeof nodemailer.createTransport>[0]);
  try {
    const info = await transport.sendMail({
      from: senderAddress(m.from), to: m.to, subject: m.subject, text: m.text, attachments: m.attachments,
      ...(m.inReplyTo ? { inReplyTo: m.inReplyTo, references: m.inReplyTo } : {}),
      disableFileAccess: true, disableUrlAccess: true,
    });
    if (info.rejected.length) throw new Error("The mail server refused the recipient");
    return info.messageId;
  } finally {
    transport.close();
  }
}

export type Notice = { to: string; replyTo?: { name: string; address: string }; subject: string; text: string };
export type NoticeResult = { sent: true; id: string } | { sent: false; reason: string };

/** Who the app's own notices come from: MAIL_FROM, or the app at the inbound domain. */
export function noticeSender(env: Record<string, string | undefined> = process.env): string {
  return env.MAIL_FROM?.trim() || `siryous AMS <access@${env.INBOUND_EMAIL_DOMAIN?.trim() || "localhost"}>`;
}

type Transport = { sendMail(m: Record<string, unknown>): Promise<{ messageId: string; rejected?: unknown[] }>; close?(): void };

/**
 * A notice from the app itself, such as an access request to the owner. Never throws: the caller has
 * already kept what matters, and only records whether this went out. The reason never carries the
 * SMTP password, and the timeouts keep a public form from waiting long on a dead server.
 */
export async function sendNotice(n: Notice, env: Record<string, string | undefined> = process.env, open: (o: Record<string, unknown>) => Transport = (o) => nodemailer.createTransport(o as Parameters<typeof nodemailer.createTransport>[0]) as unknown as Transport): Promise<NoticeResult> {
  const url = env.SMTP_URL?.trim();
  if (!url) return { sent: false, reason: "Email isn't set up: SMTP_URL is not configured" };
  let transport: Transport | undefined;
  try {
    const local = ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
    transport = open({ url, requireTLS: !local, connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 15_000 });
    const info = await transport.sendMail({ from: noticeSender(env), to: n.to, replyTo: n.replyTo, subject: n.subject, text: n.text, disableFileAccess: true, disableUrlAccess: true });
    if (info.rejected?.length) return { sent: false, reason: "The mail server refused the address" };
    return { sent: true, id: info.messageId };
  } catch (err) {
    return { sent: false, reason: String((err as Error).message ?? err).replace(/\/\/[^@\s/]+@/g, "//***@").slice(0, 200) };
  } finally {
    transport?.close?.();
  }
}

