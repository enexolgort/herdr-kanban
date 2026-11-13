# Kanban

A Kanban board that opens as its own tab: columns of cards you drag around. Click a card to open
it as a dialog with its title, column, due date, description and a task list. Cards take a color
from their due date.

![Kanban](preview.png)

## What you see

- **Header** (44 px, bottom border `border`): `kanban.svg` (three bars) in `muted`, "Kanban" in
  14 px semibold, `N cards` in 12 px `dim`, then a "+ Column" button on the right (28 px, 1 px
  `border`, hover `hover`). While dragging, a hint takes the middle: "Release over a column or
  card to move" (or "…another column to put this one there").
- **Board**: columns side by side, 272 px wide, 12 px apart, 14 px padding. Each column is a
  `surface` card (10 px radius, 1 px `border`):
  - header (26 px): a `⠿` grip (`dim`, grab cursor), the name in 12.5 px semibold, a count pill
    (`hover` background, 11 px `muted`), ‹ › to move the column one place (not shown at the
    ends), and × when the column is empty and isn't the last one;
  - the cards, 6 px apart;
  - "+ Add card" (12 px `dim`, hover `hover`).
- **Card** (`raised`, 8 px radius, 1 px `border`, 9 px padding): the title in 12.8 px
  `foreground`; up to ~90 characters of the description in 11.8 px `muted`; then a row with the
  due badge (`📅 Due tomorrow`, `📅 17 Nov · 4 days`, `📅 Overdue · 2 days`), a task count
  (`☑ 1/3`, on `selected` once all are done), and ‹ › × on the right.
- **Due colors**, by days left (the computer's local date):
  - overdue: `ansi1` (red);
  - today or tomorrow: `ansi3` (yellow);
  - 2 to 7 days: `ansi4` (blue);
  - later, or no date: plain.

  A colored card has that color as its border and as its background at alpha `26` (hex), with
  the badge at `40`. Cards in a column named Done, Archive or Archived never warn: they show the
  plain date.
- **Open card**: a dialog, 540 × 660, `popover` background:
  - top section: "Card" / "Esc" labels, then the title in a 36 px input (15 px semibold);
  - a chip for each column, with the current one in `accent`/`selected`;
  - the Due row: Today, Tomorrow, In a week, Pick… (shows the date when it is none of those),
    the urgency label in its color, and Clear. Pick… opens a month grid under it (252 px,
    ‹ month year ›, M–S headings, the chosen day filled `accent`, today outlined `accent`, other
    months' days `dim`);
  - a scrolling body: "Description", a text area that grows from 3 to 12 rows; "Tasks" with
    `done/total` and a 160 px progress bar (`accent` on `hover`); one row per task (⠿ grip, a
    16 px checkbox, filled `accent` with ✓ when done, the text struck through and `dim` when
    done, ↑ ↓, ×); then an "Add a task, Enter to add" input;
  - footer: "Delete card" (in `blocked`) on the left, "Close" on the right.

## How it behaves

- Opening: `tab.new {name: "Kanban", mod: "kanban"}`. Every copy shows the same board and
  updates live. `props {board: "name"}` opens another board (`kanban.board.<name>`).
- Cards: "+ Add card" turns into an input; Enter adds a card and keeps the input open for the
  next one; Esc, or clicking away with it empty, closes it. Press on a card and release over
  another column (goes to the end) or another card (goes before it) to move it; ‹ › move it one
  column; × deletes it. A click that isn't a drag opens the card.
- Columns: click a name to rename it (Enter or clicking away saves); "+ Column" adds one at the
  end; drag the ⠿ grip onto another column to take its place, or use ‹ ›.
- Open card: the title saves on Enter or blur; column chips move the card; Today, Tomorrow and
  In a week set the date, a day in the grid sets it and closes the grid, and Clear removes it.
  The description saves as you type. Enter in the task input adds a task and clears the input.
  Click the box to tick a task. Click the text to edit it (Enter or blur saves; emptying it
  removes the task). Drag the ⠿ grip onto another task to take its place, or use ↑ ↓. Esc
  closes the dialog. If the card is deleted elsewhere, the dialog says so.
- Due colors re-check every 10 minutes, so they move at midnight without any other change.

## Built from

- One mod, `mods/kanban` (`main.js`, `mod.json` `{ "place": "none", "title": "Kanban" }`,
  `kanban.svg`). The board and the open card are the same view class: with `props().open` it
  renders the dialog, otherwise the board. A card opens with
  `openOverlay({ mod: "kanban", kind: "dialog", width: 540, height: 660, props: { board, open: cardId } })`.
- State: `shared("kanban.board.<name>")` / `setShared`. The value is
  `{ columns: [{ id, name, cards: [{ id, title, description?, due?: "YYYY-MM-DD", tasks?: [{ id, text, done }] }] }] }`,
  seeded with To do / Doing / Done. Every change clones the board, edits it and sets it again.
- gpui-base: `InputState` + `Input` (one at a time on the board, re-created for each edit),
  `TextareaState` + `Textarea` (`set_auto_grow(3, 12)`), `CalendarState`
  (`month_days()[0]`, `prev_month` / `next_month`, drawn by hand).
- Dragging is press/release: `on_mouse_down` on a card or grip records it, `on_mouse_up` on the
  target drops it, `on_hover` marks the target, and the root's `on_mouse_up` cancels.
- `cx.timer.every(600000)` for the date roll-over (board only).

## Tab bar button

The keys.json binding opens a new tab on every press. For a button in a cloned tab bar that
shows the space's Kanban tab when there is one (as the shipped Insights button does), add this
to its `render()`:

```js
const tabIds = new Set(space?.tabs.map(tb => tb.id) ?? []);
const kanban = panes().find(p => p.mod === "kanban" && tabIds.has(p.tab));
this.openKanban = () => {
  if (!kanban) return run("tab.new", { name: "Kanban", mod: "kanban" });
  const zoomed = panes().find(p => p.tab === kanban.tab && p.zoomed);
  if (zoomed && zoomed.pane !== kanban.pane) run("pane.zoom", { pane: zoomed.pane });
  run("pane.focus", { pane: kanban.pane });
};
```

and a button that calls `this.openKanban()` with `svg("mods/kanban/kanban.svg")`. To reach it
from a key, handle `"kanban"` from `nextCommand()` in the tab bar and bind
`"ctrl-shift-m": "<tab bar mod>.kanban"`.

## Watch out

- A scroll area (`overflow_y_scrollbar()`) inside a column sized to its content gets 0 px of
  height and hides every card. The columns have no scroll area of their own: the whole board
  scrolls down and sideways instead.
- There is no `line_clamp`: the description preview is cut by length.
- `InputState`, `TextareaState` and `CalendarState` must be created in `init` or a handler,
  never in `render`.
- A `blur` from an input that has already been replaced must be ignored: each handler checks
  that its input is still the current one.
- `flex_shrink()` needs an argument.
- `herdr-app check` renders only the board with empty shared state. The dialog, the due colors
  and descriptions run only in the app.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/kanban` passes.
- `herdr-app do tab.new --name Kanban --mod kanban` shows To do / Doing / Done.
- An added card shows in its column and is still there after a restart.
- A card dropped on another column moves there. A column dropped by its grip on another
  takes that column's place.
- Clicking a card opens the dialog. A task added there shows `☑ 0/1` on the board card, and
  ticking it makes `1/1`.
- Tomorrow turns the card yellow. A date in the past turns it red, except in Done.
- A description shows under the card's title on the board.
