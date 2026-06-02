/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const REPORT_PATH = path.join(process.cwd(), 'auth0_probe_report.json');

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

(async () => {
  const runId = Date.now();
  const signupEmail = `chessapp.auth0.probe.${runId}@example.com`;
  const signupPassword = `ChessApp!${String(runId).slice(-8)}Aa1`;

  const report = {
    startedAt: nowIso(),
    baseUrl: BASE_URL,
    signupEmail,
    signupPassword,
    navigations: [],
    redirectLikeResponses: [],
    authResponses: [],
    responses4xx5xx: [],
    requestFailures: [],
    consoleErrors: [],
    pageErrors: [],
    actions: [],
    final: {},
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      report.navigations.push({ at: nowIso(), url: frame.url() });
    }
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      report.consoleErrors.push({ at: nowIso(), type: msg.type(), text: msg.text() });
    }
  });

  page.on('pageerror', (err) => {
    report.pageErrors.push({ at: nowIso(), message: String(err) });
  });

  page.on('requestfailed', (req) => {
    report.requestFailures.push({
      at: nowIso(),
      method: req.method(),
      url: req.url(),
      failure: req.failure() ? req.failure().errorText : 'unknown',
    });
  });

  page.on('response', async (res) => {
    const status = res.status();
    const url = res.url();
    const headers = await res.allHeaders();
    const location = headers.location || null;
    const setCookie = headers['set-cookie'] || null;

    if ([301, 302, 303, 307, 308].includes(status)) {
      report.redirectLikeResponses.push({ at: nowIso(), status, url, location });
    }

    if (/auth|login|logout|authorize|callback|session|oauth|openid/i.test(url)) {
      report.authResponses.push({ at: nowIso(), status, url, location, hasSetCookie: Boolean(setCookie) });
    }

    if (status >= 400) {
      report.responses4xx5xx.push({ at: nowIso(), status, url });
    }
  });

  try {
    await page.goto(`${BASE_URL}/auth/login?screen_hint=signup`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    report.actions.push({ at: nowIso(), action: 'goto_signup' });

    let completedReturnToApp = false;

    for (let step = 0; step < 12; step += 1) {
      const url = page.url();
      report.actions.push({ at: nowIso(), action: 'step', step, url });

      if (url.startsWith(BASE_URL)) {
        completedReturnToApp = true;
        break;
      }

      const filledEmail = await maybeFill(page, [
        'input[type="email"]',
        'input[name="email"]',
        'input[name="username"]',
        'input#username',
        'input#email',
      ], signupEmail);
      if (filledEmail) report.actions.push({ at: nowIso(), action: 'filled_email', selector: filledEmail });

      const filledPassword = await maybeFill(page, [
        'input[type="password"]',
        'input[name="password"]',
        'input#password',
        'input[name="new-password"]',
      ], signupPassword);
      if (filledPassword) report.actions.push({ at: nowIso(), action: 'filled_password', selector: filledPassword });

      const clicked = await maybeClick(page, [
        'button[type="submit"]',
        'button:has-text("Continue")',
        'button:has-text("Sign up")',
        'button:has-text("Create account")',
        'button:has-text("Log in")',
        'button:has-text("Login")',
        'a:has-text("Continue")',
      ]);
      if (clicked) {
        report.actions.push({ at: nowIso(), action: 'clicked', selector: clicked });
      }

      await page.waitForTimeout(2500);

      const visibleErrorText = await page.locator('text=/invalid|error|failed|try again|captcha|blocked|not allowed/i').first().textContent().catch(() => null);
      if (visibleErrorText) {
        report.actions.push({ at: nowIso(), action: 'visible_error', text: visibleErrorText.trim() });
      }

      if (page.url().startsWith(BASE_URL)) {
        completedReturnToApp = true;
        break;
      }
    }

    await page.waitForTimeout(2000);

    const cookies = await context.cookies();
    const appCookies = cookies.filter((c) => c.domain.includes('localhost') || c.domain.includes('127.0.0.1'));

    report.final = {
      endedAt: nowIso(),
      finalUrl: page.url(),
      completedReturnToApp,
      cookieCountAll: cookies.length,
      cookieCountApp: appCookies.length,
      appCookies: appCookies.map((c) => ({
        name: c.name,
        domain: c.domain,
        path: c.path,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
        expires: c.expires,
      })),
    };
  } catch (err) {
    report.final = {
      endedAt: nowIso(),
      fatalError: String(err),
      finalUrl: page.url(),
    };
  } finally {
    await browser.close();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log(REPORT_PATH);
  }
})();
