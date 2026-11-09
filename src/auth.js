export function assertSignIn(url) {
  const u = new URL(url);
  if (u.origin !== 'https://optionsgame.com.au' || u.pathname !== '/' || u.hash !== '#/signin' || u.username || u.password)
    throw Object.assign(new Error('Refusing to enter credentials outside the exact game sign-in page.'), { code: 'LOGIN_ROUTE_NOT_READY' });
}

// Password values and Playwright fill errors must never escape this function.
export async function signIn(page, credentials, timeout = 30000) {
  assertSignIn(page.url());
  try {
    await page.locator('form#login input#email').fill(credentials.email);
    assertSignIn(page.url());
    await page.locator('form#login input#password').fill(credentials.password);
    assertSignIn(page.url());
    await page.locator('form#login').getByRole('button', { name: 'LOGIN', exact: true }).click();
    await page.locator('a[href^="#!/portfolio/"]').first().waitFor({ state: 'attached', timeout });
  } catch {
    throw new Error('Automatic login did not reach the game. Credentials may be invalid, or CAPTCHA/MFA/account action may be required. No automatic retry was attempted.');
  }
}
