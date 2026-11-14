# Changelog

All notable changes to the Kanban mod. Dates are when the change was made.

## Unreleased

## 0.3.0 — 2026-11-14

### New

- **Column history.** Every card logs when it changes column: created, moved (drag, ‹ ›,
  Shift + ← →, the column chips), archived (by hand or by itself) and restored. An open card
  shows a History section, newest first ("14 Nov 09:32 · To do → Doing"), and how many days
  it has been in its column. Cards from before this version start their log the first time a
  board opens ("tracking started").
- **Stale cards.** A card that has spent 7 days or more (`STALE_AFTER`) in the same column
  gets a dashed `ansi6` (cyan) border, a faint cyan background and a "⏳ 9d here" badge. Due
  colors keep the border and background when they apply. Cards in Done or Archive columns are
  never stale. From 3 days (`QUIET_AFTER`) a card shows its days in the column in grey
  ("5d") before it turns cyan at 7.
- **More keys** on the selected card: `1` `2` `3` set High / Normal / Low, `t` due today, `w`
  due in a week, `d` clears the due date, `e` renames it in place, and `u` restores the last
  card archived from this board (several times to go further back). The `?` strip lists them.

### Changed

- "Delete forever" in the archive asks first: the button turns into a red "Really delete?"
  for 4 seconds, and only a second click deletes.

## 0.2.0 — 2026-11-13

### New

- **Link a card to a tab.** In an open card, "Link a tab…" lists every tab, grouped by space,
  with its agent status. The linked card shows that tab's status live on the board (working,
  needs you, done, idle), and clicking it goes to the tab, switching space if needed. "Go to
  tab", "Change" and "Unlink" are in the card's Tab row. A closed tab shows as "(closed)".
- **Labels.** The board has its own colored labels (bug, feature, homelab and idea to start).
  Toggle them in an open card's Labels row, where "+ Label" makes a new one (Enter; it takes the
  next color) and × deletes a label no card uses. Cards show their labels as pills above the
  title. The header has a filter with one button per label in use: click one to show only its
  cards ("2 of 5 cards"), click it again to show them all.
- **Search.** A box in the header that keeps only the cards matching every word typed. It
  looks in the title, description, tasks, labels and linked tab name. It combines with the
  label filter. × or Esc clears it.
- **Priority.** Low, Normal or High in an open card's Priority row. High cards get a magenta
  (`ansi5`) stripe down their left edge and a "▲ High" badge, low ones a grey stripe and "▼
  Low". In each column, high cards show first and low cards last. Within a priority, cards keep
  the order you put them in.
- **Keyboard.** Click the board (or reach it with `pane.go`: the mod is now `focusable`), then:
  arrows or h j k l select a card (2 px accent border), Enter opens it, Shift + ← → moves it to
  the next column, Shift + ↑ ↓ moves it up or down (within its priority), n adds a card to the
  selected card's column, / jumps to search, x or Delete deletes it, and Esc clears the
  selection, the search or an input. `?` (or the ? button in the header) shows the keys.
- **Archive.** Cards are archived instead of deleted: × on a card, x or Delete, and "Archive
  card" in an open card all move it to the archive. Cards that have been in a Done or Archive
  column for 14 days are archived on their own (cards already there count from the day this
  version first runs). The header's "Archive" button (with a count) shows the archive, newest
  first, filtered by the search and labels. Each archived card shows where it came from and
  when, with "Restore", which puts it back at the end of that column, and "Delete forever".
- **Due cards in the status bar.** The same mod with `props {status: true}` is a status-bar
  block: "1 overdue · 2 due today", red when anything is overdue, yellow when something is
  due today, "nothing due" otherwise. Clicking it shows the space's Kanban tab, or opens one.
  Cards in Done or Archive columns don't count.
- **Morning notification.** Once a day, from 8:00 (local), a notification lists what's overdue
  or due today, with the first four titles. Clicking it opens a Kanban tab. Whichever copy
  (board or status bar) checks first sends it; shared state (`kanban.notified.<board>`)
  remembers the day, so only one goes out.

### Changed

- Removing a card no longer deletes it; see Archive. "Delete card" in an open card is now
  "Archive card".
- The header keeps its title, count and "+ Column" button at full size in a narrow window; the
  label filter takes the leftover space and scrolls sideways.

## 0.1.0 — 2026-11-13

### New

- **Board in its own tab.** `tab.new {name: "Kanban", mod: "kanban"}` (or `ctrl-shift-m` with
  `keys.json`) opens To do / Doing / Done. The board is kept in Herdr's shared state, so every
  open copy shows the same cards and they survive restarts.
- **Cards.** Add with "+ Add card" (Enter adds the next one too), drag between columns or onto
  another card, move with ‹ ›, delete with ×.
- **Columns.** Add, rename (click the name), remove when empty, and reorder by dragging the ⠿
  grip or with ‹ ›.
- **Open card.** Clicking a card opens it as a dialog: title, column, due date, description and a
  task list.
- **Task list.** Add with Enter, tick, click to edit, × to remove, reorder with the ⠿ grip or ↑ ↓.
  The board card shows `☑ done/total`.
- **Due dates.** Today, Tomorrow, In a week, or Pick… from a month calendar. Cards turn red when
  overdue, yellow when due today or tomorrow, and blue within a week. Cards in a Done or Archive
  column don't warn.
- **Descriptions.** A text box in the open card, with the first ~90 characters shown on the
  board.
