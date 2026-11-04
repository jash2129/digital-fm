# Call log sheet: setup

Every finished call goes to a Google Sheet: one row per call, with the transcript and links to the
recording and full log saved in your Google Drive. The receiver is a Google Apps Script web app,
[scripts/google-sheets/CallLog.gs](../scripts/google-sheets/CallLog.gs). It is free and needs no
other account.

## One-time setup (about 10 minutes)

1. **Create the sheet.** In Google Sheets, create a new spreadsheet. You do not need to add the
   headers: the script creates a **Calls** tab with them. If you already pasted the headers, rename
   that tab to `Calls`.
2. **Paste the script.** In the sheet: **Extensions → Apps Script**. Delete the sample code, paste the
   whole of `CallLog.gs`, and click **Save** (the disk icon).
3. **Run `setup`.** In the function dropdown at the top, pick `setup` and click **Run**. Google asks
   for permission the first time: choose your account. If you see "Google hasn't verified this
   app", click **Advanced → Go to (project name)**; it is your own script. Then click **Allow**.
   The **Execution log** at the bottom shows a line like `CALL_LOG_SECRET = 3f9a...`. Copy that value.
4. **Test it.** Pick `testPost` and click **Run**. A `TEST-...` row appears in the Calls tab, and a
   **Max Call Logs** folder appears in your Drive with two small test files. Delete the test row
   and the test files.
5. **Deploy.** Click **Deploy → New deployment**. Click the gear next to "Select type" and pick
   **Web app**. Set **Execute as: Me** and **Who has access: Anyone**, then click **Deploy**. Copy
   the **Web app URL** (it ends in `/exec`).

   "Anyone" is needed because the Max server posts without signing in to Google. The secret from
   step 3 is what stops anyone else writing to your sheet: never share it.
6. **Check the URL.** Open the web app URL in your browser. It should show
   `{"ok":true,"service":"Max call log","sheet":"Calls"}`.
7. **Give the app the two values.** Add them to `tavus-avatar/.env.local` (and to the Render
   service's Environment settings when you deploy there):

   ```
   CALL_LOG_WEBHOOK_URL=https://script.google.com/macros/s/.../exec
   CALL_LOG_SECRET=3f9a...
   ```

## Columns

The first 17 columns, from **Call ID** to **Inspector Link**, are filled in by the app after every
call. The script never writes to the remaining columns (Tester Name through Fix Commit), so tester
feedback and your review notes are safe. If the same call is sent twice, its row is updated, not
duplicated.

Recordings and log files are private to your Google account. To let someone else open a link, share
the **Max Call Logs** folder with them in Drive.

## If you change the script later

Edits only go live with a new version: **Deploy → Manage deployments → Edit (pencil) → Version: New
version → Deploy**. The URL stays the same.
