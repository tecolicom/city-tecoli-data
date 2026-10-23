# city-tecoli-data

[city.tecoli.com](https://city.tecoli.com) で使う、**都市（自治体）に依存しないデータ**の置き場。
都市固有データ（飯能市など）は別リポジトリ（`hanno-data` 等）で管理する。

アプリ本体（city-tecoli, private）はここから必要なファイルを **コピー（ベンダリング）** して使う。
このリポジトリは生成ツール・元データ・公開ドキュメントの「真実の源」。

## 収録データ

### `municipalities/` — 全国自治体レジストリ
全国 47 都道府県の市区町村（lg.jp 取得済み）を、idea/暦体の名前空間 `handle` 付きで一覧化。

| ファイル | 内容 |
|---|---|
| `municipalities.yaml` | 生成物。`code`(団体コード) / `handle` / `name_ja` / `yomi` / `type` / `lat` / `lng` / `website`(公式サイト URL。出典に無ければ `null`) |
| `build.mjs` | 生成ツール（Node, `unzip`・`whois` を使う）。`node municipalities/build.mjs` |
| `whois-cache.json` | JPRS WHOIS の確定結果キャッシュ（再生成を高速・再現可能に） |

- **権威 = lg.jp ドメイン**（JPRS WHOIS で実在＋組織名を確認）。一意性を保証する唯一の空間。
- `handle` は [docs/city-identifier-url-scheme.md](docs/city-identifier-url-scheme.md) の規約（lg.jp ラベル準拠、city 無印・town/vill/pref は接尾辞）。
- 1,786 件（全国の独立自治体ほぼ全数。lg.jp 未取得の 2 件のみ対象外）。

## 出典・ライセンス

- **市区町村ローマ字**: 日本郵便「郵便番号データ（ローマ字）」KEN_ALL_ROME（再配布可）
- **団体コード・緯度経度・公式 URL**: [code4fukui/localgovjp](https://github.com/code4fukui/localgovjp)（CC0、出典 国土地理院）
- **lg.jp 登録情報**: JPRS WHOIS（公開登録情報）

データ（生成物）は **CC0 1.0** で提供する（[LICENSE](LICENSE)）。

## 再生成

```sh
node municipalities/build.mjs   # KEN_ALL_ROME 取得 + WHOIS 確認(キャッシュ利用) → municipalities.yaml
```

JPRS WHOIS はレート制限があるため、全国の初回はキャッシュが無いと数十分かかる。
`whois-cache.json` をコミットしてあるので、以降の再生成は確定分をスキップして速い。
