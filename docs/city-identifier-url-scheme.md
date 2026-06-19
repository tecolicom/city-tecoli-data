# city 識別子 / URL 体系

ステータス: 確定（2026-06-09）
関連: `src/pages/@hanno/`、`src/lib/idea-seeds.ts`、`cities/hanno/config.yaml`、`netlify.toml`

city.tecoli が複数自治体・将来の国際展開に耐えるための「自治体（city）を URL でどう一意に表すか」の設計。idea 個別ページ（`/@hanno/ideas/<idea-slug>/`）の URL を決める議論から生まれた土台。

---

## 1. 背景・問題

- city.tecoli は複数自治体に展開しうるポータルで、各 city に URL の入口が要る。
- 現状の入口 `/@hanno/` は素の cityname。`@` に技術的意味はなく、`src/pages/@hanno/` という固定ディレクトリ名にすぎない（city メタのフィールド名も `subdomain: '@hanno'`）。元は `/hanno/` で、`netlify.toml` の 301 により `@hanno` へ移行した経緯がある。
- 問題: **種別（市/町/村/県）・国コード・同名衝突への耐性がない**。`@kushiro` では釧路市か釧路町か区別できず、国際性もない。
- データ層は既に `idea:<city>:<slug>` という構造化 id を持つ（`src/lib/idea-seeds.ts`、`cities/hanno/config.yaml`）のに、**URL 入口だけが `@hanno` で不整合**だった。

---

## 2. 検討した「世界共通の都市コード」と不採用理由

| 標準 | 飯能の値 | 不採用理由 |
|---|---|---|
| UN/LOCODE | `JP HNC` | 貿易・物流地点中心で全自治体を網羅しない（未登録だと採番できない） |
| 全国地方公共団体コード（総務省） | `11209` | 全自治体一意だが非可読・日本限定 |
| ISO 3166-2 | `JP-11`（埼玉県まで） | 都道府県止まりで市町村がない |
| GeoNames ID / Wikidata QID | 数値 / Q番号 | 網羅的だが非可読 |

→ **「世界一意・人間可読・全自治体網羅」を 1 つで満たす標準は存在しない**（必ずどれかが犠牲になる）。

---

## 3. 採用方針: lg.jp ラベルに準ずる

- 日本の自治体は **lg.jp ドメイン**（地方公共団体専用、JPRS / J-LIS が管理）を持つ。形式は `<種別>.<値>.lg.jp`。
- 種別ラベル: `pref`(道府県) / `city`(市・特別区・東京都内の市) / `town`(町) / `vill`(村) / `metro`(都) / `union`(一部事務組合・広域連合)。
- **県名は原則省略**。同名重複時のみ後願（あとから申請した側）が県名をハイフンで前置する（先願優先）。
  - 例: 千葉県佐倉市 `city.sakura.lg.jp` / 栃木県さくら市 `city.tochigi-sakura.lg.jp`
- **値は種別をまたいで衝突しうる**。釧路市 `city.kushiro.lg.jp` と 釧路町 `town.kushiro.lg.jp` は隣接する別自治体で、**両者を分けるのは種別ラベルだけ**。したがって種別は捨てられない。
- 注意: lg.jp の `town` は、地域型 JP ドメイン（`town.町名.都道府県名.jp`、県名込み）とは**別物**。lg.jp の町は city と同じく県名省略が原則。
- 一意性は lg.jp 側が保証する（先願 + 県 prefix）。**city.tecoli は自前で slug を採番しない**。lg.jp 未取得の自治体は対象外とし、フォールバックは作らない（city.tecoli は展開先を自分で選ぶため）。

---

## 4. city ハンドル規約（確定）

```
city ハンドル = @<handle>
handle = [<2文字国コード>-]<lg.jpラベル値>[-<種別>]
```

- **国コード**: `jp` はデフォルトで省略。`jp` 以外のみ先頭に 2 文字の ISO 3166-1 alpha-2 を付ける。
  - 判定規則: **先頭のハイフン区切りトークンが 2 文字なら国コード**として扱う。
  - 根拠: 日本の市町村ローマ字は最短でも津市 `tsu`（3 文字）、県名も最短 `mie`（3 文字）で、**2 文字の市町村・県は存在しない**ため、国コードと自治体名が曖昧にならない。
- **lg.jp ラベル値**: 重複時の県 prefix を含む（`tochigi-sakura`）。
- **種別**: `city` は省略。`town` / `vill` / `pref` / `metro` / `union` のみ `-<種別>` の接尾辞で明示する。
- **設計思想**: lg.jp と同じ「**デフォルトは省略・例外だけ明示**」（`jp` を省略、`city` を省略）。多数派（日本・市）を無印にして短く保ち、少数派だけ明示する。

### 例

| ハンドル | 指す自治体 | 対応 lg.jp |
|---|---|---|
| `@hanno` | 飯能市 | `city.hanno.lg.jp` |
| `@kushiro` | 釧路市 | `city.kushiro.lg.jp` |
| `@kushiro-town` | 釧路町 | `town.kushiro.lg.jp` |
| `@saitama` | さいたま市 | `city.saitama.lg.jp` |
| `@saitama-pref` | 埼玉県 | `pref.saitama.lg.jp` |
| `@tochigi-sakura` | 栃木県さくら市（重複後願） | `city.tochigi-sakura.lg.jp` |
| `@fi-helsinki` | （将来）フィンランド・ヘルシンキ | — |

国際展開時は、`jp` 以外の国の名前空間（2 文字国コード以下の体系）を各国ごとに別途定義する。

---

## 5. 正準キー（任意）

必要に応じて、内部 canonical に**全国地方公共団体コード**（総務省、数値。飯能市 = `11209`）を併せ持ち、最終的な一意保証に使える。当面は handle ベースで運用する。

---

## 6. 既存 `@hanno` を変えないことの意味

- 本規約は **`@hanno` をそのまま温存できる**（`@hanno` は規約上「`jp` 省略・`city` 省略・`hanno`」に一致する）。
- 仮に `/@hanno/` を構造化体系へ全面移行すると、次に広く影響する（調査済み、~45 ファイル規模）:
  - PWA manifest の `scope` / `start_url`（変更すると**ホーム追加済みアプリが別アプリ扱い**になる）
  - `netlify.toml` の 301 リダイレクト群
  - 配布済みの招待リンク / QR / 購読 ICS
  - 内部リンクと `startsWith('/@hanno/')` 判定（`Layout.astro` ほか）
- → **規約を `@hanno` 互換に設計したことで、この大工事を回避している。**

---

## 7. idea ページ URL への帰結

idea には「city に属する idea」と「場所に依存しない idea」の2種があり、URL を分ける:

- **city idea**（例: 飯能市役所・Myはんのう）: **`/@hanno/ideas/<slug>/`**（city 配下）。定義は `cities/<city>/config.yaml` の `ideas:`、id は `idea:<city>:<slug>`。
- **場所非依存 idea**（例: 映画公開予定）: **`/ideas/<slug>/`**（city プレフィクスなし）。定義は `src/data/global-ideas.yaml`、id は `idea:global:<slug>`。**city の下には置かない**。
- day-card の地元セクション名タップは、idea が global なら `/ideas/`、city なら `/@hanno/ideas/` に振り分ける（`/api/events.json` が各 source に `idea_global` を付与）。
- 両ルートは表示を `src/components/EntityDetail.astro`、データ取得を `src/lib/entity/load.ts` (`loadEntity`) で shop と共有する（v1.46〜 の entity 統一。旧 `IdeaDetail.astro`/`idea-page.ts` は撤去）。

---

## 8. 将来課題（TODO）

- **場所非依存 idea**: 実装済み（`src/data/global-ideas.yaml` / `/ideas/<slug>/` / id `idea:global:<slug>`）。global idea 内で slug 一意性を保つ運用とする（複数の global idea が同名 slug を持たない）。
- **正準キーの導入判断**: 総務省コードを内部 canonical として実際に持たせるかは、多拠点運用が始まる段階で判断する。
- **国際名前空間の定義**: `jp` 以外の国を追加する際に、その国の自治体識別体系（各国の公的ドメイン／コード）への準拠方針を定める。

---

## 参考

- JPRS「JP LGドメイン名登録等に関する技術細則」 https://jprs.jp/doc/rule/saisoku-1-lgjp.html
- J-LIS「LG.JPドメイン名について」 https://www.j-lis.go.jp/lgwan/lgjp/summary/cms_15365140.html
- 総務省「全国地方公共団体コード」 https://www.soumu.go.jp/denshijiti/code.html
