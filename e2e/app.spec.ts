import { test, expect, type Page } from "@playwright/test";

// Every run owns a separate synthetic DB and port. Never reset a developer's DB.
test.beforeEach(async ({ request }) => {
  const res = await request.post("/api/demo/reset");
  expect(res.ok()).toBeTruthy();
});
async function checkLayout(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
}
async function createRent(page: Page) {
  await page.goto("/transfers");
  await page
    .getByLabel("From", { exact: true })
    .selectOption("acct_alice_checking");
  await page
    .getByLabel("To", { exact: true })
    .selectOption("rcp_alice_landlord");
  await page.getByLabel("Amount", { exact: false }).fill("1850");
  await page
    .getByRole("button", { name: "Propose transfer", exact: true })
    .click();
  await expect(page).toHaveURL(/id=/);
}

test("all navigation, overview links, evidence and responsive layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle("ClearFi");
  await expect(
    page.getByRole("heading", { name: "Hello, Alice." }),
  ).toBeVisible();
  await expect(
    page.getByText("Individual Brokerage", { exact: true }),
  ).toBeVisible();
  await checkLayout(page);
  await page.getByText("View details", { exact: true }).click();
  await expect(
    page.getByText("Based on your synthetic transaction history."),
  ).toBeVisible();
  await page.getByRole("link", { name: /Everyday Checking/ }).click();
  await expect(page).toHaveURL(/accounts\?id=/);
  await expect(
    page.getByRole("heading", { name: "Everyday Checking" }),
  ).toBeVisible();
  for (const [label, heading] of [
    ["Transfers", "Transfers"],
    ["Assistant", "Ask ClearFi"],
    ["Controls", "Control"],
    ["Accounts", "Your accounts"],
    ["Overview", "Hello, Alice."],
  ]) {
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: label, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }).first(),
    ).toBeVisible();
    await checkLayout(page);
    if (label === "Controls") {
      await page
        .getByText("View event details", { exact: true })
        .first()
        .click();
      await expect(page.locator("details[open] pre").first()).toBeVisible();
    }
  }
  await page.getByRole("link", { name: "New transfer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Propose transfer" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("accounts search, currency, holdings and preselected transfer source", async ({
  page,
}) => {
  await page.goto("/accounts");
  await expect(
    page.getByRole("button", { name: /Everyday Checking/ }),
  ).toBeVisible();
  const activity = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Recent activity", exact: true }),
  });
  await expect(activity.getByRole("listitem")).toHaveCount(12);
  await page.getByRole("button", { name: /Show more activity/ }).click();
  await expect(activity.getByRole("listitem")).toHaveCount(24);
  await page.getByLabel("Search accounts or activity").fill("no-such-account");
  await expect(page.getByText(/No matching accounts/)).toBeVisible();
  await page.getByLabel("Search accounts or activity").fill("");
  await page.getByLabel("Account type").selectOption("brokerage");
  await page.getByRole("button", { name: /Individual Brokerage/ }).click();
  await expect(
    page.getByRole("heading", { name: "Holdings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "VTI" }).first(),
  ).toBeVisible();
  await page.getByLabel("Account type").selectOption("all");
  await page.getByRole("button", { name: /High-Yield Savings/ }).click();
  await page.getByRole("link", { name: "Transfer from this account" }).click();
  await expect(page.getByLabel("From", { exact: true })).toHaveValue(
    "acct_alice_savings",
  );
  await page.goto("/accounts");
  await page.getByLabel("Search accounts or activity").fill("Barclays");
  await expect(page.getByRole("button", { name: /£/ }).first()).toBeVisible();
  await checkLayout(page);
});

test("link sync outage reconnect disconnect and relink a simulated bank", async ({
  page,
}) => {
  await page.goto("/accounts");
  await page
    .getByRole("button", { name: "Link demo bank", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Link RBC Royal Bank", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Sync complete" }),
  ).toBeVisible();
  const bank = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: "RBC Royal Bank (simulated)",
      exact: true,
    }),
  });
  await bank.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Sync complete" }),
  ).toBeVisible();
  await bank.getByText("Demo scenarios", { exact: true }).click();
  await bank.getByRole("button", { name: "Simulate expired login" }).click();
  await expect(
    bank.getByRole("button", { name: "Reconnect", exact: true }),
  ).toBeVisible();
  await bank.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(
    bank.getByRole("button", { name: "Sync now", exact: true }),
  ).toBeVisible();
  await bank.getByText("Demo scenarios", { exact: true }).click();
  await bank.getByRole("button", { name: "Simulate outage" }).click();
  await expect(bank.getByText(/temporarily unavailable/)).toBeVisible();
  await bank.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(bank.getByText(/healthy/)).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await bank.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    bank.getByRole("button", { name: "Relink", exact: true }),
  ).toBeVisible();
  await bank.getByRole("button", { name: "Relink", exact: true }).click();
  await expect(
    bank.getByRole("button", { name: "Sync now", exact: true }),
  ).toBeVisible();
  await checkLayout(page);
});

test("held transfer verification, exact approval, execution and duplicate receipt", async ({
  page,
}) => {
  await createRent(page);
  await expect(
    page.getByRole("button", { name: /Approve exact transfer/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Try to execute anyway", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: /INVALID_STATE/ }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Verify recipient (simulated out-of-band check)",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Re-evaluate", exact: true }).click();
  await page.getByRole("button", { name: /Approve exact transfer/ }).click();
  await page
    .getByRole("button", { name: "Execute (simulated)", exact: true })
    .click();
  await expect(page.getByText("Receipt ID", { exact: true })).toBeVisible();
  await page
    .getByRole("button", {
      name: "Execute again (duplicate check)",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      "Already executed — same receipt returned, no second transfer.",
      { exact: true },
    ),
  ).toBeVisible();
  await checkLayout(page);
});

test("edit invalidates approval; paused controls stop execution; limits save", async ({
  page,
  request,
}) => {
  await page.goto("/transfers");
  await page
    .getByLabel("From", { exact: true })
    .selectOption("acct_alice_checking");
  await page
    .getByLabel("To", { exact: true })
    .selectOption("rcp_alice_savings");
  await page.getByLabel("Amount", { exact: false }).fill("25");
  await page.getByRole("button", { name: "Propose transfer" }).click();
  await expect(page).toHaveURL(/id=/);
  await page.getByRole("button", { name: /Approve exact transfer/ }).click();
  await page.getByRole("button", { name: "Edit amount" }).click();
  await page.getByLabel("New amount in dollars").fill("30");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Approve exact transfer \(v2\)/ }),
  ).toBeEnabled();
  const actionUrl = page.url();
  await page.getByRole("button", { name: /Approve exact transfer/ }).click();
  await page.goto("/control");
  await page.getByRole("button", { name: /Pause all execution/ }).click();
  await expect(page.getByRole("button", { name: /Resume/ })).toBeVisible();
  const id = new URL(actionUrl).searchParams.get("id");
  const res = await request.post(`/api/actions/${id}/execute`);
  expect(res.status()).toBe(409);
  await page.getByRole("button", { name: /Resume/ }).click();
  await page.getByLabel("Per-transfer limit").fill("2000");
  await page.getByLabel("Daily limit", { exact: true }).fill("5000");
  await page.getByRole("button", { name: "Save limits" }).click();
  await expect(page.getByText(/Saved/)).toBeVisible();
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Review transfer", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Previously verified ·/)).toHaveCount(0);
});

test("assistant fallback is labeled and demo-user switch clears history", async ({
  page,
}) => {
  await page.goto("/chat");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Which subscriptions went up in price?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Fallback — model unavailable, deterministic summary", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Demo user").selectOption("bob");
  await expect(page.getByLabel("Demo user")).toHaveValue("bob");
  await expect(
    page.getByText("Fallback — model unavailable, deterministic summary", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Hello, Bob." }),
  ).toBeVisible();
  await expect(
    page.getByText("Everyday Checking", { exact: true }),
  ).toHaveCount(0);
});

test("API errors render visibly, unknown accounts stay private, reduced motion", async ({
  page,
  request,
}) => {
  await page.route("**/api/accounts", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL",
          message: "Accounts temporarily unavailable",
        },
      }),
    }),
  );
  await page.goto("/");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Accounts temporarily unavailable" }),
  ).toBeVisible();
  await page.unroute("**/api/accounts");
  await page.reload();
  await expect(
    page.getByText("Everyday Checking", { exact: true }),
  ).toBeVisible();
  const res = await request.get(
    "/api/transactions?accountId=acct_bob_checking",
  );
  expect(res.status()).toBe(404);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".pill")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
  await checkLayout(page);
});

test("overview rent scenario opens a real proposal and close returns to the list", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try rent review", exact: true })
    .click();
  await expect(page).toHaveURL(/transfers\?id=/);
  await expect(
    page.getByRole("button", {
      name: "Verify recipient (simulated out-of-band check)",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close transfer details", exact: true })
    .click();
  await expect(page).toHaveURL(/\/transfers$/);
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Overview", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Review transfer", exact: true }),
  ).toBeVisible();
});
