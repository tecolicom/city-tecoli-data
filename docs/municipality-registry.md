# 全国自治体レジストリ — データ仕様

`municipalities/municipalities.yaml` の仕様と作り方。

## フィールド

```yaml
- code: "11209"        # 全国地方公共団体コード (5桁, 総務省)
  handle: hanno        # idea/暦体の city slug (一意, lg.jp ラベル由来)
  name_ja: 飯能市
  yomi: "はんのうし"   # かな読み (五十音ピッカー用, 日本郵便/localgovjp 由来)
  type: city           # pref / city / town / vill
  lat: 35.85583333
  lng: 139.3277778
```

## handle の決め方（権威 = lg.jp）

- **lg.jp ドメインが唯一の権威**。地方公共団体専用で、レジストリが一意性を保証する
  （地域型/都道府県型/汎用 .jp は官民共用で一意性を担保しない）。
- 各自治体について JPRS WHOIS で `<type>.<label>.lg.jp` の存在＋組織名一致を確認し、
  その `<label>` を handle にする。確認できない自治体は対象外。
- 命名規約は [city-identifier-url-scheme.md](city-identifier-url-scheme.md):
  city は無印、town/vill/pref は `-<種別>` を接尾。同名衝突は lg.jp 側が県 prefix で解決済み
  （例 江差/枝幸＝ともに esashi → 江差は `hokkaido-esashi.jp` を使用）。

## 綴り候補の出し方（WHOIS クエリ用の参考）

handle の綴りは lg.jp が権威だが、WHOIS は「ドメイン→組織」しか引けないため、
候補ラベルを当ててから確認する。候補は: ① website ラベル ② 日本郵便ローマ字
③ 県名つき。Japan Post ローマ字は**参考**であり権威ではない（同名を区別しない）。

## 既知の対象外（一次対応）

lg.jp 未取得で独自 .jp のみの自治体は対象外:
- 北海道 江差町（`hokkaido-esashi.jp`）
- 北海道 枝幸町（`esashi.jp`）

これらは lg.jp を取得すれば再生成で自動的に入る。

## WHOIS org 書式の注意（実装メモ）

JPRS の組織名は書式が不統一: `飯能市` / `神奈川県茅ヶ崎市` / `宮城県宮城郡利府町` /
`御代田町役場` / `能美市役所` / `遠　別　町`（全角空白）等。照合は「空白除去で名前を含む
かつ org が県名を含むなら当該県を含む」とし、同名異県（広島府中 vs 東京府中）を弾く。
