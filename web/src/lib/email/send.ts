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
