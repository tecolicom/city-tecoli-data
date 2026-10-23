// 自治体レジストリ生成ツール (手動実行)。
//   node municipalities/build.mjs
// design: docs/superpowers/specs/2026-06-18-municipality-registry-design.md
//
// 方針 (確定): handle の権威は lg.jp ドメインのみ。
//   - lg.jp が確認できた自治体だけ登録。確認できなければ対象外 (一次対応; 救済は後で)。
//   - 地域型(type.名前.県.jp) や city.名前.jp は一意性を担保しないので、それ自体では採用しない。
//   - lg.jp の実在確認は JPRS WHOIS (DNS は SERVFAIL で誤判定するため使わない)。
//     WHOIS は組織名も返すので「その自治体の lg.jp か」を照合できる (homonym 対策)。
//
// 候補ラベルの綴り (WHOIS クエリ用) は website ラベル → 日本郵便 KEN_ALL_ROME の順。
//   (例 鴻巣: lg.jp は city.kounosu.lg.jp で website 綴り。Japan Post の konosu では当たらない)
//
// 出典: 団体コード/緯度経度/website = code4fukui/localgovjp,prefjp (CC0)。綴り参考 = 日本郵便 KEN_ALL_ROME。

import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const LOCALGOV = 'https://raw.githubusercontent.com/code4fukui/localgovjp/master';
const KEN_ALL_ROME = 'https://www.post.japanpost.jp/service/search/zipcode/download/roman/KEN_ALL_ROME.zip';
const OUT_FILE = resolve(dirname(fileURLToPath(import.meta.url)), 'municipalities.yaml');

// 全国 47 都道府県。特定県だけにしたいときは { 11: true, 1: true } のように絞る。
const TARGET_PREFS = Object.fromEntries(Array.from({ length: 47 }, (_, i) => [i + 1, true]));
const TYPE_SUFFIX = { city: '', town: '-town', vill: '-vill', pref: '-pref' };
const WHOIS_WAIT_MS = 4000; // JPRS WHOIS の throttle (全国はやさしめに。速いと banner のみ返され絞られる)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 特別区(東京23区)は lg.jp 上 city 扱い(city.chiyoda.lg.jp)。政令市の行政区は事前に空白で除外済み。
const typeFromName = (n) => (n.endsWith('市') || n.endsWith('区') ? 'city' : n.endsWith('町') ? 'town' : n.endsWith('村') ? 'vill' : null);

async function fetchCsv(name) {
  const res = await fetch(`${LOCALGOV}/${name}`);
  if (!res.ok) throw new Error(`fetch ${name}: ${res.status}`);
  return (await res.text()).replace(/^﻿/, '').trim().split('\n').map((l) => l.split(','));
}

// 日本郵便 KEN_ALL_ROME → (都道府県漢字, 市区町村名) → ローマ字ラベル (綴り候補の参考)
async function fetchRomeMap() {
  const res = await fetch(KEN_ALL_ROME);
  if (!res.ok) throw new Error(`fetch KEN_ALL_ROME: ${res.status}`);
  const dir = mkdtempSync(join(tmpdir(), 'kenrome-'));
  const zip = join(dir, 'k.zip');
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  execSync(`unzip -o ${zip} -d ${dir}`, { stdio: 'ignore' });
  const txt = new TextDecoder('shift_jis').decode(readFileSync(join(dir, 'KEN_ALL_ROME.CSV')));
  const map = new Map();
  const stripType = (r) => r.replace(/ (SHI|CHO|MACHI|SON|MURA|KU)$/, '');
  for (const line of txt.split(/\r?\n/)) {
    if (!line) continue;
    const f = line.split(',').map((s) => s.replace(/^"|"$/g, ''));
    let muni = f[2], rome = f[5];
    if (muni.includes('　')) {
      const [l, r] = muni.split('　');
      if (l.endsWith('郡')) { muni = r; rome = rome.replace(/^[A-Z]+ GUN /, ''); }
      else if (l.endsWith('市')) { muni = l; rome = rome.replace(/ SHI .*/, ' SHI'); }
    }
    const key = `${f[1]}\t${muni}`, label = stripType(rome).replace(/\s+/g, '').toLowerCase();
    if (label && !map.has(key)) map.set(key, label);
  }
  return map;
}

// website url から識別ラベルを取り出す。lg.jp かどうかも返す。
function parseUrl(url) {
  const isLg = /\.lg\.jp/i.test(url);
  let h = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\d*\./, '');
  const t = h.split('.');
  t.pop(); // tld (jp/com/net...)
  if (isLg) {
    if (t[t.length - 1] === 'lg') t.pop(); // type.label.lg → label は県名と一致しても残す (奈良市=city.nara.lg.jp)
  } else if (t.length > 1 && PREF_ROMA.has(t[t.length - 1])) {
    t.pop(); // 地域型 type.label.<県>.jp の県名を落とす
  }
  if (['city', 'town', 'vill', 'pref', 'metro', 'union'].includes(t[0])) t.shift();
  return { isLg, label: t.join('.') };
}

// WHOIS 結果のディスクキャッシュ (再実行を高速・安全にする)。repo にコミットして再現可能に。
const CACHE_FILE = resolve(dirname(fileURLToPath(import.meta.url)), 'whois-cache.json');
let cache = {};
try { cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { /* 無ければ空 */ }

// JPRS WHOIS で lg.jp の登録状態と組織名(漢字)を取得 (throttle + cache + retry)。
// 「No match!!」or「[状態] Registered」が明示された応答だけを確定としてキャッシュ。
// それ以外 (レート制限の banner のみ等) は非確定 → backoff して再試行。確定できなければ error。
async function whois(domain) {
  if (domain in cache) return cache[domain];
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(attempt === 0 ? WHOIS_WAIT_MS : 6000); // 非確定時は長めに待つ
    whoisCount++;
    let out = '';
    try { out = execSync(`whois -h whois.jprs.jp ${domain}`, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { continue; } // exec 失敗 → 再試行
    let res = null;
    if (/No match!!/.test(out)) res = { ok: false };
    else if (/\[(?:State|状態)\]\s*Registered/.test(out)) res = { ok: true, org: (out.match(/\[組織名\]\s*(.+)/) || [])[1]?.trim() };
    if (res) { cache[domain] = res; writeFileSync(CACHE_FILE, JSON.stringify(cache)); return res; }
    // 非確定 (throttle 等) → 再試行
  }
  return { ok: false, error: true }; // 確定できず (キャッシュしない)
}

const rome = await fetchRomeMap();
const muni = await fetchCsv('localgovjp-utf8.csv');
const pref = await fetchCsv('prefjp-utf8.csv');
const PREF_ROMA = new Set(pref.slice(1).map((r) => r[5].toLowerCase()));
const PREF_KANJI = pref.slice(1).map((r) => r[1]); // 都道府県漢字 (北海道, 宮城県, ...)。homonym 判別用

const entries = [];
const excluded = [];
let whoisCount = 0;

// lg.jp ラベルを決定。website が lg.jp ならそれ。違えば候補を WHOIS で確認(org 照合)。
async function resolveLgLabel({ name, prefKanji, type, url }) {
  const { isLg, label: webLabel } = parseUrl(url);
  if (isLg && webLabel) return webLabel; // website 自体が lg.jp = 実在の証拠
  const jp = rome.get(`${prefKanji}\t${name}`);
  const prefRoma = pref.slice(1).find((r) => r[1] === prefKanji)?.[5].toLowerCase();
  // website ラベルから接辞を除いた変種も候補にする (独自ドメイン city-matsuura/koumi-town/nanmoku.ne →
  // lg.jp ラベル matsuura/koumi/nanmoku)。誤候補は WHOIS の org 照合で弾かれるので安全。
  const variants = (lbl) => {
    if (!lbl) return [];
    const v = new Set([lbl]);
    v.add(lbl.replace(/^(city|town|vill|pref|e)-/, ''));
    v.add(lbl.replace(/-(city|town|vill|machi)$/, ''));
    v.add(lbl.replace(/(town|city|machi)$/, ''));
    v.add(lbl.replace(/\.(ne|net|org|com)$/, ''));
    v.add(lbl.replace(/-(net|hp|web)$/, ''));
    return [...v].filter(Boolean);
  };
  const base = [...new Set([...variants(webLabel), jp].filter(Boolean))];
  const cands = [...new Set([...base, ...(prefRoma ? base.map((c) => `${prefRoma}-${c}`) : [])])];
  // WHOIS org は書式が不統一: 「飯能市」「神奈川県茅ヶ崎市」「宮城県宮城郡利府町」「御代田町役場」「遠　別　町」等。
  // 照合: 空白除去で name を含む かつ (org が県名を含むなら当該県を含む)。後者で homonym (広島府中 vs 東京府中) を弾く。
  const norm = (s) => (s || '').replace(/[\s　]/g, '');
  const nName = norm(name);
  const matchOrg = (org) => {
    if (!org) return true; // org が取れない時は登録を信用
    const o = norm(org);
    if (!o.includes(nName)) return false;
    const hasSomePref = PREF_KANJI.some((p) => o.includes(p));
    return !hasSomePref || o.includes(prefKanji);
  };
  for (const c of cands) {
    const r = await whois(`${type}.${c}.lg.jp`);
    if (r.ok && matchOrg(r.org)) return c;
  }
  return null;
}

// 都道府県エントリ
for (const r of pref.slice(1)) {
  const pid = Number(r[0]);
  if (!(pid in TARGET_PREFS)) continue;
  const label = r[5].toLowerCase(); // pref_en (Saitama→saitama, Hokkaido→hokkaido)。pref.X.lg.jp は実在前提
  entries.push({ code: String(pid).padStart(2, '0') + '000', handle: label + TYPE_SUFFIX.pref, name_ja: r[1], yomi: r[2], type: 'pref', lat: Number(r[11]), lng: Number(r[12]), website: r[7]?.trim() || null });
}

// 市区町村エントリ
let skippedWard = 0;
for (const r of muni.slice(1)) {
  const pid = Number(r[0]);
  if (!(pid in TARGET_PREFS)) continue;
  const name = r[3];
  if (name.includes(' ')) { skippedWard++; continue; }
  const type = typeFromName(name);
  if (!type) { excluded.push(`${name} (種別不明)`); continue; }
  const label = await resolveLgLabel({ name, prefKanji: r[1], type, url: r[7] });
  if (!label) { excluded.push(`${r[1]} ${name} (lg.jp 確認できず, website=${r[7]})`); continue; }
  entries.push({ code: String(r[2]).padStart(5, '0'), handle: label + TYPE_SUFFIX[type], name_ja: name, yomi: r[4], type, lat: Number(r[5]), lng: Number(r[6]), website: r[7]?.trim() || null });
  if (entries.length % 25 === 0) console.error(`進捗: 登録 ${entries.length} / 対象外 ${excluded.length} / WHOIS ${whoisCount} 回`);
}

// 一意性チェック
const seen = new Map();
for (const e of entries) {
  if (seen.has(e.handle)) throw new Error(`handle 衝突: ${e.handle} (${e.name_ja} / ${seen.get(e.handle)})`);
  seen.set(e.handle, e.name_ja);
}

entries.sort((a, b) => a.code.localeCompare(b.code));
const fmt = (e) => `- code: "${e.code}"\n  handle: ${e.handle}\n  name_ja: ${e.name_ja}\n  yomi: "${e.yomi}"\n  type: ${e.type}\n  lat: ${e.lat}\n  lng: ${e.lng}\n  website: ${e.website === null ? 'null' : JSON.stringify(e.website)}\n`;
const header = `# 自動生成: municipalities/build.mjs\n# 権威=lg.jp(JPRS WHOIS 確認)。綴り参考=日本郵便 KEN_ALL_ROME。code/座標/website=code4fukui/localgovjp,prefjp(CC0)\n# 手で編集しない。再生成: node municipalities/build.mjs\n`;
writeFileSync(OUT_FILE, header + entries.map(fmt).join(''));

console.log(`municipalities.yaml: ${entries.length} 件 (政令市区を除外: ${skippedWard}, WHOIS: ${whoisCount} 回)`);
console.log(`対象外: ${excluded.length} 件`);
excluded.forEach((e) => console.log('  - ' + e));
