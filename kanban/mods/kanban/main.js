// Kanban: a board of columns and cards, opened as its own tab
// (tab.new {name: "Kanban", mod: "kanban"}). The board lives in shared state
// (`kanban.board.<name>`, saved in shared.json), so every open copy shows the same
// cards and they survive restarts. props {board: "name"} opens another board.
//
// Cards: "+ Add card" under a column (Enter adds, Esc stops), click a card to open it,
// drag it (press, release over a column or a card) or use ‹ › to move it, × deletes.
// Columns: "+ Column" adds one, click a title to rename it, drag the ⠿ grip or use its ‹ › to
// reorder them, × removes an empty one. Cards with a due date take a color: red overdue,
// yellow today or tomorrow, blue within a week (not in a Done or Archive column).
//
// An open card is this same mod as a dialog, props {board, open: <card id>}: its title,
// its column, its due date, a description, and a task list (tick, click to edit, × to remove,
// Enter adds the next, drag the ⠿ grip or ↑ ↓ to reorder).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, CalendarState } from "gpui-base";
import { theme, props, shared, setShared, openOverlay, closeOverlay, spaces, panes, run, nextCommand, notify } from "herdr";

const DEFAULT = {
  columns: [
    { id: "todo", name: "To do", cards: [] },
    { id: "doing", name: "Doing", cards: [] },
    { id: "done", name: "Done", cards: [] },
  ],
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---- Due dates: "YYYY-MM-DD", this computer's local day ----
const DAY = 86400000;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => iso(new Date());
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const daysLeft = (due) => Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / DAY);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (due) => `${Number(due.slice(8))} ${MONTHS[Number(due.slice(5, 7)) - 1]}`;
/** "14 Nov 09:32" for a timestamp (ms), local time. */
const when = (ms) => { const d = new Date(ms); return `${short(iso(d))} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

// ---- History: each card logs when it changed column ({ at: ms, from?, to, auto? }, names) ----
function logMove(card, from, to, auto = false) {
  (card.history ??= []).push({ at: Date.now(), ...(from ? { from } : {}), to, ...(auto ? { auto: true } : {}) });
}

// ---- Stale: a card that has sat STALE_AFTER days or more in the same (unfinished) column ----
const STALE_AFTER = 7;
const QUIET_AFTER = 3; // from here a card shows its days in the column in grey ("5d"), cyan once stale
/** Whole days (local calendar) the card has been in its column, or null when unknown. */
function daysInColumn(card) {
  const last = card.history?.[card.history.length - 1];
  return last ? -daysLeft(iso(new Date(last.at))) : null;
}
const stale = (card, col) => !finished(col) && (daysInColumn(card) ?? 0) >= STALE_AFTER;

// Columns whose cards are finished: their due dates no longer warn.
const finished = (col) => /^(done|archive|archived)$/i.test(col.name.trim());

/** How urgent a due date is: { color (theme name, null for calm), label }. */
function urgency(due, col) {
  if (!due) return null;
  const n = daysLeft(due);
  if (finished(col)) return { color: null, label: short(due) };
  if (n < 0) return { color: "ansi1", label: n === -1 ? "Overdue · yesterday" : `Overdue · ${-n} days` };
  if (n === 0) return { color: "ansi3", label: "Due today" };
  if (n === 1) return { color: "ansi3", label: "Due tomorrow" };
  if (n <= 7) return { color: "ansi4", label: `Due ${short(due)} · ${n} days` };
  return { color: null, label: `Due ${short(due)}` };
}

// ---- Labels: the board's own list ({id, name, color}), each card keeps label ids ----
const LABEL_COLORS = ["ansi1", "ansi3", "ansi2", "ansi6", "ansi4", "ansi5"];
const DEFAULT_LABELS = [
  { id: "bug", name: "bug", color: "ansi1" },
  { id: "feature", name: "feature", color: "ansi4" },
  { id: "homelab", name: "homelab", color: "ansi2" },
  { id: "idea", name: "idea", color: "ansi5" },
];
const boardLabels = (b) => b.labels ?? DEFAULT_LABELS;

/** A small colored label pill. */
function pill(t, label, size = 10.5) {
  const c = t[label.color] ?? t.muted;
  return div().px(6).rounded(5).text_size(size).bg(tint(c, "33")).text_color(c).child(label.name);
}

// ---- Due today / overdue: the status bar block and the morning notification ----
const MORNING = 8; // the notification goes out from this hour (local), once a day

/** Cards on the board that are overdue or due today (not in a finished column). */
function dueNow(b) {
  const out = { overdue: [], today: [] };
  for (const col of b.columns) {
    if (finished(col)) continue;
    for (const c of col.cards) {
      if (!c.due) continue;
      const n = daysLeft(c.due);
      if (n < 0) out.overdue.push(c); else if (n === 0) out.today.push(c);
    }
  }
  return out;
}

/** "2 overdue · 1 due today", or "" when nothing is. */
function dueText({ overdue, today: tod }) {
  return [overdue.length && `${overdue.length} overdue`, tod.length && `${tod.length} due today`].filter(Boolean).join(" · ");
}

/** Shows the space's Kanban tab, or opens one (like the tab bar's Insights button). */
function openBoard(board) {
  const space = spaces().find((s) => s.active);
  const ids = new Set(space?.tabs.map((x) => x.id) ?? []);
  const open = panes().find((p) => p.mod === "kanban" && ids.has(p.tab));
  if (!open) return run("tab.new", { name: "Kanban", mod: "kanban", ...(board && board !== "main" ? { props: { board } } : {}) });
  const zoomed = panes().find((p) => p.tab === open.tab && p.zoomed);
  if (zoomed && zoomed.pane !== open.pane) run("pane.zoom", { pane: zoomed.pane });
  run("pane.focus", { pane: open.pane });
}

// ---- Archive ----
const ARCHIVE_AFTER = 14; // days a card stays in a Done/Archive column before it's archived

/** Moves a card from its column into b.archive, remembering where it was. */
function archiveCard(b, cardId, auto = false) {
  for (const col of b.columns) {
    const i = col.cards.findIndex((x) => x.id === cardId);
    if (i < 0) continue;
    const card = col.cards.splice(i, 1)[0];
    logMove(card, col.name, "Archive", auto);
    b.archive = [{ ...card, archivedAt: today(), from: col.id, fromName: col.name, ...(auto ? { auto: true } : {}) }, ...(b.archive ?? [])];
    return;
  }
}

// ---- Priority: "high", "low", or none (normal). High cards show first in their column ----
const PRIORITY = {
  high: { label: "High", mark: "▲", color: "ansi5", rank: 0 },
  low: { label: "Low", mark: "▼", color: "dim", rank: 2 },
};
const rank = (card) => PRIORITY[card.priority]?.rank ?? 1;

// ---- Linked tabs: a card can point at a tab and show its agents' status ----
const STATUS_LABEL = { working: "working", blocked: "needs you", done: "done", idle: "idle" };

/** A tab's name as the tab bar shows it: its own, else its agent's, else its position. */
function tabLabel(tab) {
  if (tab.named) return tab.name;
  const p = panes().find((x) => x.tab === tab.id && x.program?.agent) ?? panes().find((x) => x.tab === tab.id);
  return p?.mod ? p.title : p?.program?.name ?? `Tab ${tab.index}`;
}

/** The space and tab a link points at, or null when that tab is gone. */
function linked(link) {
  if (!link) return null;
  for (const space of spaces()) {
    const tab = space.tabs.find((x) => x.id === link.tab);
    if (tab) return { space, tab };
  }
  return null;
}

function goToTab(link) {
  const l = linked(link);
  if (!l) return;
  if (!l.space.active) run("space.select", { id: l.space.id });
  run("tab.select", { id: l.tab.id });
}

/** A theme color with an alpha, for tinted card backgrounds. */
function tint(color, alpha) {
  return /^#[0-9a-f]{6}$/i.test(color ?? "") ? color + alpha : color;
}

export default class Kanban extends View {
  init(_props, cx) {
    this.boardName = props()?.board ?? "main";
    this.key = `kanban.board.${this.boardName}`;
    this.edit = null; // { kind: "add" | "card" | "column" | "new-column", column, card }
    this.drag = null; // { card, from }
    this.over = null; // column id under a drag
    this.input = null;
    this.handle = cx.focus_handle();
    if (!shared(this.key)) setShared(this.key, DEFAULT);
    this.open = props()?.open ?? null;
    this.status = Boolean(props()?.status);
    if (this.open) this.initDetail();
    else if (this.status) this.initStatus(cx);
    else this.initBoard(cx);
  }

  // ---- Status bar block (props {status: true}) ----

  initStatus(cx) {
    this.morning();
    cx.timer.every(600000, (cx) => { this.morning(); cx.notify(); });
  }

  /** Once a day, from MORNING on: a notification of what's overdue or due today. Whichever copy
   *  (board or status bar) looks first sends it; shared state remembers the day. */
  morning() {
    const now = new Date(), key = `kanban.notified.${this.boardName}`;
    if (now.getHours() < MORNING || shared(key) === today()) return;
    setShared(key, today());
    const due = dueNow(this.board()), cards = [...due.overdue, ...due.today];
    if (!cards.length) return;
    notify({
      title: `Kanban: ${dueText(due)}`,
      body: cards.slice(0, 4).map((c) => c.title).join(" · ") + (cards.length > 4 ? ` +${cards.length - 4}` : ""),
      level: due.overdue.length ? "warning" : "info",
      action: { name: "tab.new", args: { name: "Kanban", mod: "kanban" } },
    });
  }

  renderStatus(t) {
    const due = dueNow(this.board()), text = dueText(due);
    const color = due.overdue.length ? t.ansi1 : due.today.length ? t.ansi3 : t.dim;
    return h_flex().id("kanban-status").size_full().px(10).gap(6).items_center().justify_center()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => openBoard(this.boardName))
      .child(svg("mods/kanban/kanban.svg").flex_none().size(13).text_color(text ? color : t.dim))
      .child(div().truncate().text_color(text ? color : t.dim).child(text || "nothing due"));
  }

  initBoard(cx) {
    // Due colors move at midnight: look again every 10 minutes.
    // The same timer archives Done cards that have waited ARCHIVE_AFTER days (and once now). Cards
    // already in Done without a date get today's, so nothing is archived on the first run.
    // Cards from before the history log start theirs now (so they can't be stale on day one).
    const tick = () => {
      const b = this.board();
      if (b.columns.some((col) => col.cards.some((c) => !c.history?.length))) {
        this.save((bb) => { for (const col of bb.columns) for (const c of col.cards) if (!c.history?.length) c.history = [{ at: Date.now(), to: col.name, start: true }]; });
      }
      if (b.columns.some((col) => finished(col) && col.cards.some((c) => !c.doneAt))) this.save(() => {});
      this.sweep();
      this.morning();
    };
    tick();
    cx.timer.every(600000, (cx) => { tick(); if (this.day !== today()) cx.notify(); });
    // Search: every word must appear in the card (title, description, tasks, labels, linked tab).
    this.query = "";
    this.search = InputState.new({ placeholder: "Search" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); cx.notify(); });
    this.search.on("focus", (_e, cx) => { this.searching = true; cx.notify(); });
    this.search.on("blur", (_e, cx) => { this.searching = false; cx.notify(); });
    // Keyboard: the board takes the keys once clicked, or when pane.go lands on it (mod.json focusable).
    this.sel = null;
    this.showKeys = false;
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        cx.notify();
      }
    });
  }

  /** Everything a search looks in, lowercased. */
  haystack(card, b) {
    const byId = new Map(boardLabels(b).map((l) => [l.id, l.name]));
    return [card.title, card.description, ...(card.tasks ?? []).map((x) => x.text),
      ...(card.labels ?? []).map((id) => byId.get(id)), card.link?.name].filter(Boolean).join("\n").toLowerCase();
  }

  // ---- An open card (dialog) ----

  initDetail() {
    const found = this.find(this.open);
    this.title = InputState.new({ placeholder: "Card title", value: found?.card.title ?? "" });
    const saveTitle = () => {
      const text = this.title.value().trim();
      if (text) this.updateCard((c) => { c.title = text; });
    };
    this.title.on("submit", () => { saveTitle(); this.task.focus(); });
    this.title.on("blur", () => saveTitle());
    this.task = InputState.new({ placeholder: "Add a task, Enter to add" });
    this.task.on("submit", (_e, cx) => {
      const text = this.task.value().trim();
      if (text) this.updateCard((c) => { (c.tasks ??= []).push({ id: uid(), text, done: false }); });
      this.task.set_value("");
      cx.notify();
    });
    this.taskEdit = null; // { id, input }
    this.taskDrag = null; this.taskOver = null;
    // The description saves as it's typed (an empty one is removed).
    this.desc = TextareaState.new({ placeholder: "Add a description…", value: found?.card.description ?? "" });
    this.desc.set_auto_grow(3, 12);
    this.desc.on("change", () => {
      const text = this.desc.value().replace(/\s+$/, "");
      this.updateCard((c) => { if (text) c.description = text; else delete c.description; });
    });
    this.picking = false;
    this.linking = false;
    // A new label: Enter makes it (next color in turn) and puts it on this card.
    this.addingLabel = false;
    this.newLabel = InputState.new({ placeholder: "Label name" });
    this.newLabel.on("submit", (_e, cx) => {
      const name = this.newLabel.value().trim();
      if (name) {
        this.save((b) => {
          const all = boardLabels(b);
          let l = all.find((x) => x.name.toLowerCase() === name.toLowerCase());
          if (!l) { l = { id: uid(), name, color: LABEL_COLORS[all.length % LABEL_COLORS.length] }; b.labels = [...all, l]; }
          for (const col of b.columns) for (const c of col.cards) if (c.id === this.open) c.labels = [...new Set([...(c.labels ?? []), l.id])];
        });
      }
      this.addingLabel = false;
      cx.notify();
    });
    this.newLabel.on("blur", (_e, cx) => { this.addingLabel = false; cx.notify(); });
    this.calendar = CalendarState.new();
    if (found?.card.due) this.calendar.set_value(found.card.due);
    this.calendar.on("change", (date, cx) => {
      if (typeof date === "string") this.setDue(date);
      this.picking = false;
      cx.notify();
    });
    if (!(found?.card.tasks ?? []).length) this.task.focus();
  }

  find(cardId) {
    for (const col of this.board().columns) {
      const card = col.cards.find((c) => c.id === cardId);
      if (card) return { col, card };
    }
    return null;
  }

  updateCard(fn) {
    this.save((b) => {
      for (const col of b.columns) { const c = col.cards.find((x) => x.id === this.open); if (c) fn(c, col, b); }
    });
  }

  // A task takes the place of task `to`, or moves `step` places.
  moveTask(id, to, step) {
    this.updateCard((c) => {
      const list = c.tasks ?? [];
      const from = list.findIndex((x) => x.id === id);
      const at = to ? list.findIndex((x) => x.id === to) : from + step;
      if (from < 0 || at < 0 || at >= list.length || at === from) return;
      list.splice(at, 0, list.splice(from, 1)[0]);
    });
  }

  setDue(due) {
    this.updateCard((c) => { if (due) c.due = due; else delete c.due; });
  }

  // The Due row: quick picks, a month grid behind "Pick…", and how urgent it is now.
  renderDue(t, card, col) {
    const u = urgency(card.due, col);
    const chip = (id, label, on, action) => h_flex().id(id).h(24).px(9).items_center().rounded(12).text_size(11.5)
      .border_1().border_color(on ? t.accent : t.border).bg(on ? t.selected : t.background)
      .text_color(on ? t.foreground : t.muted).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { action(); cx.notify(); }).child(label);
    const row = h_flex().gap(6).items_center().flex_wrap()
      .child(div().w(46).flex_none().text_size(11.5).text_color(t.dim).child("Due"))
      .child(chip("due-today", "Today", card.due === today(), () => this.setDue(today())))
      .child(chip("due-tomorrow", "Tomorrow", card.due === plus(1), () => this.setDue(plus(1))))
      .child(chip("due-week", "In a week", card.due === plus(7), () => this.setDue(plus(7))))
      .child(chip("due-pick", card.due && ![today(), plus(1), plus(7)].includes(card.due) ? short(card.due) : "Pick…", this.picking, () => { this.picking = !this.picking; }))
      .when(Boolean(card.due), (el) => el
        .child(div().text_size(11.5).text_color(u?.color ? t[u.color] : t.muted).child(u?.label ?? ""))
        .child(chip("due-clear", "Clear", false, () => { this.setDue(null); this.picking = false; })));
    if (!this.picking) return row;

    const c = this.calendar, month = c.month_days()[0];
    const nav = (id, label, action) => div().id(id).w(24).h(24).flex().items_center().justify_center().rounded(5)
      .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { action(); cx.notify(); }).child(label);
    const inMonth = (day) => Number(day.slice(5, 7)) === c.month();
    const grid = v_flex().w(252).p(8).gap(2).rounded(8).border_1().border_color(t.border).bg(t.background)
      .child(h_flex().items_center().pb(4)
        .child(nav("cal-prev", "‹", () => c.prev_month()))
        .child(div().flex_1().text_center().text_size(12).font_semibold().child(`${MONTHS[c.month() - 1]} ${c.year()}`))
        .child(nav("cal-next", "›", () => c.next_month())))
      .child(h_flex().children(["M", "T", "W", "T", "F", "S", "S"].map((d) => div().w(33).text_center().text_size(10.5).text_color(t.dim).child(d))))
      .children(month.map((week, wi) => h_flex().children(week.map((day) => {
        const on = day === card.due, now = day === today();
        return div().id(`d-${wi}-${day}`).w(33).h(26).flex().items_center().justify_center().rounded(5).text_size(11.5)
          .bg(on ? t.accent : t.background).text_color(on ? t.accent_foreground : inMonth(day) ? t.foreground : t.dim)
          .when(now && !on, (el) => el.border_1().border_color(t.accent))
          .cursor_pointer().hover((s) => s.bg(on ? t.accent : t.hover))
          .on_click((_e, cx) => { this.setDue(day); this.picking = false; cx.notify(); })
          .child(String(Number(day.slice(8))));
      }))));
    return v_flex().gap(8).child(row).child(grid);
  }

  // The Tab row: which tab this card is about, its agents' status, and a picker to link one.
  renderLink(t, card) {
    const chip = (id, label, action, color) => h_flex().id(id).h(24).px(9).gap(6).items_center().rounded(12).text_size(11.5)
      .border_1().border_color(t.border).bg(t.background).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { action(); cx.notify(); })
      .when(Boolean(color), (el) => el.child(div().size(7).rounded(4).bg(color))).child(label);
    const l = linked(card.link);
    let row = h_flex().gap(6).items_center().flex_wrap().child(div().w(46).flex_none().text_size(11.5).text_color(t.dim).child("Tab"));
    if (card.link) {
      row = row.child(div().text_size(12).text_color(l ? t.foreground : t.dim).child(l ? `${l.space.name} › ${tabLabel(l.tab)}` : `${card.link.name} (closed)`))
        .when(Boolean(l?.tab.status), (el) => el.child(h_flex().gap(5).items_center().text_size(11.5).text_color(t[l.tab.status])
          .child(div().size(7).rounded(4).bg(t[l.tab.status])).child(STATUS_LABEL[l.tab.status])))
        .when(Boolean(l), (el) => el.child(chip("link-go", "Go to tab", () => { closeOverlay(props().overlay); goToTab(card.link); })))
        .child(chip("link-change", this.linking ? "Cancel" : "Change", () => { this.linking = !this.linking; }))
        .child(chip("link-off", "Unlink", () => { this.updateCard((c) => { delete c.link; }); this.linking = false; }));
    } else {
      row = row.child(chip("link-pick", this.linking ? "Cancel" : "Link a tab…", () => { this.linking = !this.linking; }));
    }
    if (!this.linking) return row;
    // Every tab but the Kanban board's own, grouped by space; the agent's status dot when there is one.
    const kanbanTabs = new Set(panes().filter((p) => p.mod === "kanban").map((p) => p.tab));
    const groups = spaces().map((s) => ({ s, tabs: s.tabs.filter((x) => !kanbanTabs.has(x.id)) })).filter((g) => g.tabs.length);
    return v_flex().gap(8).child(row)
      .child(v_flex().id("link-list").max_h(220).overflow_y_scrollbar().p(6).gap(1).rounded(8).border_1().border_color(t.border).bg(t.background)
        .children(groups.map(({ s, tabs }) => v_flex()
          .child(div().px(6).pt(4).pb(2).text_size(10.5).font_semibold().text_color(t.dim).child(s.name.toUpperCase()))
          .children(tabs.map((x) => h_flex().id(`lk-${x.id}`).h(26).px(8).gap(8).items_center().rounded(5).text_size(12)
            .cursor_pointer().hover((st) => st.bg(t.hover))
            .on_click((_e, cx) => {
              this.updateCard((c) => { c.link = { tab: x.id, space: s.id, name: tabLabel(x) }; });
              this.linking = false;
              cx.notify();
            })
            .child(div().size(7).rounded(4).bg(x.status ? t[x.status] : t.border))
            .child(div().flex_1().truncate().child(tabLabel(x)))
            .when(Boolean(x.status), (el) => el.child(div().text_size(11).text_color(t.dim).child(STATUS_LABEL[x.status]))))))));
  }

  // The Priority row: Low, Normal, High.
  renderPriority(t, card) {
    const chip = (value, label, color) => {
      const on = (card.priority ?? null) === value, c = color ? t[color] : t.foreground;
      return h_flex().id(`pr-${value ?? "normal"}`).h(24).px(9).gap(5).items_center().rounded(12).text_size(11.5)
        .border_1().border_color(on ? (color ? c : t.accent) : t.border).bg(on ? (color ? tint(c, "33") : t.selected) : t.background)
        .text_color(on ? c : t.muted).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.updateCard((x) => { if (value) x.priority = value; else delete x.priority; }); cx.notify(); })
        .child(label);
    };
    return h_flex().gap(6).items_center()
      .child(div().w(46).flex_none().text_size(11.5).text_color(t.dim).child("Priority"))
      .child(chip("low", "▼ Low", PRIORITY.low.color))
      .child(chip(null, "Normal", null))
      .child(chip("high", "▲ High", PRIORITY.high.color));
  }

  // The Labels row: click a label to put it on the card or take it off; "+ Label" makes one.
  // A label no card uses has a × to delete it from the board.
  renderLabels(t, card) {
    const b = this.board(), all = boardLabels(b), on = new Set(card.labels ?? []);
    const used = new Set(b.columns.flatMap((c) => c.cards.flatMap((x) => x.labels ?? [])));
    const chip = (l) => {
      const c = t[l.color] ?? t.muted, sel = on.has(l.id);
      return h_flex().id(`lb-${l.id}`).h(24).pl(9).pr(sel || used.has(l.id) ? 9 : 4).gap(4).items_center().rounded(12).text_size(11.5)
        .border_1().border_color(sel ? c : t.border).bg(sel ? tint(c, "33") : t.background).text_color(sel ? c : t.muted)
        .cursor_pointer().hover((s) => s.bg(sel ? tint(c, "4d") : t.hover))
        .on_click((_e, cx) => {
          this.updateCard((x) => { const ids = new Set(x.labels ?? []); ids.has(l.id) ? ids.delete(l.id) : ids.add(l.id); x.labels = [...ids]; if (!x.labels.length) delete x.labels; });
          cx.notify();
        })
        .child(div().size(7).rounded(4).bg(c)).child(l.name)
        .when(!used.has(l.id) && !sel, (el) => el.child(div().id(`lbx-${l.id}`).w(16).h(16).flex().items_center().justify_center().rounded(8)
          .text_color(t.dim).hover((s) => s.bg(t.raised).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.save((bb) => { bb.labels = boardLabels(bb).filter((x) => x.id !== l.id); }); cx.notify(); })
          .child("×")));
    };
    return h_flex().gap(6).items_center().flex_wrap()
      .child(div().w(46).flex_none().text_size(11.5).text_color(t.dim).child("Labels"))
      .children(all.map(chip))
      .child(this.addingLabel
        ? div().w(130).child(Input.new(this.newLabel).h(24).px(8).rounded(12).border_1().border_color(t.accent).bg(t.background).text_size(11.5).text_color(t.foreground))
        : h_flex().id("lb-new").h(24).px(9).items_center().rounded(12).text_size(11.5).border_1().border_color(t.border)
          .text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { this.addingLabel = true; this.newLabel.set_value(""); this.newLabel.focus(); cx.notify(); })
          .child("+ Label"));
  }

  editTask(task) {
    const input = InputState.new({ value: task.text });
    input.set_selected_range({ start: 0, end: task.text.length });
    const done = (cx) => {
      if (this.taskEdit?.input !== input) return;
      const text = input.value().trim();
      this.updateCard((c) => {
        c.tasks = (c.tasks ?? []).flatMap((x) => x.id !== task.id ? [x] : text ? [{ ...x, text }] : []);
      });
      this.taskEdit = null;
      cx.notify();
    };
    input.on("submit", (_e, cx) => done(cx));
    input.on("blur", (_e, cx) => done(cx));
    this.taskEdit = { id: task.id, input };
    input.focus();
  }

  renderDetail(t) {
    const found = this.find(this.open);
    const close = () => closeOverlay(props().overlay);
    if (!found) {
      return v_flex().id("detail").size_full().p(20).gap(12).bg(t.popover).text_color(t.muted).text_size(13)
        .child("This card was archived or deleted.").child(div().id("gone-close").cursor_pointer().text_color(t.accent).on_click(close).child("Close"));
    }
    const { col, card } = found;
    const tasks = card.tasks ?? [];
    const doneCount = tasks.filter((x) => x.done).length;
    const button = (id, label, action, danger) => h_flex().id(id).h(30).px(12).items_center().rounded(7).text_size(12.5)
      .border_1().border_color(t.input).bg(t.raised).text_color(danger ? t.blocked : t.foreground).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { action(); cx.notify(); }).child(label);
    const check = (x) => div().id(`chk-${x.id}`).size(16).flex_none().rounded(4).border_1()
      .border_color(x.done ? t.accent : t.input).bg(x.done ? t.accent : t.background)
      .flex().items_center().justify_center().text_size(11).text_color(t.accent_foreground).cursor_pointer()
      .on_click((_e, cx) => { this.updateCard((c) => { const y = c.tasks.find((z) => z.id === x.id); if (y) y.done = !y.done; }); cx.notify(); })
      .child(x.done ? "✓" : "");
    // Reorder: drag a task by its ⠿ grip onto another (it takes that place), or ↑ ↓.
    const small = (id, label, action) => div().id(id).w(20).h(20).flex().items_center().justify_center().rounded(4)
      .text_size(12).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.raised).text_color(t.foreground))
      .on_click((_e, cx) => { action(); cx.notify(); }).child(label);
    const dragged = this.taskDrag;
    const row = (x, i) => h_flex().id(`task-${x.id}`).min_h(30).px(2).gap(7).items_center().rounded(6)
      .border_1().border_color(dragged && this.taskOver === x.id && dragged !== x.id ? t.accent : t.popover)
      .opacity(dragged === x.id ? 0.5 : 1).hover((s) => s.bg(t.hover))
      .on_hover((h, cx) => { if (this.taskDrag) { if (h) this.taskOver = x.id; else if (this.taskOver === x.id) this.taskOver = null; cx.notify(); } })
      .on_mouse_up("left", (_e, cx) => { if (this.taskDrag) { this.moveTask(this.taskDrag, x.id); this.taskDrag = null; this.taskOver = null; cx.notify(); } })
      .child(div().id(`tgrip-${x.id}`).w(14).h(22).flex().items_center().justify_center().rounded(4)
        .text_size(11).text_color(t.dim).cursor_grab().hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.taskDrag = x.id; this.taskOver = x.id; cx.notify(); })
        .child("⠿"))
      .child(check(x))
      .child(this.taskEdit?.id === x.id
        ? div().flex_1().child(Input.new(this.taskEdit.input).h(26).px(6).rounded(5).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
        : div().id(`txt-${x.id}`).flex_1().min_w(0).text_size(12.8).cursor_pointer()
          .text_color(x.done ? t.dim : t.foreground).when(x.done, (el) => el.line_through())
          .on_click((_e, cx) => { this.editTask(x); cx.notify(); }).child(x.text))
      .when(i > 0, (el) => el.child(small(`tup-${x.id}`, "↑", () => this.moveTask(x.id, null, -1))))
      .when(i < tasks.length - 1, (el) => el.child(small(`tdn-${x.id}`, "↓", () => this.moveTask(x.id, null, 1))))
      .child(div().id(`del-${x.id}`).w(20).h(20).flex().items_center().justify_center().rounded(4).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.raised).text_color(t.foreground))
        .on_click((_e, cx) => { this.updateCard((c) => { c.tasks = c.tasks.filter((z) => z.id !== x.id); }); cx.notify(); }).child("×"));

    return v_flex().id("detail").size_full().bg(t.popover).text_color(t.foreground)
      .child(v_flex().p(18).pb(12).gap(10).border_b(1).border_color(t.border)
        .child(h_flex().items_center().gap(8)
          .child(div().flex_1().text_size(11.5).text_color(t.dim).child("Card"))
          .child(div().text_size(11).text_color(t.dim).child("Esc")))
        .child(Input.new(this.title).h(36).px(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(15).font_semibold().text_color(t.foreground))
        .child(h_flex().gap(6).items_center().flex_wrap()
          .children(this.board().columns.map((c) => h_flex().id(`mv-${c.id}`).h(24).px(9).items_center().rounded(12).text_size(11.5)
            .border_1().border_color(c.id === col.id ? t.accent : t.border).bg(c.id === col.id ? t.selected : t.background)
            .text_color(c.id === col.id ? t.foreground : t.muted).cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => { if (c.id !== col.id) this.move(card.id, c.id); cx.notify(); }).child(c.name))))
        .child(this.renderPriority(t, card))
        .child(this.renderLabels(t, card))
        .child(this.renderDue(t, card, col))
        .child(this.renderLink(t, card)))
      .on_mouse_up("left", (_e, cx) => { if (this.taskDrag) { this.taskDrag = null; this.taskOver = null; cx.notify(); } })
      .child(v_flex().id("tasks").flex_1().min_h(0).p(14).gap(4).overflow_y_scrollbar()
        .child(div().px(6).pb(6).text_size(12.5).font_semibold().child("Description"))
        .child(div().px(2).pb(14).child(Textarea.new(this.desc).w_full().px(8).py(6).rounded(7).border_1().border_color(t.input)
          .bg(t.background).text_size(12.8).text_color(t.foreground)))
        .child(h_flex().px(6).pb(6).gap(10).items_center()
          .child(div().text_size(12.5).font_semibold().child("Tasks"))
          .child(div().text_size(11.5).text_color(t.dim).child(tasks.length ? `${doneCount}/${tasks.length}` : ""))
          .when(tasks.length > 0, (el) => el.child(div().w(160).h(4).rounded(2).bg(t.hover)
            .child(div().h(4).rounded(2).bg(t.accent).w(Math.round(160 * doneCount / tasks.length))))))
        .children(tasks.map((x, i) => row(x, i)))
        .child(div().pt(6).child(Input.new(this.task).h(32).px(8).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground)))
        // History: when the card changed column, newest first.
        .child(h_flex().px(6).pt(18).pb(6).gap(10).items_center()
          .child(div().text_size(12.5).font_semibold().child("History"))
          .when(daysInColumn(card) !== null, (el) => el.child(div().text_size(11.5).text_color(stale(card, col) ? t.ansi6 : t.dim)
            .child(`${daysInColumn(card)} day${daysInColumn(card) === 1 ? "" : "s"} in ${col.name}`))))
        .when(!(card.history ?? []).length, (el) => el.child(div().px(6).text_size(11.8).text_color(t.dim).child("No moves recorded yet.")))
        .children([...(card.history ?? [])].reverse().map((h, i) => h_flex().id(`hist-${i}`).px(6).min_h(22).gap(10).items_center().text_size(11.8)
          .child(div().w(92).flex_none().text_color(t.dim).child(when(h.at)))
          .child(div().flex_1().min_w(0).text_color(t.muted).child(
            h.start ? `In ${h.to} (tracking started)` : h.from ? `${h.from} → ${h.to}${h.auto ? " (by itself)" : ""}` : `Created in ${h.to}`)))))
      .child(h_flex().p(14).gap(8).border_t(1).border_color(t.border)
        .child(button("archive-card", "Archive card", () => { this.save((b) => archiveCard(b, card.id)); close(); }))
        .child(div().flex_1())
        .child(button("close-card", "Close", close)));
  }

  board() {
    const b = shared(this.key);
    return b?.columns ? b : DEFAULT;
  }

  save(fn) {
    const b = JSON.parse(JSON.stringify(this.board()));
    fn(b);
    // When a card reached a finished column (Done, Archive): the archive's clock.
    for (const col of b.columns) for (const c of col.cards) {
      if (finished(col)) c.doneAt ??= today(); else delete c.doneAt;
    }
    setShared(this.key, b);
  }

  // One input at a time: adding a card, editing one, renaming or adding a column.
  start(edit, value, placeholder) {
    this.edit = edit;
    const input = InputState.new({ placeholder, value });
    this.input = input;
    if (value) input.set_selected_range({ start: 0, end: value.length });
    input.on("submit", (_e, cx) => {
      if (this.input !== input) return;
      const keep = this.edit?.kind === "add" ? this.edit : null;
      this.commit();
      if (keep) this.start(keep, "", placeholder); // adding stays open for the next card
      cx.notify();
    });
    input.on("blur", (_e, cx) => {
      if (this.input !== input || !this.edit) return;
      // Leaving an edit or a rename saves it; leaving an add closes it (keeping typed text).
      if (this.edit.kind === "card" || this.edit.kind === "column" || input.value().trim()) this.commit();
      else this.edit = null;
      cx.notify();
    });
    input.focus();
  }

  commit() {
    const e = this.edit; if (!e) return;
    const text = this.input?.value().trim() ?? "";
    this.edit = null;
    if (!text) return;
    this.save((b) => {
      const col = b.columns.find((c) => c.id === e.column);
      if (e.kind === "add" && col) { const card = { id: uid(), title: text }; logMove(card, null, col.name); col.cards.push(card); }
      if (e.kind === "card" && col) { const card = col.cards.find((c) => c.id === e.card); if (card) card.title = text; }
      if (e.kind === "column" && col) col.name = text;
      if (e.kind === "new-column") b.columns.push({ id: uid(), name: text, cards: [] });
    });
  }

  move(cardId, toColumn, beforeCard) {
    this.save((b) => {
      let card = null, from = null;
      const to = b.columns.find((c) => c.id === toColumn);
      if (!to) return;
      for (const c of b.columns) {
        const i = c.cards.findIndex((x) => x.id === cardId);
        if (i >= 0) { card = c.cards.splice(i, 1)[0]; from = c; }
      }
      if (!card) return;
      if (from.id !== to.id) logMove(card, from.name, to.name);
      const at = beforeCard ? to.cards.findIndex((x) => x.id === beforeCard) : -1;
      if (at >= 0) to.cards.splice(at, 0, card); else to.cards.push(card);
    });
  }

  shift(cardId, from, step) {
    const cols = this.board().columns;
    const i = cols.findIndex((c) => c.id === from) + step;
    if (i >= 0 && i < cols.length) this.move(cardId, cols[i].id);
  }

  // ---- Archive: removing a card puts it here; Done cards go by themselves after ARCHIVE_AFTER days ----

  /** Takes a card off the board into the archive (newest first). */
  remove(cardId) {
    this.save((b) => archiveCard(b, cardId));
    (this.undo ??= []).push(cardId); // u brings it back
  }

  /** u: restores the last card archived from this board copy (if it's still in the archive). */
  undoArchive() {
    while (this.undo?.length) {
      const id = this.undo.pop();
      if ((this.board().archive ?? []).some((x) => x.id === id)) { this.restore(id); this.sel = id; return; }
    }
  }

  /** Archives cards that have been in a finished column for ARCHIVE_AFTER days. */
  sweep() {
    const b = this.board();
    const old = b.columns.filter(finished).flatMap((c) => c.cards).filter((c) => c.doneAt && daysLeft(c.doneAt) <= -ARCHIVE_AFTER);
    if (old.length) this.save((bb) => { for (const c of old) archiveCard(bb, c.id, true); });
  }

  /** Back on the board: in the column it left (or the first), at the end. */
  restore(id) {
    this.save((b) => {
      const i = (b.archive ?? []).findIndex((x) => x.id === id);
      if (i < 0) return;
      const { archivedAt, from, fromName, auto, ...card } = b.archive.splice(i, 1)[0];
      delete card.doneAt; // a restored Done card starts its 14 days again
      const col = b.columns.find((c) => c.id === from) ?? b.columns[0];
      logMove(card, "Archive", col.name);
      col.cards.push(card);
    });
  }

  forget(id) {
    this.save((b) => { b.archive = (b.archive ?? []).filter((x) => x.id !== id); });
  }

  removeColumn(id) {
    this.save((b) => { b.columns = b.columns.filter((c) => c.id !== id || c.cards.length); });
  }

  // A column takes the place of `to` (a column id) or moves `step` places.
  moveColumn(id, to, step) {
    this.save((b) => {
      const from = b.columns.findIndex((c) => c.id === id);
      if (from < 0) return;
      const at = to ? b.columns.findIndex((c) => c.id === to) : from + step;
      if (at < 0 || at >= b.columns.length || at === from) return;
      b.columns.splice(at, 0, b.columns.splice(from, 1)[0]);
    });
  }

  /** Whether a card passes the board's filters: the label filter and the search. */
  visible(card, b) {
    if (this.labelFilter && !(card.labels ?? []).includes(this.labelFilter)) return false;
    const words = (this.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) { const h = this.haystack(card, b); if (!words.every((w) => h.includes(w))) return false; }
    return true;
  }

  /** A column's cards as shown: filtered, high priority first, low last, otherwise in order. */
  shownCards(col, b) {
    return col.cards.filter((c) => this.visible(c, b)).sort((x, y) => rank(x) - rank(y));
  }

  // ---- Keyboard (board) ----
  //   ← → ↑ ↓ or h j k l   select a card          Enter   open it
  //   Shift + ← →          move it to a column    Shift + ↑ ↓   move it up or down
  //   n   new card in the selected card's column   /   search      x or Delete   archive it
  //   ?   show these keys                          Esc   clear the selection

  key(e, cx) {
    const k = e.key, shift = e.modifiers?.shift;
    if (k === "escape") {
      if (this.edit) { this.edit = null; this.handle.focus(); }
      else if (this.searching) { this.search.set_value(""); this.query = ""; this.handle.focus(); }
      else if (this.showKeys) this.showKeys = false;
      else this.sel = null;
      return cx.notify();
    }
    // Typing in an input is not a command.
    if (this.edit || this.searching || e.modifiers?.control || e.modifiers?.alt || e.modifiers?.platform) return;
    const b = this.board();
    const cols = b.columns.map((col) => ({ col, cards: this.shownCards(col, b) }));
    let ci = cols.findIndex((x) => x.cards.some((c) => c.id === this.sel));
    let ri = ci >= 0 ? cols[ci].cards.findIndex((c) => c.id === this.sel) : -1;
    const select = (c, r) => { const card = cols[c]?.cards[r]; if (card) this.sel = card.id; };
    const dir = { left: "left", h: "left", right: "right", l: "right", up: "up", k: "up", down: "down", j: "down" }[k.toLowerCase()];
    if (dir) {
      cx.stop_propagation();
      if (ci < 0) { const first = cols.findIndex((x) => x.cards.length); if (first >= 0) select(first, 0); return cx.notify(); }
      if (shift && (dir === "left" || dir === "right")) this.shift(this.sel, cols[ci].col.id, dir === "left" ? -1 : 1);
      else if (shift) this.nudge(this.sel, cols[ci], dir === "up" ? -1 : 1);
      else if (dir === "up" || dir === "down") select(ci, Math.max(0, Math.min(cols[ci].cards.length - 1, ri + (dir === "up" ? -1 : 1))));
      else {
        // The nearest column that way with cards; the same row, or its last card.
        for (let c = ci + (dir === "left" ? -1 : 1); c >= 0 && c < cols.length; c += dir === "left" ? -1 : 1) {
          if (cols[c].cards.length) { select(c, Math.min(ri, cols[c].cards.length - 1)); break; }
        }
      }
      return cx.notify();
    }
    if (k === "enter" && this.sel) { cx.stop_propagation(); this.openCard(this.sel); return; }
    if (k === "n") {
      cx.stop_propagation();
      const col = ci >= 0 ? cols[ci].col : b.columns[0];
      if (col) this.start({ kind: "add", column: col.id }, "", "Card title");
      return cx.notify();
    }
    if (k === "/" || e.key_char === "/") { cx.stop_propagation(); this.search.focus(); return cx.notify(); }
    if ((k === "x" || k === "delete") && ci >= 0) {
      cx.stop_propagation();
      const next = cols[ci].cards[ri + 1] ?? cols[ci].cards[ri - 1];
      this.remove(this.sel);
      this.sel = next?.id ?? null;
      return cx.notify();
    }
    if (k === "u") { cx.stop_propagation(); this.undoArchive(); return cx.notify(); }
    // On the selected card: 1 2 3 priority, t w due, d clears the due date, e renames it.
    const card = ci >= 0 ? cols[ci].cards[ri] : null;
    if (!card) return;
    const set = (fn) => { cx.stop_propagation(); this.save((bb) => { for (const col of bb.columns) for (const x of col.cards) if (x.id === card.id) fn(x); }); cx.notify(); };
    if (k === "1") return set((x) => { x.priority = "high"; });
    if (k === "2") return set((x) => { delete x.priority; });
    if (k === "3") return set((x) => { x.priority = "low"; });
    if (k === "t") return set((x) => { x.due = today(); });
    if (k === "w") return set((x) => { x.due = plus(7); });
    if (k === "d") return set((x) => { delete x.due; });
    if (k === "e") { cx.stop_propagation(); this.start({ kind: "card", column: cols[ci].col.id, card: card.id }, card.title, "Card title"); return cx.notify(); }
    if (e.key_char === "?") { this.showKeys = !this.showKeys; return cx.notify(); }
  }

  /** Moves a card up or down past its neighbour as shown (same column). */
  nudge(cardId, shown, step) {
    const at = shown.cards.findIndex((c) => c.id === cardId), other = shown.cards[at + step];
    if (!other || rank(other) !== rank(shown.cards[at])) return; // priority order wins over position
    this.save((b) => {
      const col = b.columns.find((c) => c.id === shown.col.id);
      const i = col.cards.findIndex((c) => c.id === cardId), j = col.cards.findIndex((c) => c.id === other.id);
      [col.cards[i], col.cards[j]] = [col.cards[j], col.cards[i]];
    });
  }

  openCard(id) {
    openOverlay({ mod: "kanban", kind: "dialog", width: 540, height: 660, props: { board: this.boardName, open: id } });
  }

  // Dragging a card (drag.card) or a column (drag.column, by its ⠿ grip).
  drop(column, before, cx) {
    const d = this.drag; this.drag = null; this.over = null;
    if (d?.column) { if (d.column !== column) this.moveColumn(d.column, column); }
    else if (d && (column !== d.from || (before && before !== d.card))) this.move(d.card, column, before);
    cx.notify();
  }

  render() {
    const t = theme();
    if (this.open) return this.renderDetail(t);
    if (this.status) return this.renderStatus(t);
    this.day = today();
    const b = this.board();
    const stop = (_e, cx) => cx.stop_propagation();
    const icon = (id, label, action) => div().id(id).w(20).h(20).flex().items_center().justify_center().rounded(4)
      .text_size(14).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_mouse_up("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); action(); cx.notify(); }).child(label);
    const field = () => Input.new(this.input).h(32).px(8).rounded(7).border_1().border_color(t.accent)
      .bg(t.background).text_size(12.8).text_color(t.foreground);

    const card = (col, c, ci) => {
      if (this.edit?.kind === "card" && this.edit.card === c.id) return div().id(`edit-${c.id}`).child(field());
      const dragging = this.drag?.card === c.id;
      // Due soon or overdue: the card takes that color (border, tinted background, date badge).
      const u = urgency(c.due, col), hue = u?.color ? t[u.color] : null;
      const pr = PRIORITY[c.priority];
      // Stuck: STALE_AFTER days or more in this column. A cyan border (unless the due color has it) and a badge.
      const old = stale(c, col);
      return v_flex().id(`card-${c.id}`).relative().p(9).pl(pr ? 12 : 9).gap(4).rounded(8).border_1()
        .border_color(dragging || this.sel === c.id ? t.accent : hue ?? (old ? t.ansi6 : t.border)).bg(hue ? tint(hue, "26") : old ? tint(t.ansi6, "14") : t.raised).opacity(dragging ? 0.5 : 1)
        .when(old, (el) => el.border_dashed())
        .when(this.sel === c.id && !dragging, (el) => el.border_2().shadow_md())
        .cursor_pointer().hover((s) => s.border_color(hue ?? t.input))
        .on_mouse_down("left", (_e, cx) => {
          cx.stop_propagation();
          this.drag = { card: c.id, from: col.id }; this.sel = c.id;
          if (!this.edit && !this.searching) this.handle.focus();
          cx.notify();
        })
        .on_mouse_up("left", (_e, cx) => {
          cx.stop_propagation();
          if (this.drag && this.drag.card !== c.id) return this.drop(col.id, c.id, cx);
          this.drag = null; this.over = null;
          this.openCard(c.id);
          cx.notify();
        })
        // Priority: a stripe down the left edge in its color.
        .when(Boolean(pr), (el) => el.child(div().absolute().left(0).top(0).bottom(0).w(4).rounded_tl(8).rounded_bl(8).bg(t[pr.color])))
        .when((c.labels ?? []).length > 0, (el) => {
          const byId = new Map(boardLabels(b).map((l) => [l.id, l]));
          return el.child(h_flex().gap(4).flex_wrap().children(c.labels.map((id) => byId.get(id)).filter(Boolean).map((l) => pill(t, l))));
        })
        .child(div().text_size(12.8).text_color(t.foreground).child(c.title))
        .when(Boolean(c.description), (el) => {
          // About two lines of it at this width.
          const flat = c.description.replace(/\s*\n\s*/g, " ");
          return el.child(div().text_size(11.8).text_color(t.muted).child(flat.length > 90 ? `${flat.slice(0, 88).trimEnd()}…` : flat));
        })
        .when(Boolean(c.link), (el) => {
          // The linked tab: its agents' status, a click goes there.
          const l = linked(c.link), st = l?.tab.status;
          return el.child(h_flex().id(`go-${c.id}`).gap(6).items_center().px(6).py(2).rounded(6).text_size(11)
            .bg(t.hover).text_color(l ? t.foreground : t.dim).cursor_pointer().hover((s) => s.bg(t.selected))
            .on_mouse_down("left", stop).on_mouse_up("left", stop)
            .on_click((_e, cx) => { cx.stop_propagation(); goToTab(c.link); })
            .child(div().size(7).flex_none().rounded(4).bg(st ? t[st] : t.border))
            .child(div().flex_1().min_w(0).truncate().child(l ? tabLabel(l.tab) : `${c.link.name} (closed)`))
            .when(Boolean(st), (e2) => e2.child(div().text_color(t[st]).child(STATUS_LABEL[st]))));
        })
        .child(h_flex().gap(4).items_center()
          .when(Boolean(pr), (el) => el.child(div().px(6).rounded(6).text_size(11).bg(tint(t[pr.color], "33")).text_color(t[pr.color])
            .child(`${pr.mark} ${pr.label}`)))
          .when(Boolean(u), (el) => el.child(div().px(6).rounded(6).text_size(11)
            .bg(hue ? tint(hue, "40") : t.hover).text_color(hue ? t.foreground : t.muted).child(`📅 ${u.label.replace(/^Due (?=\d)/, "")}`)))
          .when(old, (el) => el.child(div().px(6).rounded(6).text_size(11).bg(tint(t.ansi6, "33")).text_color(t.ansi6)
            .child(`⏳ ${daysInColumn(c)}d here`)))
          .when(!old && !finished(col) && (daysInColumn(c) ?? 0) >= QUIET_AFTER, (el) => el.child(div().px(6).rounded(6).text_size(11)
            .bg(t.hover).text_color(t.dim).child(`${daysInColumn(c)}d`)))
          .when((c.tasks ?? []).length > 0, (el) => {
            const n = c.tasks.length, d = c.tasks.filter((x) => x.done).length;
            return el.child(div().px(6).rounded(6).text_size(11).bg(d === n ? t.selected : t.hover)
              .text_color(d === n ? t.foreground : t.muted).child(`☑ ${d}/${n}`));
          })
          .child(div().flex_1())
          .when(ci > 0, (el) => el.child(icon(`l-${c.id}`, "‹", () => this.shift(c.id, col.id, -1))))
          .when(ci < b.columns.length - 1, (el) => el.child(icon(`r-${c.id}`, "›", () => this.shift(c.id, col.id, 1))))
          .child(icon(`x-${c.id}`, "×", () => this.remove(c.id, col.id))));
    };

    const column = (col, ci) => {
      const renaming = this.edit?.kind === "column" && this.edit.column === col.id;
      const adding = this.edit?.kind === "add" && this.edit.column === col.id;
      const target = Boolean(this.drag) && this.over === col.id && this.drag.column !== col.id;
      const moving = this.drag?.column === col.id;
      return v_flex().id(`col-${col.id}`).w(272).flex_none().p(8).gap(6).rounded(10)
        .border_1().border_color(target || moving ? t.accent : t.border).bg(t.surface).opacity(moving ? 0.5 : 1)
        .on_hover((h, cx) => { if (this.drag) { if (h) this.over = col.id; else if (this.over === col.id) this.over = null; cx.notify(); } })
        .on_mouse_up("left", (_e, cx) => { cx.stop_propagation(); this.drop(col.id, null, cx); })
        .child(renaming ? field()
          : h_flex().h(26).px(2).gap(4).items_center()
            .child(div().id(`grip-${col.id}`).w(16).h(22).flex().items_center().justify_center().rounded(4)
              .text_size(12).text_color(t.dim).cursor_grab().hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.drag = { column: col.id }; this.over = col.id; cx.notify(); })
              .child("⠿"))
            .child(div().id(`name-${col.id}`).flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground)
              .cursor_pointer().on_click((_e, cx) => { this.start({ kind: "column", column: col.id }, col.name, "Column"); cx.notify(); })
              .child(col.name))
            .child(div().px(6).rounded(8).bg(t.hover).text_size(11).text_color(t.muted).child(String(col.cards.length)))
            .when(ci > 0, (el) => el.child(icon(`cl-${col.id}`, "‹", () => this.moveColumn(col.id, null, -1))))
            .when(ci < b.columns.length - 1, (el) => el.child(icon(`cr-${col.id}`, "›", () => this.moveColumn(col.id, null, 1))))
            .when(!col.cards.length && b.columns.length > 1, (el) => el.child(icon(`xc-${col.id}`, "×", () => this.removeColumn(col.id)))))
        .child(v_flex().id(`cards-${col.id}`).gap(6)
          .children(this.shownCards(col, b).map((c) => card(col, c, ci))))
        .child(adding ? v_flex().gap(4).child(field()).child(div().px(2).text_size(11).text_color(t.dim).child("Enter adds · Esc stops"))
          : h_flex().id(`add-${col.id}`).h(28).px(6).rounded(7).items_center().text_size(12).text_color(t.dim)
            .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { this.start({ kind: "add", column: col.id }, "", "Card title"); cx.notify(); })
            .child("+ Add card"));
    };

    const total = b.columns.reduce((n, c) => n + c.cards.length, 0);
    const shown = b.columns.reduce((n, c) => n + c.cards.filter((x) => this.visible(x, b)).length, 0);
    // The label filter: one label at a time, click again to show everything.
    const usedLabels = new Set(b.columns.flatMap((c) => c.cards.flatMap((x) => x.labels ?? [])));
    if (this.labelFilter && !usedLabels.has(this.labelFilter)) this.labelFilter = null;
    const filterBar = h_flex().id("filters").flex_1().min_w(0).gap(4).items_center().overflow_x_scroll().children(boardLabels(b).filter((l) => usedLabels.has(l.id)).map((l) => {
      const c = t[l.color] ?? t.muted, on = this.labelFilter === l.id;
      return h_flex().id(`flt-${l.id}`).h(24).flex_none().px(8).gap(5).items_center().rounded(12).text_size(11.5)
        .border_1().border_color(on ? c : t.border).bg(on ? tint(c, "33") : t.background).text_color(on ? c : t.muted)
        .cursor_pointer().hover((s) => s.bg(on ? tint(c, "4d") : t.hover))
        .on_click((_e, cx) => { this.labelFilter = on ? null : l.id; cx.notify(); })
        .child(div().size(7).rounded(4).bg(c)).child(l.name);
    }));
    return v_flex().id("kanban").track_focus(this.handle).size_full().bg(t.background).text_color(t.foreground)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => { if (!this.edit && !this.searching) this.handle.focus(); })
      .on_mouse_up("left", (_e, cx) => { if (this.drag) { this.drag = null; this.over = null; cx.notify(); } })
      .child(h_flex().h(44).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
        .child(svg_icon(t))
        .child(div().flex_none().text_size(14).font_semibold().child("Kanban"))
        .child(div().flex_none().text_size(12).text_color(t.dim).child(shown === total ? `${total} card${total === 1 ? "" : "s"}` : `${shown} of ${total} cards`))
        .child(div().w(8))
        .child(h_flex().w(220).flex_none().h(28).px(8).gap(6).items_center().rounded(7).border_1()
          .border_color(this.searching ? t.accent : t.input).bg(t.background)
          .child(div().text_size(12).text_color(t.dim).child("⌕"))
          .child(div().flex_1().min_w(0).child(Input.new(this.search).h(26).text_size(12.5).text_color(t.foreground)))
          .when(Boolean(this.query), (el) => el.child(div().id("search-clear").w(16).h(16).flex().items_center().justify_center()
            .rounded(8).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { this.search.set_value(""); this.query = ""; cx.notify(); }).child("×"))))
        .child(filterBar)
        .when(Boolean(this.drag), (el) => el.child(div().text_size(12).text_color(t.muted).child(this.drag?.column ? "Release over another column to put this one there" : "Release over a column or card to move")))
        .child(h_flex().id("archive-toggle").flex_none().h(28).px(10).gap(6).rounded(7).items_center().text_size(12)
          .border_1().border_color(this.showArchive ? t.accent : t.border).bg(this.showArchive ? t.selected : t.background)
          .text_color(this.showArchive ? t.foreground : t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { this.showArchive = !this.showArchive; cx.notify(); })
          .child(this.showArchive ? "← Board" : "Archive")
          .when(!this.showArchive && (b.archive ?? []).length > 0, (el) => el.child(div().px(5).rounded(6).bg(t.hover).text_size(11).child(String(b.archive.length)))))
        .child(this.edit?.kind === "new-column" ? div().w(200).child(field())
          : h_flex().id("new-column").flex_none().h(28).px(10).rounded(7).items_center().text_size(12).text_color(t.muted)
            .border_1().border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { this.start({ kind: "new-column" }, "", "Column name"); cx.notify(); })
            .child("+ Column"))
        .child(h_flex().id("keys-help").flex_none().w(28).h(28).justify_center().items_center().rounded(7).text_size(12.5)
          .border_1().border_color(this.showKeys ? t.accent : t.border).text_color(this.showKeys ? t.foreground : t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.showKeys = !this.showKeys; cx.notify(); })
          .child("?")))
      .when(this.showKeys, (el) => el.child(h_flex().flex_none().px(16).py(8).gap(18).flex_wrap().border_b(1).border_color(t.border)
        .bg(t.surface).text_size(11.5).text_color(t.muted)
        .children([["← → ↑ ↓  h j k l", "select"], ["Enter", "open"], ["Shift ← →", "move to column"], ["Shift ↑ ↓", "move up/down"],
          ["n", "new card"], ["e", "rename"], ["1 2 3", "high/normal/low"], ["t  w", "due today/in a week"], ["d", "clear due"],
          ["/", "search"], ["x  Del", "archive"], ["u", "undo archive"], ["Esc", "clear"]]
          .map(([keys, what]) => h_flex().gap(6).child(div().px(5).rounded(4).bg(t.hover).text_color(t.foreground).child(keys)).child(what)))))
      .child(this.showArchive ? this.renderArchive(t, b)
        // The board scrolls as a whole: down when a column runs long, sideways when columns don't fit.
        : div().id("board").flex_1().min_h(0).overflow_y_scrollbar()
          .child(h_flex().id("columns").p(14).gap(12).items_start().overflow_x_scrollbar()
            .children(b.columns.map(column))));
  }

  // The archive: newest first, with the search and label filter applied. Restore puts a card back
  // in the column it left; Delete forever removes it.
  renderArchive(t, b) {
    const all = b.archive ?? [], shown = all.filter((c) => this.visible(c, b));
    const byId = new Map(boardLabels(b).map((l) => [l.id, l]));
    const btn = (id, label, action, danger) => h_flex().id(id).flex_none().h(26).px(10).items_center().rounded(6).text_size(12)
      .border_1().border_color(t.border).text_color(danger ? t.blocked : t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { action(cx); cx.notify(); }).child(label);
    const row = (c) => h_flex().id(`ar-${c.id}`).px(14).py(10).gap(12).items_center().rounded(8).border_1().border_color(t.border).bg(t.surface)
      .child(v_flex().flex_1().min_w(0).gap(4)
        .when((c.labels ?? []).length > 0, (el) => el.child(h_flex().gap(4).children(c.labels.map((id) => byId.get(id)).filter(Boolean).map((l) => pill(t, l)))))
        .child(div().text_size(13).text_color(t.foreground).child(c.title))
        .child(div().text_size(11.5).text_color(t.dim).child(
          `${c.auto ? "Archived by itself" : "Archived"} ${short(c.archivedAt)} · from ${c.fromName ?? "?"}` +
          ((c.tasks ?? []).length ? ` · ☑ ${c.tasks.filter((x) => x.done).length}/${c.tasks.length}` : ""))))
      .child(btn(`rs-${c.id}`, "Restore", () => this.restore(c.id)))
      .child(this.confirmForget === c.id
        // Second step: a filled red button; anything else (or 4 s) backs out.
        ? h_flex().id(`fg-${c.id}`).flex_none().h(26).px(10).items_center().rounded(6).text_size(12).font_semibold()
          .bg(t.blocked).text_color(t.background).cursor_pointer()
          .on_click((_e, cx) => { this.confirmForget = null; this.forget(c.id); cx.notify(); }).child("Really delete?")
        : btn(`fg-${c.id}`, "Delete forever", (cx) => {
          const id = this.confirmForget = c.id;
          cx.timer.after(4000, (acx) => { if (this.confirmForget === id) { this.confirmForget = null; acx.notify(); } });
        }, true));
    return v_flex().id("archive").flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(8)
      .child(div().text_size(12).text_color(t.dim).pb(4).child(
        `Removed cards land here, and cards that sit ${ARCHIVE_AFTER} days in Done go here by themselves. ` +
        (all.length ? `${shown.length === all.length ? all.length : `${shown.length} of ${all.length}`} archived.` : "Nothing archived yet.")))
      .children(shown.map(row));
  }
}

function svg_icon(t) {
  return svg("mods/kanban/kanban.svg").flex_none().size(16).text_color(t.muted);
}
