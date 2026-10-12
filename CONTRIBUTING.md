# Contributing

Bug reports and focused pull requests are welcome.

## Before opening an issue

- Include the extension version and the affected WeChat backend section.
- Describe the steps to reproduce and the expected versus actual result.
- Remove account identifiers, article URLs containing session parameters, cookies, tokens, and private article data from screenshots or logs.

## Changes

- Keep collection read-only and limited to the account owner's own backend data.
- Do not add remote telemetry, credential storage, automated publishing, or CAPTCHA workarounds.
- Preserve blank values for metrics the platform does not provide.
- Add or update focused tests for parsing and CSV behavior when changing those areas.

## Local checks

```sh
npm test
node --check collector.js
node --check lib/core.js
node --check popup.js
```
