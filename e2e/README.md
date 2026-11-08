# End-to-end tests (Playwright)

Tests run against a running stack at `WEB_URL` (default `http://localhost:8080`).

    make up                # or: scripts/dev.sh up --static
    npm run e2e            # or: make e2e / scripts/dev.sh e2e

## Browser

On a normal machine install Playwright's Chromium once:

    npx playwright install chromium

Where the Playwright browser download host is unreachable (the orchestrator workspace), point
Playwright at an installed Chrome/Chromium instead:

    PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm run e2e

`playwright.config.ts` passes that path as `launchOptions.executablePath`, and adds
`--no-sandbox` when running as root. In the orchestrator workspace, `/usr/bin/google-chrome`
(Chrome for Testing 153.0.8010.12) is installed and no Playwright cache exists in
`~/.cache/ms-playwright`.

## Tests that write

`review.spec.ts`, `edit-report.spec.ts` and `history.spec.ts` review and edit reports, and
`settings-writes.spec.ts` changes the company settings. They run as their own Playwright projects,
after the read-only tests and one project at a time (see `playwright.config.ts`). The report tests
reseed the mock data before each test and once at the end, by running `scripts/dev.sh seed`; set
`RESEED_COMMAND` (a shell command) for a stack started another way, for example
`RESEED_COMMAND="make seed"`. To run one of them alone: `npx playwright test review.spec --project=reviews --no-deps`.

## Other variables

- `WEB_URL`: base URL of the web app (default `http://localhost:8080`).

Reports and traces go to `playwright-report/` and `test-results/` (gitignored).
