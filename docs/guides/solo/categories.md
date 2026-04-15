# Categories

Categories tag time entries with **what you were doing** — the primary organizing axis for time. Project tells you *for whom*; category tells you *what*.

## Category sets

Categories live inside **category sets**. A set is a collection of categories with an ordering and colors.

- **System sets** — platform-provided, read-only, available to all orgs (e.g. "Consulting basics").
- **Org sets** — your own, editable by owners/admins of the org.

You can create multiple sets and assign different sets to different projects. Example: "Engineering work" set for dev projects; "Account management" set for client-services projects.

## Creating a set

1. Sidebar → **Categories**
2. Click **New set**
3. Name it (e.g. "Engineering"), pick an organization, save
4. Inside the set, add categories: name, color, sort order

## Assigning a set to a project

Open the project → pick the category set from the dropdown → save. All new entries on that project will prompt for a category. Existing entries aren't retagged.

## Using categories on time entries

- When logging time on a project with a category set, a category picker appears.
- Pick a category — it's colored for quick scanning in the week view.
- Each entry has at most one category.

A strict trigger enforces that an entry's `category_id` must belong to its project's `category_set_id`. If the category set changes, existing entries with the now-invalid category are left as-is; new edits must pick a valid category.

## Editing / reordering / deleting

- Edit in place from the category set detail page.
- Reorder with drag-and-drop (sort order persists).
- Deleting a category doesn't touch historical entries that used it; those entries lose the link.

## Reporting

Reports can be broken down by category. Useful for "how much time did I spend on planning vs. implementation this quarter?"

## Related

- [Projects](projects.md)
- [Time tracking](time-tracking.md)
