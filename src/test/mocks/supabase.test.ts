import { describe, it, expect } from "vitest";
import { createMockSupabaseClient } from "./supabase";

describe("createMockSupabaseClient", () => {
  it("returns a default user", async () => {
    const client = createMockSupabaseClient();
    const { data } = await client.auth.getUser();
    expect(data.user).toEqual({ id: "user-1", email: "test@test.com" });
  });

  it("accepts custom user override", async () => {
    const client = createMockSupabaseClient({
      user: { id: "custom-id", email: "custom@test.com" },
    });
    const { data } = await client.auth.getUser();
    expect(data.user?.id).toBe("custom-id");
  });

  it("accepts null user for unauthenticated state", async () => {
    const client = createMockSupabaseClient({ user: null });
    const { data } = await client.auth.getUser();
    expect(data.user).toBeNull();
  });

  it("provides chainable query builder", () => {
    const client = createMockSupabaseClient();
    const query = client.from("customers");
    expect(query.select).toBeDefined();
    expect(query.insert).toBeDefined();
    expect(query.update).toBeDefined();
    expect(query.eq).toBeDefined();
  });

  it("from() is called with table name", () => {
    const client = createMockSupabaseClient();
    client.from("customers");
    expect(client.from).toHaveBeenCalledWith("customers");
  });
});
