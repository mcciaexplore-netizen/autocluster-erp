/**
 * npm run users:create-admin
 * Creates the first Admin for real use. Asks in the terminal for the name, email and a password
 * (hidden while typing). The password is handed straight to Better Auth, which stores it hashed;
 * it is never printed or written anywhere else.
 */
import { createInterface } from "node:readline";
import { createAuth } from "../lib/auth/better-auth";
import { passwordProblem } from "../lib/auth/password-rules";
import { ensureDefaultRoles, setUserRoles } from "../db/role-writer";
import { createSignInUser, ensureAppUsersForTeam } from "../db/user-writer";
import { scriptDb } from "./demo-data";

const lines: string[] = [];
let waiting: ((l: string) => void) | null = null;
const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (l) => (waiting ? (waiting(l), (waiting = null)) : lines.push(l)));

function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  const tty = process.stdin.isTTY;
  if (hidden && tty) process.stdin.setRawMode?.(true);
  return new Promise((resolve) => {
    if (hidden && tty) {
      // Read key by key so nothing is shown on screen.
      rl.pause();
      let typed = "";
      const onData = (buf: Buffer) => {
        for (const ch of buf.toString("utf8")) {
          if (ch === "\r" || ch === "\n") {
            process.stdin.setRawMode?.(false);
            process.stdin.off("data", onData);
            process.stdout.write("\n");
            rl.resume();
            return resolve(typed);
          }
          if (ch === "\u0003") process.exit(1); // Ctrl+C
          if (ch === "\u007f" || ch === "\b") typed = typed.slice(0, -1);
          else typed += ch;
        }
      };
      process.stdin.on("data", onData);
      return;
    }
    const l = lines.shift();
    if (l !== undefined) {
      if (hidden) process.stdout.write("\n");
      return resolve(l.trim() === "" && !hidden ? "" : hidden ? l : l.trim());
    }
    waiting = (x) => {
      if (hidden) process.stdout.write("\n");
      resolve(hidden ? x : x.trim());
    };
  });
}

async function main() {
  const { db, pool, where } = scriptDb();
  try {
    console.log(`\nCreate an Admin in ${where}.\n`);
    const name = await ask("Full name: ");
    const email = (await ask("Email: ")).toLowerCase();
    let password = "";
    for (;;) {
      password = await ask("Password (hidden): ", true);
      const problem = passwordProblem(password, { name, email });
      if (problem) {
        console.log(problem);
        continue;
      }
      if ((await ask("Type it again (hidden): ", true)) !== password) {
        console.log("The two passwords don't match. Please try again.");
        continue;
      }
      break;
    }
    const auth = createAuth(db);
    await ensureAppUsersForTeam(db);
    const roles = await ensureDefaultRoles(db);
    const u = await createSignInUser(db, auth, { name, email, password });
    await setUserRoles(db, u.id, [roles.Admin]);
    console.log(`\nDone. ${name} can now sign in as Admin with ${email}.`);
  } finally {
    rl.close();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
