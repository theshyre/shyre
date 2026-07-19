# Customers

The people and companies you bill. Customers are a platform-level concept — referenced by projects, time entries, and invoices.

## Creating a customer

1. Sidebar → **Customers**
2. Press `N` or click **Add customer**
3. Minimum: a name. Also available:
   - Email — used when sending invoices
   - Default rate — applied to new projects unless overridden
   - Address (structured: street, street2, city, state, postal code, country)
   - Notes — free text, private
4. **Save**.

Customers always belong to a **team**. When you have multiple teams, pick one from the **Team** dropdown in the form.

## The customers list

- Every row shows the customer's **identity chip** — a square two-letter initials mark colored per customer — or the customer's **logo** if one has been uploaded on the edit form. The same mark appears on the detail page header and everywhere else the customer is referenced.
- Filter chips across the top: **All / Active / Inactive / Archived** (default **All**) — see [Customer lifecycle](customer-lifecycle.md).
- **Export CSV** in the header downloads the list, honoring the current filter.
- If invoice email to a customer has **bounced** or been marked as spam, the row gets a warning chip and a banner appears with a one-click filter (`?bounced=1`) to review the affected customers.
- Select rows via the checkboxes for bulk actions: **Mark inactive** and **Archive** on the active views, **Restore** on the Archived view.

## Editing and archiving

- Click any customer name to open the detail page. Edit in place — including uploading a **logo**, a co-brand **accent color**, **payment terms**, and **contacts** (with an invoice-recipient flag).
- **Archive** hides the customer from the default list but preserves every historical invoice and entry. Restore an archived customer from the list's **Archived** filter — each row has a **Restore** button, bulk-restore works via the selection toolbar, and an **Undo** toast appears right after archiving.
- For dormant-but-not-gone relationships, use **Mark inactive** instead — the full state model is in [Customer lifecycle](customer-lifecycle.md).

## Default rate

Setting a default rate on a customer pre-fills new projects for that customer. Change it at any time; existing projects keep their set rate.

## Customer sharing (agency feature)

If you subcontract or work with another org on the same customer, see [agency/customer-sharing.md](../agency/customer-sharing.md). Solo users can ignore this.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `N` | Add customer |
| `Esc` | Clear the current row selection |

## Related

- [Customer lifecycle](customer-lifecycle.md)
- [Projects](projects.md)
- [Invoicing](invoicing.md)
