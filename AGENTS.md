# AGENTS.md

Instructions for an AI coding agent working in this repo.

## Install, run, test

- Install: `npm ci` (Node 20 or newer). There are no dependencies; this only checks the lockfile.
- Run: these are libraries, not a program. Import `lib/resend-bounce.js` and
  `lib/email-breaker.js` from your own code, or try one call:
  `node -e "import('./lib/email-breaker.js').then(m => console.log(m.breakerVerdict({ sentInWindow: 250, hardBounced: 13 })))"`
- Test: `npm test` (runs `node --test` over `test/`). It must pass before every commit.

## Where you may work

- `lib/`: the two libraries. Keep them free of imports, I/O, clocks and randomness.
- `test/`: add tests freely. Keep the four `invariant N:` test names and the
  `legacy flat read yields empty` test; they are the contract.
- `README.md`, `AGENTS.md`.

## What you must never do

- Never change a threshold in `BREAKER_DEFAULTS` without changing the invariant tests and the
  README in the same commit.
- Never make `isHardBounceType(null)` return `false`. Unknown is not harmless.
- Never let a transient bounce count toward the breaker or a suppression.
- Never add a dependency.
- Never put a real e-mail address, name, token, host or provider id in a fixture. Fixtures use
  example.com addresses and all-zero ids.
- Never push, publish or change repository settings unless your human asks.

## Before every commit

Run an identity and secret scan over the tree and the git history: no real addresses, names,
tokens, hosts or ids. The maintainer runs one outside this repo; if you have no scanner, at least
grep the diff for `@`, `token`, `key` and long hex strings, and read every hit.
