# 公共データ index 第一スライス 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自治体が発信する予定・催事情報の「実際に使えるか」を配信元単位で実測評価する repo を立ち上げ、埼玉県ぶんを埋める。

**Architecture:** `japan-gomi-data` の構造を踏襲する。YAML が正典、JSON Schema で検証、`.mjs` スクリプトで採点と指紋判定。2 階建て — `families/` が CMS 系統ごとの指紋と取得口パターンを持ち、`municipalities/<県>/<handle>/` が自治体ごとの基盤 (`web.yaml`) と領域評価 (`assessments/<domain>.yaml`) を持つ。評価は配信元ごとに行を持ち、自治体値はそこから導出する。

**Tech Stack:** Node >= 20 (`type: module`, `.mjs`)、`yaml`、`ajv` + `ajv-formats`、`eslint`、`node --test`。Makefile は人間向け入口のみ (実装は npm scripts)。

**Spec:** `docs/superpowers/specs/2026-10-23-public-information-usability-index-design.md`

**repo 名:** `japan-city-opendata-score` (設計者判断。公開前の改名は安い)

## Global Constraints

仕様から project 全体に効く要求。**全タスクの要件に暗黙に含まれる。**

- Node >= 20、`"type": "module"`、スクリプトは `.mjs`。Makefile に実装を書かない (CI は npm を直接叩く)
- `handle` は `city-tecoli-data/municipalities/municipalities.yaml` (1,786 件) を引く。**自前で採番しない**
- **robots.txt を尊重する。指紋採取も例外ではない**
- **指紋採取は 1 自治体あたりトップページ 1 回を基本とする。** family が確定すれば追加取得は不要な設計にする
- 同時実行を絞り、リクエスト間隔を置く。1,786 自治体を一気に舐めない
- 取得結果はキャッシュし、再実行で再取得しない
- User-Agent に連絡先 URL を入れる
- 可用性の観測頻度は**日次を上限**とする
- **脆弱性探索はしない。** 管理画面のパス探索・既知脆弱性の試行・認証の試験を行わない
- 製品名・バージョンは記録する。**必ず `observed_at` と判定根拠を併記する**
- データは CC0 または CC BY 4.0、文書は CC BY 4.0。**調査対象サイトの本文をそのまま取り込まない**
- `unknown` は **0 点ではない**。「測っていない」である
- 公開する集計値には **`measured` のみ**を含め、母数を明示する
- コア 100 点と追加軸を**合算した総合点は作らない**
- **`japan-gomi-data` 側の再採点は行わない。** ごみの正典は静的プロファイルの段階表として現状のまま
- A/F の基準値は国内実測 (`observed_from: jp-residential`)。国外 IP からの遮断は構造化フィールドで持つ
- 継承可能な軸は **A / F / G のみ**。B / C / D は継承不可

## Review Focus

仕様が含意するが、どのタスクのテストも触らない入力・状態。可能性の高い順。**各行の테스트を担当タスクに足してある。**

1. **robots.txt が指紋採取を禁じているサイト** — 取得してしまう。Task 5 でテスト
2. **複数自治体が 1 ドメインを共有する / 広域連合・一部事務組合が配信元** — publisher id が衝突、または 1 配信元を複数 handle が共有する。Task 7 でテスト
3. **配信元が恒久的に消えた・移転した** (2026-10 の `feed.php` 502 が実例) — 古い評価が現在値として読まれる。Task 7 でテスト
4. **lg.jp を持たない配信元の id 衝突** — 「図書館」が複数自治体に存在する。Task 7 でテスト
5. **政令指定都市** — 行政区は lg.jp を持たず 1 handle に複数実体が入る。Task 3 でテスト

---

### Task 1: `municipalities.yaml` に `website` を足す

`city-tecoli-data` 側の前提作業。公式サイト URL が無いと指紋採取の起点が無い。

**Files:**
- Modify: `city-tecoli-data/municipalities/build.mjs`
- Modify (生成物): `city-tecoli-data/municipalities/municipalities.yaml`
- Modify: `city-tecoli-data/README.md` (フィールド表に 1 行)

**Interfaces:**
- Consumes: なし
- Produces: `municipalities.yaml` の各レコードに `website: string | null`。`null` は出典に URL が無いことを意味する (未調査ではない)

- [ ] **Step 1: 出典に website が在ることを確認する**

Run: `node -e` で `code4fukui/localgovjp` の取得物を読み、`website` 相当の列が存在することと、値が入っている件数を数える。
Expected: 1,786 件のうち大多数に URL が入っている。入っていない件数を記録する

- [ ] **Step 2: `build.mjs` の出力レコードに `website` を足す**

既存の `code / handle / name_ja / yomi / type / lat / lng` の後に置く。出典に無い場合は `null` を出力する (キーを省略しない — 「未調査」と区別がつかなくなる)。

- [ ] **Step 3: 再生成して検証する**

Run: `node municipalities/build.mjs` (`whois-cache.json` を使い WHOIS を再問い合わせしないこと)
Expected: 件数が 1,786 件のまま変わらず、`grep -c 'website:' municipalities.yaml` が 1,786

- [ ] **Step 4: コミット**

```bash
git add municipalities/build.mjs municipalities/municipalities.yaml README.md
git commit -m "feat(municipalities): website フィールドを出力に足す"
```

---

### Task 2: repo 足場と検証ゲート

**Files:**
- Create: `package.json` / `Makefile` / `eslint.config.mjs` / `LICENSE` / `.gitignore` / `README.md`
- Create: `scripts/validate.mjs`
- Create: `scripts/_lib/lib.mjs` / `scripts/_lib/lib.test.mjs`
- Create: `.github/workflows/test.yml`

**Interfaces:**
- Consumes: なし
- Produces:
  - `scripts/_lib/lib.mjs`: `loadYaml(path): object`、`listMunicipalityDirs(root): {pref, handle, dir}[]`、`loadRegistry(path): Map<handle, {code, name_ja, type, website}>`
  - `npm run validate` / `npm test` / `make test`

`japan-gomi-data/package.json` と `Makefile` を雛形にする。`scripts` は `validate` / `test` / `lint` / `score` / `fingerprint` / `new` を持つ。

- [ ] **Step 1: 失敗するテストを書く**

`scripts/_lib/lib.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry } from './lib.mjs';

test('loadRegistry は handle で引ける Map を返す', () => {
  const reg = loadRegistry(FIXTURE_REGISTRY);   // 3 件の最小 fixture
  assert.equal(reg.get('hanno').name_ja, '飯能市');
  assert.equal(reg.get('moroyama-town').type, 'town');
});

test('loadRegistry は未知の handle に undefined を返す', () => {
  assert.equal(loadRegistry(FIXTURE_REGISTRY).get('nonexistent'), undefined);
});
```

fixture は `scripts/_lib/__fixtures__/registry-min.yaml` に置く。**本物のレジストリをテストで読まない** (1,786 件に依存するとテストが壊れやすい)。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test scripts/_lib/lib.test.mjs`
Expected: FAIL (`Cannot find module './lib.mjs'`)

- [ ] **Step 3: `scripts/_lib/lib.mjs` に 3 関数を実装する**

`loadYaml(path)`、`listMunicipalityDirs(root)`、`loadRegistry(path)`。`yaml` パッケージの `parse` を使う。

- [ ] **Step 4: 足場の残りを作る**

`package.json` (name/license/engines/type/scripts/devDependencies)、`Makefile` (`help` / `setup` / `test` / `lint`、`##` コメント形式)、`eslint.config.mjs`、`.gitignore` (`node_modules`、キャッシュ)、`LICENSE` (CC BY 4.0)、`README.md` は骨のみ。`scripts/validate.mjs` はこの時点では schema が無いので「schema ディレクトリが空なら成功」とする。

- [ ] **Step 5: ゲートが通ることを確認する**

Run: `npm ci && npm test`
Expected: PASS

- [ ] **Step 6: CI を配線してコミット**

`.github/workflows/test.yml` で `npm ci && npm test`。

```bash
git add -A && git commit -m "chore: repo 足場と検証ゲート"
```

---

### Task 3: 情報領域の語彙 (`schema/domains.yaml`)

**Files:**
- Create: `schema/domains.yaml`
- Create: `schema/domains.schema.json`
- Create: `scripts/__tests__/domains.test.mjs`
- Modify: `scripts/validate.mjs`

**Interfaces:**
- Consumes: `loadYaml` (Task 2)
- Produces: `schema/domains.yaml` — 各領域が `{id, name_ja, standard_dataset, profile, publishers_expected}` を持つ。`profile` は `static` | `dynamic`

仕様 §7.1 の自治体標準オープンデータセット **基本編 14 + 応用編 8 を全件**登録する (実装するのは `schedule-events` のみだが語彙は通す)。標準に無い領域は `standard_dataset: null` とし、第一号に `gomi` を置く。

`schedule-events` は仕様 §9 の決定に従い、**標準 OD「イベント一覧」とお知らせフィードを同じ領域**に含める。

- [ ] **Step 1: 失敗するテストを書く**

```js
test('domains.yaml は標準データセット 22 件を含む', () => {
  const d = loadYaml('schema/domains.yaml').domains;
  assert.equal(d.filter((x) => x.standard_dataset).length, 22);
});

test('schedule-events は dynamic プロファイルで標準 OD に紐づく', () => {
  const se = find(d, 'schedule-events');
  assert.equal(se.profile, 'dynamic');
  assert.equal(se.standard_dataset, '自治体標準オープンデータセット/基本編/6_イベント一覧');
});

test('gomi は標準データセットを持たない拡張領域', () => {
  assert.equal(find(d, 'gomi').standard_dataset, null);
  assert.equal(find(d, 'gomi').profile, 'static');
});

// Review Focus 5: 政令指定都市
test('政令指定都市の handle は 1 件で、行政区を領域の単位にしない', () => {
  // domains.yaml の publishers_expected に「行政区」が現れないこと
  assert.ok(!JSON.stringify(d).includes('行政区'));
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test scripts/__tests__/domains.test.mjs`
Expected: FAIL (ファイルが無い)

- [ ] **Step 3: `schema/domains.yaml` と `domains.schema.json` を書く**

基本編 14: AED設置箇所 / 介護サービス事業所 / 医療機関 / 文化財 / 観光施設 / イベント一覧 / 公衆無線LAN / 公衆トイレ / 消防水利施設 / 指定緊急避難場所 / 地域・年齢別人口 / 公共施設 / 子育て施設 / オープンデータ一覧。
応用編 8: 食品等営業許可 / 学校給食献立 / 小中学校通学区域 / ボーリング柱状図 / 都市計画基礎調査 / 調達情報 / 標準的なバス情報フォーマット / 支援制度情報。

- [ ] **Step 4: `validate.mjs` に domains の検証を足し、テストが通ることを確認する**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add schema scripts && git commit -m "feat(schema): 情報領域の語彙 (標準データセット 22 件 + 拡張)"
```

---

### Task 4: 指標の正典 (`docs/index.md`)

コードより先に正典を固定する。以降のタスクはこの文書を参照する。

**Files:**
- Create: `docs/index.md`

**Interfaces:**
- Consumes: なし
- Produces: 段階表の参照先。Task 7 の `score.mjs` と Task 8 の実測がこれに従う

書く内容 (仕様 §5 から。**配点を変えないこと**):

- コア 5 軸と配点: A 取得性 20 / B 機械可読性 25 / C 粒度 20 / D ライセンス 20 / E 検証可能性 15
- 各軸の W3C DQV・ISO/IEC 25012 対応 (A=Availability / C=Precision+Completeness / D=Licensing / E=Traceability / F=Timeliness↔Currentness / G=Availability の時間軸)
- 思想: 「立派か」ではなく「実際に使えるか」。公式カタログ外でも機械可読なら得点する
- **共通にするのは軸名・配点・思想・由来の扱いだけ。段階表はプロファイルが持つ**
- 由来 4 値 (`measured` / `inherited` / `estimated` / `unknown`) と、継承可能な軸は A/F/G のみ
- `unknown` は 0 点ではない
- 測定地点: 基準は `jp-residential`、国外遮断は構造化フィールド
- 合算総合点を作らない理由
- `japan-gomi-data/docs/opendata-quality-index.md` を静的プロファイルの段階表として参照する旨

- [ ] **Step 1: `docs/index.md` を書く**

- [ ] **Step 2: ごみ側の正典と矛盾しないことを確認する**

Run: `japan-gomi-data/docs/opendata-quality-index.md` の 5 軸の配点と軸名を目視照合
Expected: 軸名・配点が一致。段階表はごみ側にのみ在る

- [ ] **Step 3: コミット**

```bash
git add docs/index.md && git commit -m "docs: 指標の正典 (コア 5 軸と由来の扱い)"
```

---

### Task 5: 指紋採取 (`scripts/fingerprint.mjs`)

**Files:**
- Create: `scripts/fingerprint.mjs`
- Create: `scripts/_lib/fetch.mjs` / `scripts/_lib/fetch.test.mjs`
- Create: `scripts/__tests__/fingerprint.test.mjs`

**Interfaces:**
- Consumes: `loadRegistry` (Task 2)
- Produces:
  - `scripts/_lib/fetch.mjs`: `politeFetch(url, {cacheDir}): Promise<{status, headers, body, fromCache}>`。robots.txt を確認し、禁止なら `{status: 'robots-denied'}` を返して取得しない
  - `scripts/fingerprint.mjs`: `fingerprint(html, headers): {signals: string[], familyId: string | null}`

**取得は 1 自治体トップページ 1 回。** 結果は `cacheDir` に保存し、再実行で再取得しない。

- [ ] **Step 1: 失敗するテストを書く**

```js
// Review Focus 1: robots.txt の尊重
test('robots.txt が禁じているパスは取得しない', async () => {
  const r = await politeFetch(url, { cacheDir, _robots: 'User-agent: *\nDisallow: /' });
  assert.equal(r.status, 'robots-denied');
  assert.equal(r.body, undefined);        // 本文を取っていない
});

test('キャッシュがあれば再取得しない', async () => {
  await politeFetch(url, { cacheDir });
  const second = await politeFetch(url, { cacheDir });
  assert.equal(second.fromCache, true);
});

test('User-Agent に連絡先 URL が入る', () => {
  assert.match(USER_AGENT, /\+https?:\/\//);
});

test('既知 family の指紋を判定する', () => {
  const r = fingerprint(FIXTURE_HANNO_HTML, {});
  assert.equal(r.familyId, 'fam-feedphp-sitenew');
  assert.ok(r.signals.includes('cgi-bin/feed.php?siteNew'));
});

test('指紋が一つも当たらなければ familyId は null', () => {
  assert.equal(fingerprint('<html></html>', {}).familyId, null);
});
```

fixture HTML は**自前で書いた最小の擬似 HTML**にする。実サイトの本文を置かない (Global Constraints)。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test scripts/_lib/fetch.test.mjs scripts/__tests__/fingerprint.test.mjs`
Expected: FAIL

- [ ] **Step 3: `politeFetch` と `fingerprint` を実装する**

`politeFetch`: robots.txt を同一ホストで 1 回取得してキャッシュ、`Disallow` 判定、リクエスト間隔 (既定 2 秒以上)、同時実行 1。
`fingerprint`: `families/*.yaml` の `signals` を読み、一致数が閾値以上の family を返す。判定規則をコードに埋め込まない。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add scripts && git commit -m "feat(scripts): 礼儀を守る取得層と指紋判定"
```

---

### Task 6: family schema と既知 family の登録

**Files:**
- Create: `schema/family.schema.json`
- Create: `families/fam-feedphp-sitenew.yaml`
- Create: `scripts/__tests__/families.test.mjs`
- Modify: `scripts/validate.mjs`

**Interfaces:**
- Consumes: `fingerprint` (Task 5)
- Produces: `families/<id>.yaml` — `{id, aliases, product, version, observed_at, evidence, signals, feed_patterns, sync_kind, reachability, known_incidents}`

既知の 1 件を登録する。仕様 §7.2 の実測値をそのまま入れる。**製品名は未特定** — `product: null` で成立すること自体が要件である。

- [ ] **Step 1: 失敗するテストを書く**

```js
test('product が null でも family は妥当', () => {
  const f = loadYaml('families/fam-feedphp-sitenew.yaml');
  assert.equal(f.product, null);
  assert.ok(validate(f));                      // ajv
});

test('version を持つなら observed_at と evidence が必須', () => {
  assert.ok(!validate({ ...f, version: '1.2' }));              // 根拠なし → 不可
  assert.ok(validate({ ...f, version: '1.2', observed_at: '2026-10-23', evidence: '...' }));
});

test('既知 family は 4 自治体を代表実測として挙げる', () => {
  assert.deepEqual(f.measured_representatives.sort(),
    ['hanno', 'hidaka', 'iruma', 'moroyama-town']);
});

test('国外からの遮断は構造化フィールドで持つ', () => {
  assert.equal(typeof f.reachability.overseas_rest, 'string');
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test scripts/__tests__/families.test.mjs`
Expected: FAIL

- [ ] **Step 3: schema と family を書く**

`signals`: `/cgi-bin/feed.php?siteNew=` / `/index.update.json` / `/news_list.html` / `/theme/base/js/mutual_switching/` / `/resource/js/foot_print.js` / `<!-- CMS編集領域ここから -->`。
`feed_patterns`: `/cgi-bin/feed.php?siteNew=1&displayCount={n}&displayRange={days}&includeShortcut={0|1}` (RSS 1.0/RDF、`dc:date`)。
`sync_kind: append` (追記型)。
`known_incidents`: 2026-10-21〜 の `feed.php` 502 停止 (複数自治体同時、PHP CVE-2026-109618/109619 と時系列が重なるが因果は未確認)。

- [ ] **Step 4: `validate.mjs` に family 検証を足し、テストが通ることを確認する**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add schema families scripts && git commit -m "feat(families): 既知 CMS 系統 1 件を登録 (製品名未特定)"
```

---

### Task 7: assessment schema (配信元単位)

**Files:**
- Create: `schema/assessment.schema.json`
- Create: `schema/web.schema.json`
- Create: `scripts/__tests__/assessment.test.mjs`
- Modify: `scripts/validate.mjs`

**Interfaces:**
- Consumes: `domains.yaml` (Task 3)、`families/` (Task 6)
- Produces:
  - `municipalities/<pref>/<handle>/web.yaml` — `{handle, family_id, family_confidence, fingerprinted_at}`
  - `municipalities/<pref>/<handle>/assessments/<domain>.yaml` — `{domain, publishers: [...], surveyed_at}`
  - publisher: `{id, name_ja, entity_type, domain_name, place_id?, url, form, facts, axes: {A..G}, provenance: {A..G}, observed_from, reachability?, notes}`
  - `facts` — **観測した事実**。点数ではない。`{conditional_get: 'etag'|'last-modified'|'both'|'none', feed_format, stable_url: bool, edition_label?, license_text?, standard_od: bool}`。
    Task 9 はこれだけを埋め、`axes` は Task 10 で段階表を当てて生成する

publisher id は `<handle>/<publisher-slug>`。`entity_type` は `municipality` / `gaikaku` / `shoko` / `kanko` / `shitei-kanrisha` / `kouiki` から選ぶ。

- [ ] **Step 1: 失敗するテストを書く**

```js
test('配信元ごとに行を持ち、自治体値は導出である', () => {
  const a = loadYaml(FIXTURE_ASSESSMENT);
  assert.ok(Array.isArray(a.publishers));
  assert.equal(a.municipality_score, undefined);   // 保存しない。導出する
});

// Review Focus 4: 非 lg.jp の id 衝突
test('publisher id は handle で名前空間化される', () => {
  assert.equal(a.publishers[0].id, 'hanno/lib-main');
});

// Review Focus 2: 広域連合 / ドメイン共有
test('複数 handle が 1 配信元を共有するとき shared_with を持てる', () => {
  const p = { ...pub, entity_type: 'kouiki', shared_with: ['hanno', 'hidaka'] };
  assert.ok(validate(p));
});

// Review Focus 3: 恒久的に消えた配信元
test('status: gone は観測日と最終成功日を要求する', () => {
  assert.ok(!validate({ ...pub, status: 'gone' }));
  assert.ok(validate({ ...pub, status: 'gone', observed_at: '2026-10-23', last_success_at: '2026-10-21' }));
});

test('unknown な軸は 0 ではなく provenance が unknown', () => {
  const p = { ...pub, axes: { A: null }, provenance: { A: 'unknown' } };
  assert.ok(validate(p));
});

test('B/C/D は inherited を禁じる', () => {
  assert.ok(!validate({ ...pub, provenance: { B: 'inherited' } }));
  assert.ok(validate({ ...pub, provenance: { A: 'inherited' } }));
});

test('facts だけで axes が無くても妥当 (Task 9 の中間状態)', () => {
  const p = { ...pubBase, facts: { conditional_get: 'etag', stable_url: true, standard_od: false } };
  delete p.axes;
  assert.ok(validate(p));
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test scripts/__tests__/assessment.test.mjs`
Expected: FAIL

- [ ] **Step 3: schema を書く**

`provenance` の enum は `measured` / `inherited` / `estimated` / `unknown`。`inherited` を許すのは `A` / `F` / `G` のキーのみ (schema レベルで拘束する)。`inherited` のときは `inherited_from: {family_id, representative_handle}` を必須にする。

- [ ] **Step 4: `validate.mjs` に assessment / web の検証を足し、テストが通ることを確認する**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add schema scripts && git commit -m "feat(schema): 配信元単位の評価と基盤の schema"
```

---

### Task 8: 採点 (`scripts/score.mjs`)

**Files:**
- Create: `scripts/score.mjs`
- Create: `scripts/__tests__/score.test.mjs`
- Modify: `package.json` (`score` スクリプト)、`Makefile` (`score` ターゲット)

**Interfaces:**
- Consumes: `assessment.schema.json` 準拠の YAML、`docs/index.md` の配点
- Produces:
  - `applyProfile(facts, profile): {axes, provenance}` — **観測事実に段階表を当てて点数を出す。** 段階表は `schema/profiles/<profile>.yaml` から読む。事実が欠けている軸は `null` + `provenance: 'unknown'` を返す
  - `score(publisher): {core: {A..E, total, rank}, dynamic: {F, G}, estimated: string}` — **点数から合計とランクを出すだけ。** 段階表を知らない
  - `aggregate(publishers): {n, n_total, ...}`
  - CSV 出力は `docs/scores.csv`

**`applyProfile` と `score` を分ける理由**: 段階表は Task 10 で実測後に確定する。分けておけば `score` は Task 8 の時点で完成でき、Task 10 は段階表の YAML を足すだけで済む。混ぜると Task 8 が Task 10 を待つことになる。

**コアと追加軸を合算しない。** `total` はコア 5 軸のみ。

- [ ] **Step 1: 失敗するテストを書く**

```js
test('total はコア 5 軸のみの合計で、F/G を含まない', () => {
  const s = score({ axes: { A: 20, B: 25, C: 20, D: 20, E: 15, F: 10, G: 8 }, ... });
  assert.equal(s.core.total, 100);
  assert.equal(s.core.rank, 'S');
  assert.deepEqual(s.dynamic, { F: 10, G: 8 });
});

test('unknown な軸は 0 として合計せず、total を推定扱いにする', () => {
  const s = score({ axes: { A: null, ... }, provenance: { A: 'unknown' } });
  assert.ok(s.estimated.includes('A'));
  assert.notEqual(s.core.total, 0);
});

test('集計には measured のみを含め、母数を返す', () => {
  const agg = aggregate([measuredPub, inheritedPub, unknownPub]);
  assert.equal(agg.n, 1);
  assert.equal(agg.n_total, 3);
});

test('applyProfile は段階表を当てて点数と由来を返す', () => {
  const FIXTURE_PROFILE = { axes: { F: [{ when: { conditional_get: 'both' }, points: 20 }] } };
  const r = applyProfile({ conditional_get: 'both' }, FIXTURE_PROFILE);
  assert.equal(r.axes.F, 20);
  assert.equal(r.provenance.F, 'measured');
});

test('applyProfile は事実が欠けた軸を null + unknown にする', () => {
  const r = applyProfile({}, FIXTURE_PROFILE);
  assert.equal(r.axes.F, null);
  assert.equal(r.provenance.F, 'unknown');
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test scripts/__tests__/score.test.mjs`
Expected: FAIL

- [ ] **Step 3: `applyProfile` / `score` / `aggregate` を実装する**

段階表は `docs/index.md` ではなくプロファイル定義 (`schema/profiles/<profile>.yaml`) から読む。**判定の段差をコードに埋め込まない。** `japan-gomi-data/scripts/triage-score.mjs` の構成を参考にするが、ごみ固有の語彙 (`core_missing` 等) は持ち込まない。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add scripts schema package.json Makefile && git commit -m "feat(scripts): コア 5 軸の採点と measured 限定の集計"
```

---

### Task 9: 埼玉県の実測

**Files:**
- Create: `municipalities/saitama/<handle>/web.yaml` × 20〜30
- Create: `municipalities/saitama/<handle>/assessments/schedule-events.yaml` × 同数
- Create: `scripts/new-municipality.mjs`
- Modify: `Makefile` (`new` ターゲット)

**Interfaces:**
- Consumes: Task 5 の `fingerprint`、Task 7 の schema、Task 8 の `score`
- Produces: F/G の段階表を決めるための実測データ

**F / G の段階定義はこの実測の後に決める** (仕様 §5.3)。この段階では軸の値を暫定で入れず、観測した**事実** (条件付き GET の対応、恒久 URL か、フィードの形式、ライセンス表記) を記録する。

- [ ] **Step 1: 足場生成スクリプトを作る**

`scripts/new-municipality.mjs --handle <h> --pref <p>`。レジストリから `code / name_ja / website` を引き、`web.yaml` と空の `assessments/schedule-events.yaml` を置く。

- [ ] **Step 2: 指紋採取を 1 回流す**

Run: `node scripts/fingerprint.mjs --pref saitama --limit 30`
Expected: robots 禁止サイトは `robots-denied` で記録され本文を取っていない。family 判定が付いたものと付かないものが分かれる

- [ ] **Step 3: 配信元を洗い出し、実測して記録する**

各自治体について、予定・催事情報の配信元を探す。満点形 (標準 OD イベント一覧 CSV) の有無を**必ず確認する** — これが無いことが下位形の根拠になる。配信元が複数あれば全部を行にする。非 lg.jp の配信元 (図書館・商工会議所・観光協会等) も対象。

- [ ] **Step 4: schema 検証が通ることを確認する**

Run: `npm run validate`
Expected: PASS。`provenance` が `unknown` の軸が残っていてもよい

- [ ] **Step 5: コミット (自治体ごと、または県単位で分割)**

```bash
git add municipalities/saitama scripts Makefile
git commit -m "feat(saitama): 予定・催事情報の実測 (<n> 自治体)"
```

---

### Task 10: F / G の段階表を確定する

**Files:**
- Create: `schema/profiles/dynamic.yaml`
- Modify: `docs/index.md` (F/G の節)
- Modify: `scripts/__tests__/score.test.mjs`

**Interfaces:**
- Consumes: Task 9 の実測
- Produces: `schema/profiles/dynamic.yaml` の F/G 段階表

Task 9 で観測した事実の分布を見てから段差を決める。**先に数字を決めない。**

- [ ] **Step 1: 実測の分布を出す**

Run: `node scripts/score.mjs --pref saitama --distribution`
Expected: 条件付き GET の対応状況、フィード形式、恒久 URL か、の分布が出る

- [ ] **Step 2: 段階表を書く**

F (更新検知性) は条件付き GET の対応・フィードの有無・更新日時の明示で段差を付ける。G は仕様 §5.3 の代理指標のみ (恒久 URL か / 版表記 / 既知の障害) とし、**`g_proxy` として時系列版と区別できる名前にする**。

- [ ] **Step 3: 段階表を当てて `axes` を生成する**

Run: `node scripts/score.mjs --pref saitama --apply-profile`
Expected: Task 9 で記録した `facts` から各 publisher の `axes` と `provenance` が埋まる。事実が欠けている軸は `null` + `unknown` で残る (0 にしない)

- [ ] **Step 4: 段階表に沿ったテストを足し、通ることを確認する**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add schema/profiles docs/index.md scripts municipalities/saitama
git commit -m "feat(schema): 動的プロファイルの F/G 段階表を実測から確定"
```

---

### Task 11: 手順書と貢献の入口

**Files:**
- Create: `docs/playbook.md` / `CONTRIBUTING.md` / `AGENTS.md`
- Create: `docs/monitoring.md` (L3 の入口。枠のみ)
- Modify: `README.md`

**Interfaces:**
- Consumes: ここまでの全タスク
- Produces: 第三者が自分の自治体を足せる状態

`japan-gomi-data` の `docs/playbook.md` / `CONTRIBUTING.md` / `AGENTS.md` を雛形にする。**LLM から操作できることを優先する** (仕様 §1)。

- [ ] **Step 1: `docs/playbook.md` を書く**

新しい自治体を足す手順: レジストリから handle を引く → `make new` → 指紋採取 (1 回) → family 判定 → 配信元の洗い出し → 満点形の有無を確認 → 軸の記録 → `npm run validate`。**判断の基準と罠**を書く。`hanno-data/.claude/skills/adding-a-calendar-source/SKILL.md` の「先に決める 4 つ」を参照先として挙げる。

- [ ] **Step 2: `CONTRIBUTING.md` と `AGENTS.md` を書く**

`CONTRIBUTING.md` は人向け (自分の町を足したい人)。`AGENTS.md` はエージェント向け (Claude Code / Codex)。**取得の礼儀を両方に明記する** — 貢献者が robots.txt を無視したら枠組みの信用が失われる。

- [ ] **Step 3: `docs/monitoring.md` を枠だけ書き、README を仕上げる**

L3 の範囲 (時系列観測・消滅検知・横断比較) を宣言し、**本スライスでは実装しない**ことを明記。README に「はじめに」の 3 リンク (CONTRIBUTING / AGENTS / playbook) とライセンスを書く。

- [ ] **Step 4: 手順書に沿って 1 自治体を通せることを確認する**

Run: playbook の手順を未収録の 1 自治体で最初から実行する
Expected: 手順だけで `npm run validate` が通る状態まで到達する。詰まった箇所を playbook に反映する

- [ ] **Step 5: コミット**

```bash
git add docs CONTRIBUTING.md AGENTS.md README.md && git commit -m "docs: 収録手順書と貢献の入口"
```

---

## 本スライスでやらないこと

- 他領域の assessments (schema と語彙は通すが実装しない)
- L3 モニタリングの実装 (`docs/monitoring.md` に枠だけ)
- 公開ページ・解説記事
- 継承した assessment ファイルの機械生成 (仕様 §5.5 の判断)
- `japan-gomi-data` 側の再採点
