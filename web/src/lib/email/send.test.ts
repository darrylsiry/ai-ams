import assert from "node:assert/strict";
import net from "node:net";
import { after, before, test } from "node:test";
import { emailEnabled, isEmailAddress, sendEmail } from "./send";

// A minimal SMTP server on localhost: enough to see what the app hands over, and to refuse a recipient.
const received: string[] = [];
const server = net.createServer((sock) => {
  let inData = false, buf = "";
  sock.write("220 test\r\n");
  sock.on("data", (d) => {
    buf += d.toString();
    if (inData) {
      if (!buf.endsWith("\r\n.\r\n")) return;
      received.push(buf); buf = ""; inData = false; sock.write("250 OK\r\n");
      return;
    }
    let i: number;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^RCPT TO:.*refused/i.test(line)) sock.write("550 no\r\n");
      else if (/^DATA/i.test(line)) { inData = true; sock.write("354 go\r\n"); return; }
      else if (/^QUIT/i.test(line)) { sock.write("221 bye\r\n"); sock.end(); }
      else sock.write("250 OK\r\n");
    }
  });
  sock.on("error", () => {});
});
const me = { full_name: "Marisol Rivera", inbox_alias: "mrivera" };

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.SMTP_URL = `smtp://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  process.env.INBOUND_EMAIL_DOMAIN = "amsinbox.example";
});
after(() => { server.close(); delete process.env.SMTP_URL; });

test("WRK-25O: a reply goes out from the sender's alias, threaded on the original", async () => {
  const id = await sendEmail({ from: me, to: "pat@client.example", subject: "Re: Need a COI", text: "On it.", inReplyTo: "<orig@mail.example>" });
  assert.match(id, /^<.+>$/);
  const m = received.at(-1)!;
  assert.match(m, /^From: Marisol Rivera <mrivera@amsinbox\.example>/m);
  assert.match(m, /^To: pat@client\.example/m);
  assert.match(m, /^In-Reply-To: <orig@mail\.example>/m);
  assert.match(m, /On it\./);
});

test("WRK-25O: an attachment is carried", async () => {
  await sendEmail({ from: me, to: "risk@holder.example", subject: "COI", text: "Attached.", attachments: [{ filename: "COI-1.pdf", content: Buffer.from("%PDF-1.4"), contentType: "application/pdf" }] });
  assert.match(received.at(-1)!, /filename=COI-1\.pdf/);
});

test("WRK-25O: a refused recipient throws, so callers can't record it as sent", async () => {
  await assert.rejects(sendEmail({ from: me, to: "refused@client.example", subject: "S", text: "T" }));
});

test("WRK-25O: an unreachable server fails", async () => {
  const url = process.env.SMTP_URL;
  process.env.SMTP_URL = "smtp://127.0.0.1:1";
  await assert.rejects(sendEmail({ from: me, to: "a@b.example", subject: "S", text: "T" }));
  process.env.SMTP_URL = url;
});

test("WRK-25O: no SMTP_URL means sending is off and sendEmail refuses", async () => {
  const url = process.env.SMTP_URL;
  delete process.env.SMTP_URL;
  assert.equal(emailEnabled(), false);
  await assert.rejects(sendEmail({ from: me, to: "a@b.example", subject: "S", text: "T" }), /SMTP_URL/);
  process.env.SMTP_URL = url;
  assert.equal(emailEnabled(), true);
});

test("WRK-25O: a typed address is exactly one address", () => {
  assert.equal(isEmailAddress("risk@holder.example"), true);
  for (const bad of ["", "risk", "a@b.example, c@d.example", "a@b.example;c@d.example", "A <a@b.example>", "a b@c.example"]) assert.equal(isEmailAddress(bad), false, bad);
});
