import { vi } from "vitest";

export interface MockSupabaseQuery {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
}

export function createMockSupabaseClient(overrides?: {
  user?: { id: string; email: string } | null;
  queryData?: unknown;
}) {
  const user =
    overrides?.user === null
      ? null
      : overrides?.user ?? { id: "user-1", email: "test@test.com" };
  const queryData = overrides?.queryData ?? [];

  const chainResult = { data: queryData, error: null };

  const queryBuilder: MockSupabaseQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    update: vi.fn().mockResolvedValue({ data: null, error: null }),
    delete: vi.fn().mockResolvedValue({ data: null, error: null }),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(chainResult),
    single: vi.fn().mockResolvedValue(chainResult),
  };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
      signInWithPassword: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
      signUp: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn().mockReturnValue(queryBuilder),
    _queryBuilder: queryBuilder,
  };
}
