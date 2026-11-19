# Sabarimala booking console (4 bots)

1. `npm install`
2. `npx playwright install chromium`   (one time; this is the hidden/headless browser)
3. `npm start`  ->  open http://localhost:3000
4. Pick a bot tab (**Bot 1 - Bot 4**), fill the form, press **Start Bot N**.

Each bot has its **own settings, own browser, own login and own console**.
Direct links: `/#bot1`, `/#bot2`, `/#bot3`, `/#bot4`, and `/#all` (all four consoles side by side).
Use a **different account (or different pilgrims) per bot**: the wishlist belongs to the account,
so two bots on the same account would clear each other's wishlist.

## Never-stop behaviour

* A failed attempt is retried up to **5 times** (5 s apart, same browser, restarting from the first step).
* If the 5 retries do not work, the browser is closed, the bot waits **1 minute**, then starts again
  from a **fresh browser and a fresh login**. Retries / delays are in *More settings*.
* The bot never gives up. It ends only when **every pilgrim is booked**, or when you press **Stop**.

Credentials are typed in the UI; they are not stored in any file.
`e2e/bot.js` is your `test.js` made config-driven (one independent instance per bot). Your old scripts are untouched.

## Docker

The `Dockerfile` uses the Playwright 1.56.1 Jammy image and listens on
`0.0.0.0`. Set `APP_PASSWORD` to a secret of at least 16 characters when
running the container; the server will refuse to start on a network interface
without it. The optional `APP_USERNAME` defaults to `admin`. Basic
authentication protects the UI and all API endpoints.

On Railway, set the service's **Root Directory** to `app` and add
`APP_PASSWORD` (and optionally `APP_USERNAME`) under **Variables**. Railway
provides `PORT`; the Dockerfile's `3000` value is only a fallback. Keep
`APP_PASSWORD` out of the repository.

Local development defaults to `127.0.0.1` and does not require app
authentication. If you set `APP_PASSWORD` locally, open the page and enter
`admin` (or your configured `APP_USERNAME`) and that password in the browser's
authentication prompt.
