-- Allow projects and invoices without a client (internal/org projects)

ALTER TABLE projects ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN client_id DROP NOT NULL;
