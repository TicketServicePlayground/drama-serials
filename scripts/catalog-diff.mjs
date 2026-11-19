// What a sheet import changed, in one short Russian summary for Telegram (scripts/sync-sheet.sh).
// A new series moves every other one down a rank: ranks alone are not reported.
// Usage: node scripts/catalog-diff.mjs <old catalog.json> <new catalog.json>
import { readFileSync } from "node:fs";

const [before, after] = process.argv.slice(2).map((file) => JSON.parse(readFileSync(file, "utf8")));
const title = (serial) => serial.title.ru ?? serial.title.en ?? serial.title.id ?? serial.slug;
const old = new Map(before.map((serial) => [serial.slug, serial]));
const lines = [];

for (const serial of after) {
  const previous = old.get(serial.slug);
  const url = `https://affinet.link/series/${serial.slug}`;
  if (!previous) {
    lines.push(`+ новый сериал «${title(serial)}», ${serial.episodes.length} сер. ${url}`);
    continue;
  }
  const added = serial.episodes.length - previous.episodes.length;
  if (added > 0) {
    const from = previous.episodes.length + 1;
    const to = serial.episodes.length;
    lines.push(`+ «${title(serial)}»: ${from === to ? `серия ${to}` : `серии ${from}–${to}`} ${url}`);
  } else if (Boolean(serial.vip) !== Boolean(previous.vip)) {
    lines.push(`~ «${title(serial)}»: ${serial.vip ? "теперь только для VIP" : "больше не VIP"}`);
  } else if (JSON.stringify({ ...serial, rank: 0 }) !== JSON.stringify({ ...previous, rank: 0 })) {
    lines.push(`~ «${title(serial)}»: обновлены тексты или картинки`);
  }
}
console.log(lines.join("\n") || "обновлены картинки");
