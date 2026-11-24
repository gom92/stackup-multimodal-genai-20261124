# StoryVoice — Type it. Hear it. See it.

A tiny multimodal storyteller built for the **StackUp November Coding Challenge
(Multimodal GenAI theme)**. One prompt becomes three modalities:

1. **✍️ Text** — the free Pollinations text API writes a short illustrated story.
2. **🎨 Image** — the free Pollinations image API draws the illustration.
3. **🔊 Speech** — the browser's built-in speech synthesis narrates the story
   aloud, with sentence highlighting and voice / speed controls. A microphone
   button (Web Speech API speech recognition) lets you speak the prompt instead
   of typing it.

**Zero keys, zero accounts, zero cost.** No sign-ups, no API keys, no uploads,
no tracking. Prompts are sent to Pollinations only when you press
“Tell me a story”.

## How to run

```bash
# any static server works, e.g.
python3 -m http.server 8000
# then open http://localhost:8000
```

Or just open `index.html` directly in a browser. Serving over localhost is
recommended: speech recognition works more reliably that way.

## What is live vs what is demo

| Feature | Status |
|---|---|
| Story text via Pollinations text API (`model=openai`) | **Live** — verified 2026-11-24 from this VM and in a real Chromium run (see `tests/results.json`). |
| Illustration via Pollinations image API (`model=flux`) | **Live** — verified in the same browser run; the `<img>` loads a real generated JPEG. |
| Narration via `speechSynthesis` | **Live in a real desktop browser** (Chrome/Edge/Safari ship voices). In headless Chromium there are no system voices, so the app falls back to a clearly-labelled **visual narration** (sentences highlighted on a timer) and says so in the status line. It never pretends silent highlighting is audio. |
| Mic input via `SpeechRecognition` | **Live where supported** (desktop Chrome/Edge). In browsers without it, the button is disabled with an explanation. |
| Fallback sample story | If the Pollinations text API is unreachable, the app shows a built-in sample story with a yellow banner saying so. It is never presented as AI output. |

## Files

- `index.html` — the page (no build step, no CDN dependencies)
- `app.js` — all logic: Pollinations calls, image loading, speech synthesis + recognition
- `styles.css` — storybook styling
- `tests/test.mjs` — Playwright real-browser verification (see `tests/results.json`)
- `tests/record-demo.mjs` — records the demo video
- `demo.mp4` — demo video (≤ 2 min, real app in a real browser)

## Verification (2026-11-24, real Chromium via Playwright)

Run: `node tests/test.mjs` (needs `playwright-core` + a Chromium build, and the
local forward proxy on 127.0.0.1:18080 on this VM — see `tests/test.mjs`).

- Page loads with no page errors
- Story text generates via the live Pollinations API
- Illustration loads (real JPEG, `naturalWidth > 0`)
- Read-aloud / Stop buttons wired; narration status changes on click
- Mic button present; disabled state shown honestly when recognition is unavailable

## StackUp submission

- Challenge: StackUp November Coding Challenge — Multimodal GenAI
- Prize pool: $700 ($250 first place)
- Submissions close: 2026-11-25 12:00 Beijing; winners announced Nov 30
- Repo + submission are handled separately by the project owner (not part of this build).

## License

MIT — see `LICENSE`.
