# Voice input spike

The conversation composer can record a short message and transcribe it through
OpenAI. Tap the microphone, speak, then tap Finish. The transcript appends to the
current draft, including edits made while waiting. Review it before pressing Send.

On phones, an empty composer leads with "Speak a message" beside a keyboard
button that opens and focuses the text input. After transcription, Send becomes
the main action and "Add voice" appends another recording. While recording,
Finish stops and transcribes the audio; Cancel discards it. Permission waits and
transcription show a progress indicator and Cancel. The input grows with the
draft, and short screens use a compact waveform and working indicator.

The live waveform shows recent microphone levels through Web Audio's
`AnalyserNode`. It reuses the recording stream without playing it back or making
another microphone request. Silence produces a flat baseline. Reduced-motion
mode shows the current level without scrolling history. If analysis is
unavailable, recording still works. The analyser and its audio context are
released when recording ends.

Cancel discards the recording. Navigating away or hiding the page cancels voice
input and releases the microphone. Recordings stop automatically at two minutes.
Failed transcriptions leave the draft unchanged; record again to retry.

## Configuration

Set `OPENAI_API_KEY` on the **home bridge**, the bridge that serves the browser
page. This also enables dictation when viewing threads on other hosts. Keys are
never sent to the browser or to those other hosts.

For the managed service, add the key to
`~/.config/herdr-control/environment`, then restart the updated bridge. For a
local trial, put `OPENAI_API_KEY=...` in the repository's ignored `.env` file and
run the built bridge with:

```sh
npm run build
node --env-file=.env dist/server/server/index.js
```

Use a free `HERDR_CONTROL_PORT` if another bridge is already running. Phone
microphone access requires HTTPS; localhost works for desktop development.
The mic appears only when the home bridge has a key and the browser supports
recording in a secure context. Keyboard dictation still works independently.

The default model is `gpt-transcribe`. `HERDR_CONTROL_TRANSCRIPTION_MODEL` can
override it for comparison with another model that supports the same file
transcription API, such as `gpt-4o-mini-transcribe`.

## Implementation and verification

The browser records WebM/Opus or MP4 using `MediaRecorder`. The home bridge accepts
up to 10 MiB, keeps audio in memory, and submits it to
`https://api.openai.com/v1/audio/transcriptions`. It accepts one transcription at
a time, applies a 45-second upstream timeout, and never retries automatically.
Audio is sent to OpenAI only after recording stops. It is not written to disk by
Control or added to conversation history. The resulting draft uses the existing
device storage and normal Send flow.

The prompt supplies vocabulary hints for Herdr, Schematify, Codex, TypeScript and
GitHub. It does not send conversation history or repository contents.

The API and model contract were checked against the
[official OpenAI transcription documentation](https://developers.openai.com/api/docs/guides/speech-to-text)
on 2026-09-05. Browser contracts are documented by
[MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
and [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

Automated checks cover the upload contract, provider errors, recording with
Chromium's synthetic microphone, draft preservation, cancellation, navigation,
permission denial, and mobile/desktop layouts. These tests do not contact OpenAI.
Real-phone microphone behaviour and transcription quality require a live trial.

On 2026-09-05, a live `gpt-transcribe` request using a short synthetic WAV returned
the expected sentence: "Please review the TypeScript changes and check the
microphone button." The configured API key and file upload path were accepted.
This confirms connectivity, not recognition quality on a phone microphone.
