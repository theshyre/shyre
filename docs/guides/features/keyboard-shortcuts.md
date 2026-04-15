# Keyboard shortcuts

Every primary action has a shortcut with a visible `<kbd>` badge next to the trigger. These are the shortcuts as of today.

## Global

| Key | Action | Where |
|---|---|---|
| `/` | Focus the search/filter field | Any list page |

## Time tracking

| Key | Action |
|---|---|
| `Space` | Start or stop the timer (when no input is focused) |
| `N` | Add a past time entry |
| `W` | Focus the week date picker |
| `←` / `→` | Previous / next week |
| `T` | Jump to this week |
| `Esc` | Collapse inline edit; close the kebab menu |
| `Cmd+Enter` | Submit any open inline form |

## Lists with add-new

| Key | Action |
|---|---|
| `N` | Add new item (customer, project, expense, template, category set, invoice) |

`N` works on the list page for that entity. It opens the inline / dropdown / modal form.

## Forms

| Key | Action |
|---|---|
| `Enter` | Submit (any native `<form>`) |
| `Esc` | Cancel / close the form |
| `Cmd+S` | Save (where supported by the form) |
| `Cmd+Enter` | Submit (on multi-line textarea contexts) |

## Rules

- Shortcuts fire only when **no text input is focused** (except `Cmd/Ctrl` combos).
- Shortcuts are disabled when a modal is open (except the modal's own dismiss keys).
- Every shortcut shown in the UI must also work — report bugs where the `<kbd>` badge lies.
