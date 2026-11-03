import { test, expect, field, val, basic } from "./fixtures";

// The AI Assistant and the My Day layout. The sandbox has no API key on purpose, so nothing here reaches
// Claude: what's tested is how the app behaves around it. lib/assistant.test.ts and
// lib/assistant-tools-db.test.ts cover the loop, the tools and what each role can see.

test.describe("AI Assistant, with no key", () => {
  test("it's in the menu, says plainly why it's off, and nothing else depends on it", async ({ as }) => {
    const page = await as("mrivera");
    await page.goto("/");
    await page.locator("aside").getByRole("link", { name: "AI Assistant" }).click();
    await expect(page.getByRole("heading", { name: "AI Assistant", exact: true })).toBeVisible();
    await expect(page.getByText("The AI Assistant isn't set up on this server yet")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Ask the AI Assistant" })).toBeDisabled();
    await page.goto("/");
    await expect(page.getByRole("textbox", { name: "Ask the AI Assistant" })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Priority queue" })).toBeVisible();
  });

  test("the server refuses with a plain message, and logs nothing that never ran", async ({ as }) => {
    const page = await as("mrivera");
    await page.goto("/assistant");
    const before = val("select count(*) from assistant_log");
    const res = await page.evaluate(async () => {
      const r = await fetch("/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "hello", history: [] }) });
      return { status: r.status, text: await r.text() };
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain("needs an Anthropic API key");
    expect(val("select count(*) from assistant_log")).toBe(before);
  });

  test("it can't be asked from another site, without a login, or with a bad request", async ({ anon, as }) => {
    expect((await anon.post("/assistant/ask", { data: { question: "hi" } })).status()).toBe(401);
    const asCsr = { Authorization: basic("kowens") };
    expect((await anon.post("/assistant/ask", { headers: { ...asCsr, Origin: "https://evil.example" }, data: { question: "hi" } })).status()).toBe(403);
    const page = await as("kowens");
    await page.goto("/assistant");
    const statuses = await page.evaluate(async () => {
      const post = (body: string, type = "application/json") => fetch("/assistant/ask", { method: "POST", headers: { "Content-Type": type }, body }).then((r) => r.status);
      return [await post("{}"), await post("not json"), await post("question=hi", "text/plain"), await post(JSON.stringify({ question: "x", pad: "y".repeat(300_000) }))];
    });
    expect(statuses).toEqual([400, 400, 415, 413]);
  });

  test("a link can fill the box but never asks by itself", async ({ as }) => {
    const page = await as("mrivera");
    let asked = false;
    page.on("request", (r) => { if (r.url().includes("/assistant/ask")) asked = true; });
    await page.goto("/assistant?q=spend%20my%20tokens");
    await expect(page.getByRole("textbox", { name: "Ask the AI Assistant" })).toHaveValue("spend my tokens");
    await page.waitForLoadState("networkidle");
    expect(asked).toBe(false);
  });

  test("the rules page shows each role only its own lookups", async ({ as }) => {
    const csr = await as("kowens");
    await csr.goto("/assistant/about");
    await expect(csr.getByRole("heading", { name: "What the AI Assistant can see" })).toBeVisible();
    await expect(csr.getByText("It only reads.")).toBeVisible();
    await expect(csr.getByText("search app", { exact: true })).toBeVisible();
    await expect(csr.getByText("accounting overview", { exact: true })).toHaveCount(0);
    await expect(csr.getByText("audit search", { exact: true })).toHaveCount(0);
    const acct = await as("lmorgan");
    await acct.goto("/assistant/about");
    await expect(acct.getByText("accounting overview", { exact: true })).toBeVisible();
    await expect(acct.getByText("audit search", { exact: true })).toHaveCount(0);
    const admin = await as("admin");
    await admin.goto("/assistant/about");
    await expect(admin.getByText("audit search", { exact: true })).toBeVisible();
  });

  test("the usage record is an administrator's, and the switch is in settings", async ({ as }) => {
    for (const who of ["mrivera", "choll", "lmorgan", "kowens"] as const) {
      const page = await as(who);
      await page.goto("/admin/assistant");
      await expect(page.getByText("You can't open AI Assistant use"), who).toBeVisible();
    }
    const admin = await as("admin");
    await admin.goto("/admin");
    await admin.getByRole("link", { name: /AI Assistant use/ }).click();
    await expect(admin.getByRole("heading", { name: "AI Assistant use" })).toBeVisible();
    await expect(admin.getByText("Off: no API key on this server")).toBeVisible();
    await admin.goto("/admin/settings");
    await expect(field(admin, "ai_assistant")).toBeChecked();
  });
});

test.describe("My Day layout", () => {
  const measure = (page: import("@playwright/test").Page) => page.evaluate(() => {
    const tiles = [...document.querySelectorAll("main .grid")].find((g) => /Overdue/.test(g.textContent ?? "") && /Done today/.test(g.textContent ?? ""))!;
    const boxes = [...tiles.children].map((k) => (k.matches("a") ? k.firstElementChild! : k).getBoundingClientRect());
    const queue = [...document.querySelectorAll("section")].find((s) => /^(Priority queue|Team priorities)/.test(s.textContent ?? ""))!.getBoundingClientRect();
    const side = [...document.querySelectorAll("section")].filter((s) => queue.right < s.getBoundingClientRect().left + 1).map((s) => s.getBoundingClientRect());
    return { tops: new Set(boxes.map((b) => Math.round(b.top))).size, heights: new Set(boxes.map((b) => Math.round(b.height))).size, widths: new Set(boxes.map((b) => Math.round(b.width))).size,
      queueTop: Math.round(queue.top), queueBottom: Math.round(queue.bottom), sideTop: Math.round(side[0].top), sideBottom: Math.round(side.at(-1)!.bottom), overflow: document.documentElement.scrollWidth > innerWidth };
  });

  for (const who of ["mrivera", "choll", "rcallahan"] as const) {
    test(`${who}: the tiles are one size and the two columns start and end level`, async ({ as }) => {
      const page = await as(who);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(who === "choll" ? "/?view=mine" : "/");
      const m = await measure(page);
      expect(m.tops, "tiles share a top").toBe(1);
      expect(m.heights, "tiles share a height").toBe(1);
      expect(m.widths, "tiles share a width").toBe(1);
      expect(Math.abs(m.queueTop - m.sideTop), "columns start level").toBeLessThanOrEqual(1);
      expect(Math.abs(m.queueBottom - m.sideBottom), "columns end level").toBeLessThanOrEqual(1);
      expect(m.overflow).toBe(false);
    });
  }

  test("on a phone nothing runs off the side", async ({ as }) => {
    const page = await as("mrivera");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
});
