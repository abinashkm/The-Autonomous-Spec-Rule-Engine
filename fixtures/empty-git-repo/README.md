# Empty git repo fixture

Used by SpecGate tests that need a clean slate — e.g. idempotency, `init`
bootstrap, and `doctor` on a repo with no detectable stack.

Tests copy this directory into a temp location, run `git init` there, then
exercise the CLI against it. Nothing in this directory should imply any
particular language or framework.
