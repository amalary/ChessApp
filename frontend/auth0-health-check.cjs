/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.AUTH_VERIFY_BASE_URL || "http://localhost:3000";
const REPORT_PATH = path.join(process.cwd(), "auth_health_report.json");

function nowIso() {
  return new Date().toISOString();
}

async function maybeFill(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.fill(value, { timeout: 1500 });
        return selector;
      } catch {
        // continue
      }
    }
  }
  return null;
}

async function maybeClick(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.click({ timeout: 1500 });
        return selector;
      } catch {
        // continue
      }
    }
  }
  return null;
}

async function fetchAuthMe(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/me", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const rawBody = await response.text();
    let bodyJson = null;
    try {
      bodyJson = JSON.parse(rawBody);
    } catch {
      bodyJson = null;
    }

    return {
      at: new Date().toISOString(),
      status: response.status,
      ok: response.ok,
      url: response.url,
      contentType: response.headers.get("content-type") || "",
      bodyTextLength: rawBody.length,
      bodyTextPreview: rawBody.slice(0, 800),
      bodyJson,
    };
  });
}

function assertOrThrow(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  const runId = Date.now();
  const signupEmail = `chessapp.auth0.health.${runId}@example.com`;
  const signupPassword = `ChessApp!${String(runId).slice(-8)}Aa1`;

  const report = {
    checkedAt: nowIso(),
    baseUrl: BASE_URL,
    signupEmail,
    steps: [],
    loginPhase: {},
    afterLoginAuthMe: null,
    logoutPhase: {},
    afterLogoutAuthMe: null,
    finalUrl: null,
    pass: false,
    error: null,
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/auth/login?screen_hint=signup`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    report.steps.push({
      at: nowIso(),
      action: "goto_login_signup",
      url: page.url(),
    });

    let returnedToApp = false;
    for (let i = 0; i < 14; i += 1) {
      if (page.url().startsWith(BASE_URL)) {
        returnedToApp = true;
        break;
      }

      const emailSelector = await maybeFill(
        page,
        [
          'input[type="email"]',
          'input[name="email"]',
          'input[name="username"]',
          "input#username",
          "input#email",
        ],
        signupEmail,
      );
      if (emailSelector) {
        report.steps.push({
          at: nowIso(),
          action: "filled_email",
          selector: emailSelector,
        });
      }

      const passwordSelector = await maybeFill(
        page,
        [
          'input[type="password"]',
          'input[name="password"]',
          "input#password",
          'input[name="new-password"]',
        ],
        signupPassword,
      );
      if (passwordSelector) {
        report.steps.push({
          at: nowIso(),
          action: "filled_password",
          selector: passwordSelector,
        });
      }

      const clickedSelector = await maybeClick(page, [
        'button[type="submit"]',
        'button:has-text("Continue")',
        'button:has-text("Sign up")',
        'button:has-text("Create account")',
        'button:has-text("Log in")',
        'button:has-text("Login")',
      ]);
      if (clickedSelector) {
        report.steps.push({
          at: nowIso(),
          action: "clicked",
          selector: clickedSelector,
        });
      }

      await page.waitForTimeout(2500);
    }

    report.loginPhase = {
      returnedToApp,
      urlAfterLogin: page.url(),
    };
    assertOrThrow(returnedToApp, `Login did not return to app origin: ${page.url()}`);

    const authMeLoggedIn = await fetchAuthMe(page);
    report.afterLoginAuthMe = authMeLoggedIn;
    assertOrThrow(authMeLoggedIn.status === 200, `Expected /api/auth/me 200 after login, got ${authMeLoggedIn.status}`);
    assertOrThrow(
      Boolean(authMeLoggedIn.bodyJson && authMeLoggedIn.bodyJson.sub),
      "Expected /api/auth/me response to include user sub after login",
    );
    assertOrThrow(
      Boolean(
        authMeLoggedIn.bodyJson &&
          Object.prototype.hasOwnProperty.call(authMeLoggedIn.bodyJson, "email_verified"),
      ),
      "Expected /api/auth/me response to include email_verified claim after login",
    );

    const logoutUrl = `${BASE_URL}/api/auth/logout?returnTo=%2Flogin-test`;
    await page.goto(logoutUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(800);

    report.logoutPhase = {
      requested: logoutUrl,
      urlAfterLogout: page.url(),
    };

    const authMeLoggedOut = await fetchAuthMe(page);
    report.afterLogoutAuthMe = authMeLoggedOut;
    assertOrThrow(
      authMeLoggedOut.status === 401,
      `Expected /api/auth/me 401 after logout, got ${authMeLoggedOut.status}`,
    );
    assertOrThrow(
      Boolean(authMeLoggedOut.bodyJson && authMeLoggedOut.bodyJson.error === "not_authenticated"),
      'Expected /api/auth/me error "not_authenticated" after logout',
    );

    report.finalUrl = page.url();
    report.pass = true;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    report.pass = false;
  } finally {
    await browser.close();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  }

  if (!report.pass) {
    throw new Error(report.error || `Auth health check failed. See ${REPORT_PATH}`);
  }

  console.log(REPORT_PATH);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
