# dream-believers-intro-quiz

Dream Believers のバージョン違いをイントロで聴き当てる Web クイズ。
計 10 問を答え切るまでの時間を競い、グローバルランキングに登録できる。

- インフラ: Cloudflare Workers(Hono)+ R2(音声)+ D1(セッション/ランキング)
- フロントエンド: React 19 + Vite + Tailwind CSS 4 + `@suki-suki-club/link-like-ui`
- 音声は 5 秒セグメントの時計ゲート配信で、開発者ツールから先の音声を取得できない設計

設計ドキュメント: [docs/plans/2026-07-19-dream-believers-intro-quiz-design.md](docs/plans/2026-07-19-dream-believers-intro-quiz-design.md)

音源データ・正解マッピング・生成スクリプトはリポジトリに含まれない。
