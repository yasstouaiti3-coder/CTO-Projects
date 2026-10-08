# CTO-Projects

Repository for the **FocusPilot** product.

FocusPilot is a small web app for adults who struggle with task initiation and
follow-through at work: capture something messy, get a small suggested first
step, run a 10/20/30-minute focus sprint that shows only that step, tap
"I'm stuck" for one practical prompt, and close the loop by recording what
happened. It is a productivity aid — not a diagnosis, a treatment, or therapy.

- App source: `src/` (TanStack Start + React + Vite + Tailwind).
- The app is imported onto the branch `import/focuspilot-app`; see that pull
  request for what is built, what is verified, and what is still blocked.

## Status

Every v1 feature is built and has been clicked through in a real browser
against a real database. Nothing is connected to a hosted database or a model
provider yet, so on the live site the app stores nothing (and says so plainly)
and the task breakdown / "I'm stuck" text comes from labelled scripted steps
rather than a model. No payment account is connected and no revenue exists.
