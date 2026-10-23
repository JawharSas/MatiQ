# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately, **not** in public issues:

- Use GitHub's **Report a vulnerability** button (Security tab > Advisories), or
- email the address configured as `EXPO_PUBLIC_SUPPORT_EMAIL` for this deployment.

Include steps to reproduce, the affected component (mobile app, Edge Function,
database policy) and the impact you observed. We aim to acknowledge reports
within 3 business days and to ship fixes for critical issues as quickly as
possible. Please give us reasonable time to fix an issue before disclosure, and
do not access, modify or delete other users' data while testing.

## Scope

In scope: the code in this repository and deployments built from it.
Out of scope: denial-of-service, social engineering, and findings that require
a rooted/jailbroken device with the victim's unlocked phone.

## Design references

- [docs/SECURITY_AND_DEPLOYMENT.md](docs/SECURITY_AND_DEPLOYMENT.md) - threat model, controls, deployment hardening.
- [supabase/tests/database/01_security.test.sql](supabase/tests/database/01_security.test.sql) - executable checks for every privacy and privilege rule.
