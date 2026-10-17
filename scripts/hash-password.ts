/** Prints an ADMIN_PASSWORD_HASH value. Usage: npm run hash-password */
import { createInterface } from "readline";
import { randomBytes, scryptSync } from "crypto";

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question("Admin password (min 12 characters): ", (pw) => {
  rl.close();
  if (pw.length < 12) {
    console.error("Password too short.");
    process.exit(1);
  }
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64);
  console.log(`\nADMIN_PASSWORD_HASH="scrypt:${salt.toString("base64")}:${hash.toString("base64")}"`);
});
