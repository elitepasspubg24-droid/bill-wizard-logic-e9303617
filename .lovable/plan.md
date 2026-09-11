# Never pay Meta for a WhatsApp message

Two safeguards, one in your app and one in your Meta account.

## 1. The app never replies late

Right now the bot replies to whatever arrives, even if it arrives after a long
outage and the free 24-hour window has already closed. That is the only case
where Meta could bill you.

Change: before replying, check how old the incoming message is.

- Under 23 hours old: reply as normal (free).
- Older than 23 hours: skip the reply entirely and note it in the logs, so
  nothing paid ever leaves your number.

Also: the bot currently answers unapproved numbers with "not authorised". That
reply is still inside the free window, so it costs nothing, but it does let
strangers confirm the number is live. Option to silently ignore unapproved
numbers instead — your choice.

## 2. A hard spending cap at Meta

Meta lets you set an account spending limit on the WhatsApp account's payment
settings. Setting it to a very small amount (or leaving no payment method on
file at all) means Meta cannot charge you even if something unexpected happens.
This is done in your Meta account, not in the app — I will write out the exact
click-path for you.

## Technical detail

In `src/routes/api/public/hooks/whatsapp.ts`, inside the per-message loop:
read `msg.timestamp` (Unix seconds from Meta), compare against `Date.now()`,
and `continue` when the age exceeds 23 hours — before any
`sendWhatsAppText` call, including the not-authorised branch and the
unsupported-type branch. No other behaviour changes.
