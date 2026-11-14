# herdr-kanban

A [Herdr](https://herdr.dev) mod: [`kanban`](kanban/RECIPE.md).

A Kanban board in its own tab. Columns of cards, which you drag between columns or move with
‹ › or the keyboard. Click a card to open it: title, column, priority, labels, due date, a
linked tab, description and a task list. Cards turn red when overdue, yellow when due today or
tomorrow, and blue when due within the week. A card linked to a tab shows that tab's agent
status live (working, needs you, done). Each card logs when it changes column, and cards that sit still show their days in the column (grey from 3 days, cyan from 7). Search and a label filter narrow the board. Removed and
old Done cards go to an archive you can restore from. A status-bar block and a morning
notification tell you what's due. See [CHANGELOG.md](CHANGELOG.md).

![Kanban](kanban/preview.png)

## Install

Ask an agent in Herdr to add `https://github.com/enexolgort/herdr-kanban/tree/main/kanban`,
or by hand:

1. Copy `kanban/mods/kanban` to `~/.config/herdr-app/mods/`, the whole folder at once (so
   `mod.json`, which says `"place": "none"`, is there when Herdr first sees it).
2. Merge `kanban/keys.json` into your `~/.config/herdr-app/keys.json`: `ctrl-shift-m` opens a
   Kanban tab. Or run `herdr-app do tab.new --name Kanban --mod kanban`.
3. Optional, due cards in your status bar: add this block to the status bar row of your layout
   (a clone, not a shipped one):
   `{ "id": "statusbar-kanban", "type": "block", "content": { "mod": "kanban", "props": { "status": true } }, "size": { "px": 150 } }`
4. Run `herdr-app check ~/.config/herdr-app/mods/kanban`.

To give it a button in your tab bar that reuses the space's Kanban tab instead of opening a new
one each time, see [Tab bar button](kanban/RECIPE.md#tab-bar-button).

## What it runs

Nothing. No programs, no network access, and it reads no files. The board is kept in Herdr's
shared state (`kanban.board.main` in `~/.config/herdr-app/shared.json`, and
`kanban.notified.main` for the day of the last morning notification). It runs app commands
only when you act: `tab.select` / `space.select` to go to a linked tab, and `tab.new` /
`pane.focus` to open the board.

## License

Apache-2.0 (see `LICENSE`).
