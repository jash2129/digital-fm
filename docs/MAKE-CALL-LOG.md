# Call log in Make.com: build steps

**Status:** the app side is built. When a call ends, the app saves the log and recording, then
`POST /api/call-log/<session id>` sends them to Make from the server (`src/lib/call-log-webhook.ts`),
so the secret never reaches the browser. With no `CALL_LOG_WEBHOOK_URL` set, nothing is sent. After
the call, the start screen shows the first 8 characters of the call ID for the tester's feedback.

When a call ends, the Max app sends one webhook to Make with the call's numbers, its transcript,
the recording and the full log. The Make scenario saves the recording and the log to Google Drive
and adds one row to your Google Sheet with links to both.

```
[1 Webhook] → (filter: secret) → [2 Drive: recording] → [3 Drive: log] → [4 Sheets: add row] → [5 Webhook response]
```

Each call uses about 5 Make operations, so the free plan's 1,000 operations a month covers about
200 calls.

(The same job can also run as a Google Apps Script with no Make account: see `CALL-LOG-SHEET.md`.
Use one or the other, not both.)

## Before you start

- **The sheet:** a Google Sheet with a tab named `Calls` and the headers pasted in row 1.
- **A Drive folder** named `Max Call Logs`.
- **A secret:** the `CALL_LOG_SECRET` value in `tavus-avatar/.env.local` (already generated). It
  stops anyone else who finds the webhook address from writing to your sheet. Keep it private, and
  use the same value in the Make filter (step 2).

## 1. Webhook (the trigger)

1. In Make: **Create a new scenario**. Click the big **+** and pick **Webhooks → Custom webhook**.
2. Click **Add**, name it `Max call log`, click **Save**. Copy the address it shows (it starts with
   `https://hook.` and ends in a long code). Leave this window open: it is now **listening**.
3. Teach it the data shape by sending the sample call. Open PowerShell in the repo folder and run
   (paste your webhook address in place of `<WEBHOOK>`):

   ```powershell
   Invoke-RestMethod -Uri "<WEBHOOK>" -Method Post -ContentType "application/json" -InFile "scripts\make\sample-call.json"
   ```

   Make shows **Successfully determined**. Click **OK**.

## 2. The secret filter

1. Click **+** to the right of the webhook and pick **Google Drive → Upload a File** (set up in
   step 3). Then click the **dotted line** between the two modules → **Set up a filter**.
2. Label: `Secret is correct`. Condition: map **secret** (from module 1), operator
   **Text operators → Equal to**, value: your secret. Click **OK**.

Before going live, put the same secret in place of `PASTE-YOUR-SECRET-HERE` in
`scripts/make/sample-call.json` so test runs pass the filter.

## 3. Google Drive: save the recording

Module: **Google Drive → Upload a File**.

| Field | Value |
|---|---|
| Connection | Add → sign in with your Google account |
| Folder | `Max Call Logs` (pick it from the list) |
| File (Source file) | **Map** |
| File name | `{{1.callId}}.webm` |
| Data | `{{toBinary(1.recordingBase64; "base64")}}` |

Some calls may have no recording. So the scenario does not stop there, right-click this module →
**Add error handler → Ignore**.

## 4. Google Drive: save the full log

Click **+** after module 2 and add another **Google Drive → Upload a File**:

| Field | Value |
|---|---|
| Folder | `Max Call Logs` |
| File name | `{{1.callId}}.json` |
| Data | `{{1.logJson}}` |

Also add **Add error handler → Ignore** on this module.

## 5. Google Sheets: add the row

Module: **Google Sheets → Add a Row**.

| Setting | Value |
|---|---|
| Connection | the same Google connection |
| Search Method | Select from the list |
| Spreadsheet | your call log sheet |
| Sheet Name | `Calls` |
| Table contains headers | Yes |

The columns then appear by header name. Map the 25 automatic columns below and **leave the rest
empty** (they are for testers and reviewers):

| Column | Value |
|---|---|
| Call ID | `{{1.callId}}` |
| Date & Time | `{{formatDate(1.startTime; "YYYY-MM-DD HH:mm:ss")}}` |
| Duration (sec) | `{{1.durationSec}}` |
| Environment | `{{1.environment}}` |
| How It Ended | `{{1.endedHow}}` |
| Furthest Beat | `{{1.furthestBeat}}` |
| Final Price ($/day) | `{{1.finalPrice}}` |
| Customer Turns | `{{1.customerTurns}}` |
| Avg Reply Time (ms) | `{{1.avgReplyMs}}` |
| Slowest Reply (ms) | `{{1.slowestReplyMs}}` |
| Interruptions | `{{1.interruptions}}` |
| Echo Drops | `{{1.echoDrops}}` |
| "I Don't Know" Replies | `{{1.unknownReplies}}` |
| Transcript | `{{1.transcriptText}}` |
| Recording Link | **Web View Link** from module 2 (Drive: recording) |
| Full Log Link | **Web View Link** from module 3 (Drive: log) |
| Inspector Link | `{{1.inspectorUrl}}` |
| AI Score (1-10) | `{{1.aiScore}}` |
| AI Verdict | `{{1.aiVerdict}}` |
| AI Call Summary | `{{1.callSummary}}` |
| AI Customer Sentiment | `{{1.customerSentiment}}` |
| AI Problems Found | `{{1.problemsFound}}` |
| AI What Went Well | `{{1.wentWell}}` |
| AI Suggested Fixes | `{{1.suggestedFixes}}` |
| Compliance Check | `{{1.complianceCheck}}` |

The eight analysis columns come from `src/lib/post-call-analysis.ts`: the Inspector's turn-taking
analyzer (verdict and timestamped problems), compliance checks in code (disclosure, $3 floor, no
handoff promise), and one AI review of the transcript using the app's xAI / OpenAI key (summary,
sentiment, score, problems, what went well, fixes; roughly a tenth of a cent per call). If the AI
review fails, its columns are blank and the rest of the row is still filled.

`Date & Time` uses the scenario's time zone. To set it, open the scenario's **⋯ → Settings**.

## 6. Webhook response

Click **+** after the Sheets module and pick **Webhooks → Webhook response**. Status `200`, and
this body (map the link from module 2, the recording upload):

```
{"ok": true, "recordingUrl": "{{2.webViewLink}}"}
```

Click into the body box and pick **Web View Link** from module 2 in place of `{{2.webViewLink}}` if
your recording module has a different number. This tells the Max app the call was saved, and gives
the Inspector a link to the recording (on Vercel, where the server keeps no audio file). With a plain
`{"ok": true}` everything else still works; only that link is missing.

## 7. Test and switch on

1. Click **Run once**, then send the sample call again (the PowerShell command from step 1, with
   your secret now in the file).
2. Check: a `SAMPLE-0001` row in the sheet, and `SAMPLE-0001.webm` and `SAMPLE-0001.json` in the
   Drive folder. Delete all three.
3. **Save**, and turn the scenario **ON** (the switch at the bottom left). Set **Scheduling** to
   **Immediately as data arrives**.
4. Add the two values to `tavus-avatar/.env.local` (and to Render's Environment settings later):

   ```
   CALL_LOG_WEBHOOK_URL=https://hook.....make.com/....
   CALL_LOG_SECRET=your-secret
   ```

## Limits to know

- **Free plan:** 1,000 operations a month (about 200 calls) and a maximum file size per upload.
  The app records at 24 kbps and attaches recordings up to 3 MB (about 17 minutes); a longer call is
  sent without its recording, and the row is still added.
- **One row per call:** the app sends each call once, when it ends. If it ever sends the same call
  twice, you get two rows; delete the extra one.
- **Keep the scenario ON** during testing. If it is off or errors, check the scenario's **History**
  tab in Make for calls that were not saved.
