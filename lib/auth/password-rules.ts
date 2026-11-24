/** Password rules (section 1): at least 10 characters and not a common password. Pure and unit-tested. */
import { MIN_PASSWORD } from "./better-auth";

/** Well-known passwords of 10+ characters (shorter ones fail the length rule anyway). */
const COMMON = new Set(
  `1234567890 0987654321 1234567891 1111111111 0000000000 1231231231 1212121212 1029384756 1qaz2wsx3edc
qwertyuiop qwertyuiop1 qwerty1234 qwerty12345 qwerty123456 1q2w3e4r5t 1q2w3e4r5t6y q1w2e3r4t5 zaq12wsxcv
asdfghjkl1 asdfghjkl; zxcvbnm123 password12 password123 password1234 password12345 password@123 passw0rd123
p@ssword123 p@ssw0rd123 iloveyou12 iloveyou123 welcome123 welcome1234 welcome@123 letmein123 letmein1234
admin12345 admin123456 admin@1234 admin@12345 administrator changeme123 changeme1234 sunshine123 football123
baseball123 superman123 batman12345 princess123 starwars123 monkey12345 dragon12345 trustno1234 abc1234567
abcdef1234 abcd123456 abcdefghij abcdefg123 test123456 testing123 qazwsxedc123 india12345 india@1234
mumbai1234 pune123456 pune@12345 bharat1234 hindustan1 jaishriram jaishreeram jaimatadi1 omnamahshivaya
ganesh1234 krishna123 sairam1234 9876543210 1122334455 1234554321 1357924680 2468013579 12345678910
autocluster autocluster1 autocluster123 acdri12345 acdri@1234 mccia12345 company123 office1234 temp123456
default123 secret1234 computer12 internet123 whatever123 nothing123 samsung123 iphone1234`
    .split(/\s+/)
    .filter(Boolean),
);

const sequential = (s: string) => "01234567890123456789".includes(s) || "98765432109876543210".includes(s) || "abcdefghijklmnopqrstuvwxyz".includes(s);

/** A plain message, or null when the password is fine. */
export function passwordProblem(password: string, opts: { name?: string | null; email?: string | null } = {}): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > 128) return "Use 128 characters or fewer.";
  const p = password.toLowerCase();
  if (COMMON.has(p) || /^(.)\1+$/.test(p) || sequential(p)) return "That password is too common. Try a short sentence you will remember.";
  const parts = [opts.email?.split("@")[0], ...(opts.name ?? "").split(/\s+/)].map((x) => (x ?? "").toLowerCase()).filter((x) => x.length >= 4);
  if (parts.some((x) => p === x || p.replace(/[^a-z]/g, "") === x)) return "Don't use your name or email as the password.";
  return null;
}

/** A strong temporary password: 4 words and a number, easy to read out, e.g. "Mango-Delta-River-Comet-47". */
export function temporaryPassword(rand: (n: number) => number): string {
  const words = ["Mango", "Delta", "River", "Cedar", "Amber", "Falcon", "Tiger", "Lotus", "Orbit", "Maple", "Coral", "Pearl", "Comet", "Sable", "Indigo", "Saffron", "Monsoon", "Harbor", "Summit", "Garnet", "Quartz", "Willow", "Ember", "Nimbus"];
  const pick = () => words[rand(words.length)];
  return `${pick()}-${pick()}-${pick()}-${pick()}-${10 + rand(90)}`;
}
