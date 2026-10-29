# Accessibility: WCAG 2.2 AA

MatIQ targets **WCAG 2.2 Level AA** for the Android and iOS app (one React
Native code base). This page records how each success criterion is met, how
it is tested, and the known limitations. Last reviewed for version 1.4.0.

## How it is tested

| Check | Where | Runs |
|---|---|---|
| **axe-core 4.14** with the `wcag2a/aa`, `wcag21a/aa` and `wcag22a/aa` rule sets on every screen and state of the UI walkthrough (50 screenshots, including large text, high contrast, landscape and 320 px width). Any violation fails the run. | `apps/mobile/scripts/preview-walkthrough.cjs` → `preview-screenshots/a11y-report.json` | CI on every pull request, and every release |
| **TalkBack labels on the real APK**: every tappable element on the sign-in and sign-up screens must expose text or a content description. | `scripts/android-launch-test.sh` (Android 14 emulator) | Every release |
| **200% font size** and **landscape** on the real APK (sign-in screen renders, nothing missing). | same | Every release |
| Contrast of every colour token against every surface, computed (all text ≥ 4.5:1, controls ≥ 3:1). | `apps/mobile/src/ui/theme.ts` | On change |
| Manual review against each criterion below. | this page | Each release with UI changes |

Not yet done: testing sessions with disabled users and a full TalkBack /
VoiceOver pass by a specialist. Feedback goes to the support email shown in
**Settings → Accessibility**.

## Accessibility settings (in the app)

**Settings → Accessibility** (also linked from the sign-in screen, so it works
before signing in):

- **Text size**: Default, Large, Larger, Largest (up to 1.5×), on top of the
  phone's own font size, which MatIQ always follows.
- **High contrast**: secondary text becomes full white and cards, lists and
  buttons get visible outlines.
- **Motion**: follow the phone (Remove animations / Reduce Motion), always
  reduce, or full. Reduced motion turns off screen transitions, press
  animations and highlight autoplay.
- Shortcuts to the phone's accessibility settings and to accessibility
  feedback.

These are real settings that change the app; there is no overlay widget.

## Success criteria

| Criterion | Level | Status | How |
|---|---|---|---|
| 1.1.1 Non-text content | A | Supports | Icon-only controls have labels (e.g. "Report post", "Like post, 2 likes"); decorative icons, icon tiles and the Google "G" are hidden from screen readers; avatars are decorative next to the visible name; the timeline has a text phase legend and a highlight list; the 2FA QR code has the secret as text. |
| 1.2.1 Audio-only and video-only | A | Partially supports | Sparring videos are user content without meaningful audio. Every analysed video has a text alternative: the scorecard, score log, timeline legend and highlight list. |
| 1.2.2 Captions (prerecorded) | A | Not applicable / limitation | User-recorded sparring has no spoken content to caption. Speech in uploaded videos is not captioned. |
| 1.2.3 Audio description or media alternative | A | Supports | The analysis (events, scores, coaching notes) is a text alternative for the video. |
| 1.2.4 Captions (live) | AA | Not applicable | No live broadcast; live recording is the person's own camera. |
| 1.2.5 Audio description | AA | Supports (alternative) | As 1.2.3. |
| 1.3.1 Info and relationships | A | Supports | Headings use the header role (titles, section labels, card headings); lists of options are radio groups; checkboxes, switches, tabs and progress bars use their roles; form labels are programmatic. |
| 1.3.2 Meaningful sequence | A | Supports | Reading order follows the visual order. |
| 1.3.3 Sensory characteristics | A | Supports | Instructions never rely on shape, position or colour alone. |
| 1.3.4 Orientation | AA | Supports | Orientation is not locked (`orientation: 'default'`); checked in landscape on the emulator and in the walkthrough. |
| 1.3.5 Identify input purpose | AA | Supports | Email, password, new password, username, name, birth year and one-time code fields set `autoComplete` / `textContentType`. |
| 1.4.1 Use of colour | A | Supports | Links in sentences are underlined; corners are named (Fighter 1 / 2 and names), not only blue/red; selected options also get an outline, a bold label or a filled radio ring; statuses have text. |
| 1.4.2 Audio control | A | Supports | Video plays only after the person taps a highlight or Play, and has native pause and mute controls; highlights stop at their end. |
| 1.4.3 Contrast (minimum) | AA | Supports | All text tokens ≥ 4.5:1 on every surface and tinted badge (faint grey raised to #8A93A2, red to #F87171, blue to #60A5FA); filtered-out values stay at 4.5:1. Verified by axe on all screens. |
| 1.4.4 Resize text | AA | Supports | Text follows the phone's font size (no caps) plus the in-app size; segmented controls stack instead of cutting words; checked at 200% on the emulator and at Largest in the walkthrough. |
| 1.4.5 Images of text | AA | Supports | Only the logo is an image of text. |
| 1.4.10 Reflow | AA | Supports | Single-column scrolling layouts; checked at 320 px width. |
| 1.4.11 Non-text contrast | AA | Supports | Inputs, switches (off track), checkboxes and option chips have outlines ≥ 3:1; the focus ring is white on dark. |
| 1.4.12 Text spacing | AA | Supports | No fixed-height text containers; controls use minimum heights. |
| 1.4.13 Content on hover or focus | AA | Not applicable | No hover or focus pop-ups. |
| 2.1.1 Keyboard | A | Supports | Every control is a focusable Pressable (keyboard, switch access); text-only pages are focusable so they scroll; timeline taps have list equivalents. |
| 2.1.2 No keyboard trap | A | Supports | No traps; modals close with Back / Cancel. |
| 2.1.4 Character key shortcuts | A | Not applicable | None. |
| 2.2.1 Timing adjustable | A | Supports | No time limits on reading or input; sessions refresh automatically; ranked confirmation windows are days long. |
| 2.2.2 Pause, stop, hide | A | Supports | The only moving content is video (user-started, pausable) and the live score while the person records (stops with the recording). |
| 2.3.1 Three flashes | A | Supports | No flashing content. |
| 2.4.1 Bypass blocks | A | Supports | Tab bar navigation; no repeated blocks within screens. |
| 2.4.2 Page titled | A | Supports | Every screen has a title in its header (document title on the web). |
| 2.4.3 Focus order | A | Supports | Follows the layout. |
| 2.4.4 Link purpose | A | Supports | Link text says where it goes ("Read the Privacy Policy", match titles). |
| 2.4.5 Multiple ways | AA | Not applicable | Applies to sets of web pages; the app has a tab bar and in-context links. |
| 2.4.6 Headings and labels | AA | Supports | Descriptive headings and field labels. |
| 2.4.7 Focus visible | AA | Supports | 2 px white focus ring on buttons, rows, chips, tabs and checkboxes; inputs get an orange border when focused. |
| 2.4.11 Focus not obscured | AA | Supports | Screens scroll; the tab bar does not cover focused content. |
| 2.5.1 Pointer gestures | A | Supports | No multi-finger or path gestures. |
| 2.5.2 Pointer cancellation | A | Supports | Actions fire on release. |
| 2.5.3 Label in name | A | Supports | Accessible names start with or contain the visible text (list rows are named by their title and subtitle). Checked by axe. |
| 2.5.4 Motion actuation | A | Not applicable | No motion-triggered actions. |
| 2.5.7 Dragging movements | AA | Supports | No dragging needed; the timeline is tap-to-seek and every seek target is also in the highlight list. |
| 2.5.8 Target size (minimum) | AA | Supports | Controls are at least 44 pt high; small timeline markers have the equivalent highlight list (equivalent exception). |
| 3.1.1 Language of page | A | Supports | English; the web build sets `lang`. |
| 3.1.2 Language of parts | AA | Supports | No other-language passages. |
| 3.2.1 On focus | A | Supports | Focus never triggers changes. |
| 3.2.2 On input | A | Supports | Choosing an option never navigates; forms submit with a button. |
| 3.2.3 Consistent navigation | AA | Supports | Same tab bar and header pattern everywhere. |
| 3.2.4 Consistent identification | AA | Supports | Same icons and labels for the same functions. |
| 3.2.6 Consistent help | A | Supports | Help and support is always in Settings → General; accessibility feedback in Settings → Accessibility. |
| 3.3.1 Error identification | A | Supports | Errors are shown in text next to the action and announced (alert role / live region); a field with its own error also gets a red border and the error as its hint. |
| 3.3.2 Labels or instructions | A | Supports | Every field has a visible label; requirements are stated (password rules, "All fields are required", 4-digit year). |
| 3.3.3 Error suggestion | AA | Supports | Messages say how to fix it ("Enter your birth year as 4 digits, for example 1998"). |
| 3.3.4 Error prevention (legal, financial, data) | AA | Supports | Agreements need a deliberate tick; account deletion needs typed confirmation plus a confirm dialog; takedowns need a reason and confirmation. |
| 3.3.7 Redundant entry | A | Supports | Nothing is asked twice (no password confirmation field; the birth month is asked once). |
| 3.3.8 Accessible authentication (minimum) | AA | Supports | Password managers and paste work (autocomplete set); the 2FA code supports one-time-code autofill and paste; Google sign-in needs no password. No puzzles or memory tests. |
| 4.1.2 Name, role, value | A | Supports | Roles and states on every control (checked, selected, disabled, busy, progress values). Checked by axe and the TalkBack label check. |
| 4.1.3 Status messages | AA | Supports | Analysis status, processing steps and errors are announced without moving focus. |

## Known limitations

- Spoken content in uploaded videos is not captioned (1.2.2).
- Recording live needs the ability to aim a phone camera; uploading an
  existing video is the alternative.
- AI coaching text may be inaccurate (see Terms); it is not an accessibility
  issue but is worth knowing for people who rely on it instead of the video.
- Screens shown by other apps (Google's sign-in page in the browser, the
  system share sheet, the phone's file picker) follow those apps' own
  accessibility.
