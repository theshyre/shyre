"use client";

import { useState } from "react";
import { useTransition } from "react";
import { Mail, Plus, Pencil, Trash2, Send, Star } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { Tooltip } from "@/components/Tooltip";
import { useToast } from "@/components/Toast";
import { assertActionResult } from "@/lib/action-result";
import {
  inputClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonGhostClass,
} from "@/lib/form-styles";
import {
  createCustomerContactAction,
  updateCustomerContactAction,
  deleteCustomerContactAction,
  setInvoiceRecipientAction,
} from "./contacts-actions";

export interface ContactRow {
  id: string;
  name: string;
  email: string;
  role_label: string | null;
  is_invoice_recipient: boolean;
}

/**
 * People at a customer org. The contact flagged "send invoices to"
 * pre-fills the To: field on the Send Invoice modal; everything
 * else is just for human reference (and future Cc-able-multiple
 * support per the roadmap).
 *
 * Owner / admin only — RLS enforces too. Read-only render for
 * members so they can see who the customer's people are without
 * the action affordances showing.
 */
export function ContactsSection({
  customerId,
  contacts,
  canManage,
}: {
  customerId: string;
  contacts: ContactRow[];
  canManage: boolean;
}): React.JSX.Element {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function onError(err: unknown, fallback: string): void {
    const msg = err instanceof Error ? err.message : fallback;
    setActionError(msg);
    toast.push({ kind: "error", message: msg });
  }

  function onToggleRecipient(contactId: string): void {
    setActionError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("contact_id", contactId);
        await assertActionResult(setInvoiceRecipientAction(fd));
        toast.push({ kind: "success", message: "Invoice recipient updated." });
      } catch (err) {
        onError(err, "Could not update recipient.");
      }
    });
  }

  function onDelete(contactId: string, name: string): void {
    if (!confirm(`Delete contact "${name}"?`)) return;
    setActionError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("contact_id", contactId);
        await assertActionResult(deleteCustomerContactAction(fd));
        toast.push({ kind: "success", message: "Contact deleted." });
      } catch (err) {
        onError(err, "Could not delete contact.");
      }
    });
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Mail size={20} className="text-accent" />
          <h2 className="text-lg font-semibold text-content">Contacts</h2>
        </div>
        {canManage && !adding && (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setAdding(true);
              setActionError(null);
            }}
            className={buttonSecondaryClass}
          >
            <Plus size={14} />
            Add contact
          </button>
        )}
      </div>
      <p className="mt-1 text-caption text-content-muted">
        People at this customer. Every contact flagged{" "}
        <span className="inline-flex items-center gap-1 align-middle">
          <Send size={11} className="text-accent" />
          Send invoices to
        </span>{" "}
        is added to the To: line when you email an invoice — flag two
        co-owners and they both receive it.
      </p>

      {actionError && (
        <div className="mt-3">
          <AlertBanner tone="error">{actionError}</AlertBanner>
        </div>
      )}

      {adding && (
        <div className="mt-3 rounded-lg border border-edge bg-surface-raised p-4">
          <ContactForm
            customerId={customerId}
            initial={null}
            onCancel={() => setAdding(false)}
            onSuccess={() => {
              setAdding(false);
              toast.push({ kind: "success", message: "Contact added." });
            }}
            onError={(err) => onError(err, "Could not add contact.")}
          />
        </div>
      )}

      {contacts.length === 0 && !adding ? (
        <p className="mt-3 text-sm text-content-muted italic">
          No contacts yet. {canManage ? "Add one to start sending invoices to a real person." : ""}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {contacts.map((c) => {
            const isEditing = editingId === c.id;
            return (
              <li
                key={c.id}
                className="rounded-lg border border-edge bg-surface-raised"
              >
                {isEditing ? (
                  <div className="p-4">
                    <ContactForm
                      customerId={customerId}
                      initial={c}
                      onCancel={() => setEditingId(null)}
                      onSuccess={() => {
                        setEditingId(null);
                        toast.push({
                          kind: "success",
                          message: "Contact updated.",
                        });
                      }}
                      onError={(err) =>
                        onError(err, "Could not update contact.")
                      }
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-content truncate">
                          {c.name}
                        </span>
                        {c.is_invoice_recipient && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                            <Send size={10} />
                            Invoice recipient
                          </span>
                        )}
                        {c.role_label && (
                          <span className="text-xs text-content-muted">
                            {c.role_label}
                          </span>
                        )}
                      </div>
                      <a
                        href={`mailto:${c.email}`}
                        className="text-caption text-accent hover:underline font-mono break-all"
                      >
                        {c.email}
                      </a>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1">
                        <Tooltip
                          label={
                            c.is_invoice_recipient
                              ? "Stop sending invoices to this contact"
                              : "Also send invoices to this contact"
                          }
                        >
                          <button
                            type="button"
                            onClick={() => onToggleRecipient(c.id)}
                            className={buttonGhostClass}
                            aria-label={
                              c.is_invoice_recipient
                                ? "Stop sending invoices to this contact"
                                : "Also send invoices to this contact"
                            }
                            aria-pressed={c.is_invoice_recipient}
                          >
                            <Star
                              size={14}
                              className={
                                c.is_invoice_recipient
                                  ? "fill-accent text-accent"
                                  : "text-content-muted"
                              }
                            />
                          </button>
                        </Tooltip>
                        <Tooltip label="Edit">
                          <button
                            type="button"
                            onClick={() => {
                              setActionError(null);
                              setEditingId(c.id);
                              setAdding(false);
                            }}
                            className={buttonGhostClass}
                            aria-label="Edit contact"
                          >
                            <Pencil size={14} />
                          </button>
                        </Tooltip>
                        <Tooltip label="Delete">
                          <button
                            type="button"
                            onClick={() => onDelete(c.id, c.name)}
                            className={buttonGhostClass}
                            aria-label="Delete contact"
                          >
                            <Trash2 size={14} />
                          </button>
                        </Tooltip>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ContactForm({
  customerId,
  initial,
  onCancel,
  onSuccess,
  onError,
}: {
  customerId: string;
  initial: ContactRow | null;
  onCancel: () => void;
  onSuccess: () => void;
  onError: (err: unknown) => void;
}): React.JSX.Element {
  const [pending, setPending] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [roleLabel, setRoleLabel] = useState(initial?.role_label ?? "");
  const [isRecipient, setIsRecipient] = useState(
    initial?.is_invoice_recipient ?? false,
  );

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setPending(true);
    try {
      const fd = new FormData();
      if (initial) {
        fd.set("contact_id", initial.id);
      } else {
        fd.set("customer_id", customerId);
      }
      fd.set("name", name);
      fd.set("email", email);
      fd.set("role_label", roleLabel);
      fd.set("is_invoice_recipient", isRecipient ? "true" : "false");
      const action = initial
        ? updateCustomerContactAction
        : createCustomerContactAction;
      await assertActionResult(action(fd));
      onSuccess();
    } catch (err) {
      onError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="contact_name">
            Name
          </label>
          <input
            id="contact_name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            required
            autoFocus
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="contact_email">
            Email
          </label>
          <input
            id="contact_email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            required
          />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="contact_role">
          Role (optional)
        </label>
        <input
          id="contact_role"
          value={roleLabel}
          onChange={(e) => setRoleLabel(e.target.value)}
          className={inputClass}
          placeholder="AP Manager, Owner, Project lead, …"
        />
      </div>
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={isRecipient}
          onChange={(e) => setIsRecipient(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-sm text-content">
          Send invoices to this contact
          <span className="block text-caption text-content-muted">
            Pre-fills the To: address when you email an invoice. Replaces any
            other contact currently flagged as the recipient.
          </span>
        </span>
      </label>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className={buttonPrimaryClass}
        >
          {pending
            ? initial
              ? "Saving…"
              : "Adding…"
            : initial
              ? "Save changes"
              : "Add contact"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className={buttonSecondaryClass}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
