# Voicemail greetings

Recorded greetings Twilio plays when nobody answers an inbound call. Which
number plays which file is set in `src/calls/voicemail.util.ts`.

| File | Line |
| --- | --- |
| `digdeeper.mp3` | D.I.G. Deeper, (904) 595-9620 |

Until a file is here the caller hears the greeting's `fallbackText` read by
text to speech, so a missing file never breaks the line.

To change a greeting, replace the file with an MP3 of the same name and
deploy. Keep it under about 25 seconds: callers start hanging up past that.
The file is served publicly at `/calls/twilio/voicemail/greeting/<file>`
because Twilio fetches it unauthenticated, so put nothing in it you would not
say to any caller.
