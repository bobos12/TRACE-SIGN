/**
 * Local mail servers for trying TRACE.SIGN without touching your real mailbox.
 *   npm run mail:dev
 * SMTP 127.0.0.1:2525 (no TLS, AUTH required)   IMAP 127.0.0.1:1143 (no TLS)
 * Login: dev@trace-studio.tech / dev-password
 * Mail sent to trace.sign@trace-studio.tech or dev@trace-studio.tech lands in the IMAP INBOX,
 * like an alias delivering into its parent mailbox. Every message is also saved as .eml/.html
 * in ./.data/dev-mail so you can open the rendered emails in a browser.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { SMTPServer } from "smtp-server";
// @ts-expect-error no type declarations
import hoodiecrow from "hoodiecrow-imap";
import { simpleParser } from "mailparser";

const USER = process.env.DEV_MAIL_USER ?? "dev@trace-studio.tech";
const PASS = process.env.DEV_MAIL_PASS ?? "dev-password";
const ALIAS = process.env.DEV_MAIL_ALIAS ?? "trace.sign@trace-studio.tech";
const REJECT_ALIAS = process.env.DEV_MAIL_REJECT_ALIAS === "1";
const OUT = process.env.DEV_MAIL_DIR ?? "./.data/dev-mail";
mkdirSync(OUT, { recursive: true });
let seq = 0;

const imap = hoodiecrow({ users: { [USER]: { password: PASS } }, plugins: ["UIDPLUS", "ESEARCH"] });
imap.listen(1143, () => console.log(`IMAP  127.0.0.1:1143  user ${USER}`));

const smtp = new SMTPServer({
  secure: false,
  disabledCommands: ["STARTTLS"],
  allowInsecureAuth: true,
  logger: false,
  onAuth(auth, _s, cb) {
    if (auth.username === USER && auth.password === PASS) return cb(null, { user: USER });
    cb(Object.assign(new Error("5.7.8 Authentication credentials invalid"), { responseCode: 535 }));
  },
  onMailFrom(addr, _s, cb) {
    if (REJECT_ALIAS && addr.address === ALIAS) return cb(Object.assign(new Error(`5.7.1 <${ALIAS}>: Sender address rejected: not owned by user ${USER}`), { responseCode: 553 }));
    cb();
  },
  onData(stream, session, cb) {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", async () => {
      const raw = Buffer.concat(chunks);
      const to = session.envelope.rcptTo.map((r) => r.address);
      const p = await simpleParser(raw);
      const base = join(OUT, `${String(++seq).padStart(3, "0")}-${to[0]}`);
      writeFileSync(`${base}.eml`, raw);
      if (p.html) writeFileSync(`${base}.html`, p.html);
      console.log(`SMTP  ${p.from?.text} → ${to.join(", ")}  “${p.subject}”${p.attachments.length ? `  [${p.attachments.length} attachment]` : ""}`);
      if (to.some((a) => a === ALIAS || a === USER)) imap.appendMessage("INBOX", [], new Date(), raw.toString("binary"));
      cb();
    });
  },
});
smtp.listen(2525, "127.0.0.1", () => console.log(`SMTP  127.0.0.1:2525  user ${USER}${REJECT_ALIAS ? "  (refusing alias)" : ""}`));

// Lets the test harness inject replies/bounces: POST raw RFC822 to http://127.0.0.1:1144
import("http").then(({ createServer }) =>
  createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      imap.appendMessage("INBOX", [], new Date(), body);
      res.end("ok");
    });
  }).listen(1144, "127.0.0.1"),
);
