# LLR Calendar Import

Import events from calendar ICS URLs into your Obsidian daily note as [LLR (Live Life Recording)](https://github.com/goryugocast/llr) task lines, placed under the matching time-of-day section.

```markdown
## 朝
- [ ] 09:00 Weekly meeting (30m)
## 昼
- [ ] 13:00 Dentist (60m)
```

This is an independent plugin. It is not affiliated with LLR and does not depend on its code; it only writes lines in LLR's task syntax.

## Features

- **One-way, read-only**: calendar → Obsidian. Nothing is written back to your calendar.
- **Section placement**: each event goes under the daily-note heading of the section its start time belongs to, in time order. Existing lines are never reordered or modified.
- **Import sections from LLR**: copy LLR's *Routine Sections* into this plugin with one button.
- **Idempotent**: running the command again does not duplicate lines, even after you start/finish them with LLR.
- **Changed events**: if an event's time or title changes, the new version is appended as a new line; the old line is kept for you to remove.
- **Recurring events**: RRULE / EXDATE / RECURRENCE-ID handled, with time zones (TZID, UTC, floating).
- **Day boundary**: events before the boundary (default 04:00) belong to the previous day's note.
- **Filters**: cancelled events, declined invitations, keywords and (optionally) all-day events.
- **Desktop and mobile**.

## Usage

1. Open **Settings → LLR Calendar Import**.
2. Add a calendar and paste its ICS URL (for Google Calendar: *Settings and sharing → Integrate calendar → Secret address in iCal format*).
3. Set up sections: press **Import from LLR**, or enter start time + heading label (e.g. `05:00` / `朝` for `## 朝`).
4. Run a command from the command palette:
   - **Insert today's events**
   - **Insert events for a date…**

Tip: run LLR's *Insert Routine* first so that section headings exist. Events whose section heading is missing go under the fallback heading (default `## Calendar`).

## Privacy and security

- A private ICS URL works like a password: anyone with it can read your calendar (read-only). You can reset it in Google Calendar at any time.
- For each calendar you choose where the URL is stored:
  - **This device only** (Obsidian SecretStorage, Obsidian ≥ 1.11.4): not synced; enter it once on each device.
  - **Synced** (plugin `data.json`): available on all devices through Obsidian Sync etc., but stored as plain text on every device and in backups.
- URLs are never written to notices or logs. The plugin only contacts the URLs you configure; there is no telemetry.

## Development

```bash
npm install
npm run dev      # watch build → main.js
npm test         # vitest
npm run build    # typecheck + production build
```

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/llr-calendar-import/` to try it.

Releases: bump `version` in `manifest.json`, `package.json` and `versions.json`, then push a tag equal to the version (e.g. `0.1.0`). GitHub Actions builds and creates a draft release with `main.js`, `manifest.json` and `styles.css`.

For the full release and community-directory submission procedure (and how it differs from older guides), see [`docs/releasing.md`](docs/releasing.md) (Japanese).

Design notes and requirements: [`docs/requirements.md`](docs/requirements.md) (Japanese).

## License

[MIT](LICENSE). Bundles [ical.js](https://github.com/kewisch/ical.js) (MPL-2.0); see [NOTICE.md](NOTICE.md).

---

## 日本語

カレンダー(ICS URL)の予定を、LLR の記法(`- [ ] HH:mm タイトル (30m)`)でデイリーノートの時間帯セクション(`## 朝` など)に振り分けて挿入する Obsidian プラグインです。LLR 本体とは独立しています。

- 設定で ICS URL とセクションを登録します。セクションは「LLR から読み込む」ボタンで LLR の設定からコピーできます
- コマンド「今日の予定を挿入」「日付を指定して予定を挿入」で実行します
- 何度実行しても重複しません。予定の変更は新しい行として追記されます
- URL の保存先は、カレンダーごとに「この端末のみ(同期されない)」か「同期する(data.json に平文)」を選べます
