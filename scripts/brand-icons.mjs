// Builds the ERPOne icons from the SVGs in public/brand/ (run: node scripts/brand-icons.mjs).
// App icons (home screen) come from erpone-app-icon.svg; 48px and smaller from erpone-favicon.svg.
import fs from "node:fs";
import sharp from "sharp";

const brand = "public/brand";
const icons = "public/icons";
const appIcon = fs.readFileSync(`${brand}/erpone-app-icon.svg`, "utf8");
const favicon = fs.readFileSync(`${brand}/erpone-favicon.svg`, "utf8");
// Square corners for iPhone (it rounds them itself) and the maskable icon (the phone crops it).
const square = appIcon.replace('rx="14"', 'rx="0"');

const png = (svg, size) => sharp(Buffer.from(svg), { density: Math.ceil((72 * size) / 64) * 2 }).resize(size, size).png().toBuffer();

const out = {
  "apple-touch-icon.png": [square, 180],
  "icon-192.png": [appIcon, 192],
  "icon-512.png": [appIcon, 512],
  "icon-maskable-512.png": [square, 512],
  "favicon-16.png": [favicon, 16],
  "favicon-32.png": [favicon, 32],
  "favicon-48.png": [favicon, 48],
};
const made = {};
for (const [name, [svg, size]] of Object.entries(out)) {
  made[name] = await png(svg, size);
  fs.writeFileSync(`${icons}/${name}`, made[name]);
}
fs.copyFileSync(`${brand}/erpone-favicon.svg`, `${icons}/favicon.svg`);

// favicon.ico holding the 16, 32 and 48 PNGs.
const imgs = [16, 32, 48].map((s) => [s, made[`favicon-${s}.png`]]);
const head = Buffer.alloc(6 + 16 * imgs.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(imgs.length, 4);
let offset = head.length;
imgs.forEach(([s, buf], i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s, e);
  head.writeUInt8(s, e + 1);
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(buf.length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += buf.length;
});
fs.writeFileSync("app/favicon.ico", Buffer.concat([head, ...imgs.map(([, b]) => b)]));
console.log("Icons written:", Object.keys(out).join(", "), "+ favicon.svg, app/favicon.ico");
