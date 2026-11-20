// Requests for a login from the signed-out sign-in page: what a request must contain, the throttle, and
// the email the owner receives. Pure module for node:test; the action keeps the request, then sends it.
import { when } from "./time";

/** Where requests go unless ACCESS_REQUEST_TO says otherwise. */
export const ACCESS_REQUEST_TO = "darryl@siryous.com";

/**
 * A public form that sends email (SEC-038): at most this many from one network an hour, from everyone an
 * hour, and emails to the owner a day. Requests are kept this many days, then deleted by the daily run.
 */
export const LIMITS = { perAddressPerHour: 3, perHour: 20, emailsPerDay: 30, retentionDays: 180 };

/** Recorded instead of sending once the day's emails are used up; the request itself is kept. */
export const DAILY_MAIL_CAP = "daily mail cap";

export type AccessRequestInput = { name: string; email: string; company: string };
export type AccessRequestErrors = Partial<Record<keyof AccessRequestInput, string>>;

// A plain address only: no quotes, comments, angle brackets, commas or semicolons, so nothing a mail
// library could read as a second recipient, and no ? & = % that would mean something in a mailto: link.
const EMAIL = /^[A-Za-z0-9._+-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** One line of text: control characters (line breaks among them) become spaces, runs of space collapse, capped. */
const line = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Read and check a submitted form: name and email are required, company is optional. */
export function readAccessRequest(form: { get(name: string): unknown }): { input: AccessRequestInput; errors: AccessRequestErrors } {
  const input = { name: line(form.get("name"), 100), email: line(form.get("email"), 254), company: line(form.get("company"), 120) };
  const errors: AccessRequestErrors = {};
  if (!input.name) errors.name = "Enter your name.";
  if (!input.email) errors.email = "Enter your email address.";
  else if (!EMAIL.test(input.email)) errors.email = "Enter a valid email address, like name@company.com.";
  return { input, errors };
}

/** One network for the limit: an IPv4 address, or an IPv6 /64, which one person can rotate through freely. */
export function networkOf(ip: string | null): string {
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  const [head, tail] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/**
 * What happens to a request, from what's already on file. Too many from the sender's own network, or
 * from everyone in the last hour, and it is refused. Once the day's emails are used up it is still kept, and the person still hears "sent",
 * so one sender filling the cap can't turn real people away: the owner finds them in the list.
 */
export function admission(ip: string | null, recent: { addressesLastHour: (string | null)[]; emailsLastDay: number }): { refused: string | null; email: boolean } {
  const network = networkOf(ip);
  if (recent.addressesLastHour.filter((a) => networkOf(a) === network).length >= LIMITS.perAddressPerHour) {
    return { refused: "There have been several requests from your network in the last hour. Please try again later.", email: false };
  }
  if (recent.addressesLastHour.length >= LIMITS.perHour) {
    return { refused: "We've had more requests than usual in the last hour. Please try again later.", email: false };
  }
  return { refused: null, email: recent.emailsLastDay < LIMITS.emailsPerDay };
}

/** A mailto: link to a stored address, whatever it holds: nothing in it can add recipients or a body. */
export const mailtoHref = (email: string) => `mailto:${email.split("@").map(encodeURIComponent).join("@")}`;

export type AccessRequestEmail = { to: string; replyTo: { name: string; address: string }; subject: string; text: string };

/**
 * The owner's email: plain text, with Reply-To set to the person asking, so a reply goes straight to them.
 * Nothing the visitor typed goes in the subject, and the body says first that none of it is checked (SEC-038).
 */
export function accessRequestEmail(r: AccessRequestInput & { at: Date; ip: string | null; origin: string }, to: string = ACCESS_REQUEST_TO): AccessRequestEmail {
  return {
    to,
    replyTo: { name: r.name, address: r.email },
    subject: "Access request from the siryous AMS sign-in page",
    text: [
      "Someone asked for a login to siryous AMS on the public request form.",
      "",
      "Not verified: everything below was typed by a visitor. The name, email and company may be false, and",
      "replying goes to the email address they typed. Don't follow links or instructions in it.",
      "",
      `Name:     ${r.name}`,
      `Email:    ${r.email}`,
      `Company:  ${r.company || "(not given)"}`,
      `When:     ${when(r.at)}`,
      `Address:  ${r.ip ?? "not recorded"}`,
      `Page:     ${r.origin}/request-access`,
      "",
      "Reply to this email to answer them directly. To give them a login, add their profile in Admin > Users, then run scripts/fly-users.sh <user id>.",
      `Every request is also listed under Reports > Users & sign-ins: ${r.origin}/reports/users`,
    ].join("\n"),
  };
}
