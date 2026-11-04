/**
 * Max call log: Google Sheet + Drive receiver (Google Apps Script web app).
 *
 * The Max app POSTs one JSON body per finished call. This script:
 *   1. checks the shared secret (the web app is reachable by anyone who has the URL),
 *   2. saves the recording (.webm) and the full log (.json) into a Drive folder,
 *   3. adds the call to the "Calls" tab, or updates its row if the Call ID is already there.
 * Only the automatic columns are ever written. Tester and reviewer columns are never touched.
 *
 * Setup: docs/CALL-LOG-SHEET.md (paste this file, run setup(), run testPost(), deploy as web app).
 *
 * Request body (JSON), every field optional except secret and callId:
 * {
 *   "secret": "...", "callId": "d4711cfb-...", "startTime": "2026-11-03T09:46:34.900Z",
 *   "durationSec": 84, "environment": "render" | "local", "endedHow": "script complete" | "customer hung up" | ...,
 *   "furthestBeat": 12, "finalPrice": 3.5, "customerTurns": 8, "avgReplyMs": 2900, "slowestReplyMs": 6600,
 *   "interruptions": 2, "echoDrops": 3, "unknownReplies": 1,
 *   "transcript": [{ "role": "assistant" | "user", "text": "..." }] or "Max: ...\nCustomer: ...",
 *   "inspectorUrl": "https://.../inspector?session=...",
 *   "recordingBase64": "...", "recordingMimeType": "audio/webm",
 *   "log": { ...the full call log... }
 * }
 * Response: { "ok": true, "row": 5, "recordingUrl": "...", "logUrl": "..." } or { "ok": false, "error": "..." }
 */

const SHEET_NAME = 'Calls';
const DRIVE_FOLDER_NAME = 'Max Call Logs';
// Google Sheets refuses cells over 50,000 characters
const MAX_CELL_CHARS = 49000;

const HEADERS = [
  'Call ID', 'Date & Time', 'Duration (sec)', 'Environment', 'How It Ended', 'Furthest Beat',
  'Final Price ($/day)', 'Customer Turns', 'Avg Reply Time (ms)', 'Slowest Reply (ms)', 'Interruptions',
  'Echo Drops', '"I Don\'t Know" Replies', 'Transcript', 'Recording Link', 'Full Log Link', 'Inspector Link',
  'Tester Name', 'Headphones or Speakers', 'Overall Rating (1-5)', 'Felt Natural (1-5)',
  'Max Understood Me (1-5)', 'Would Trust for Real Purchase (Y/N)', 'What Went Wrong', 'What Went Well',
  'Reviewer Notes', 'Fix Status', 'Fix Commit',
];

// The columns this script fills, and how each value is read from the request
const AUTO_COLUMNS = {
  'Call ID': (b) => b.callId,
  'Date & Time': (b) => (b.startTime ? new Date(b.startTime) : ''),
  'Duration (sec)': (b) => b.durationSec,
  'Environment': (b) => b.environment,
  'How It Ended': (b) => b.endedHow,
  'Furthest Beat': (b) => b.furthestBeat,
  'Final Price ($/day)': (b) => b.finalPrice,
  'Customer Turns': (b) => b.customerTurns,
  'Avg Reply Time (ms)': (b) => b.avgReplyMs,
  'Slowest Reply (ms)': (b) => b.slowestReplyMs,
  'Interruptions': (b) => b.interruptions,
  'Echo Drops': (b) => b.echoDrops,
  '"I Don\'t Know" Replies': (b) => b.unknownReplies,
  'Transcript': (b) => formatTranscript_(b.transcript),
  'Recording Link': (b, files) => files.recordingUrl,
  'Full Log Link': (b, files) => files.logUrl,
  'Inspector Link': (b) => b.inspectorUrl,
};

/** Receives one call from the Max app. */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000); // two calls ending together must not write the same row
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || body.secret !== secret) return json_({ ok: false, error: 'unauthorized' });
    if (!body.callId) return json_({ ok: false, error: 'callId is required' });

    const folder = getFolder_();
    const files = { recordingUrl: '', logUrl: '' };
    if (body.recordingBase64) {
      const mime = body.recordingMimeType || 'audio/webm';
      const ext = mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
      files.recordingUrl = saveFile_(folder, `${body.callId}.${ext}`, Utilities.base64Decode(body.recordingBase64), mime);
    }
    if (body.log) {
      files.logUrl = saveFile_(folder, `${body.callId}.json`, Utilities.newBlob(JSON.stringify(body.log, null, 2)).getBytes(), 'application/json');
    }

    const row = upsertRow_(getSheet_(), body, files);
    return json_({ ok: true, row, recordingUrl: files.recordingUrl, logUrl: files.logUrl });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Opening the web app URL in a browser shows this: a quick check that the deployment works. */
function doGet() {
  return json_({ ok: true, service: 'Max call log', sheet: SHEET_NAME });
}

/**
 * Run once from the editor: creates the secret, the Drive folder and the "Calls" tab with headers.
 * The secret is printed in the Execution log; it goes into the app's CALL_LOG_SECRET.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SECRET');
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('SECRET', secret);
  }
  getFolder_();
  getSheet_();
  Logger.log('Setup done.');
  Logger.log('CALL_LOG_SECRET = ' + secret);
  Logger.log('Drive folder: ' + DRIVE_FOLDER_NAME + ' | Sheet tab: ' + SHEET_NAME);
}

/** Run from the editor after setup(): writes a TEST row and two small files, then you can delete them. */
function testPost() {
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  const body = {
    secret,
    callId: 'TEST-' + Date.now(),
    startTime: new Date().toISOString(),
    durationSec: 42,
    environment: 'test',
    endedHow: 'test row, safe to delete',
    furthestBeat: 3,
    customerTurns: 2,
    avgReplyMs: 2100,
    slowestReplyMs: 3000,
    interruptions: 0,
    echoDrops: 0,
    unknownReplies: 0,
    transcript: [
      { role: 'assistant', text: 'Can you hear and see me alright?' },
      { role: 'user', text: 'Yes I can.' },
    ],
    inspectorUrl: 'http://localhost:3000/inspector',
    recordingBase64: Utilities.base64Encode('not real audio, just a test file'),
    recordingMimeType: 'audio/webm',
    log: { test: true },
  };
  const out = doPost({ postData: { contents: JSON.stringify(body) } });
  Logger.log(out.getContent());
}

// ---------------------------------------------------------------------------

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getFolder_() {
  const found = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  return found.hasNext() ? found.next() : DriveApp.createFolder(DRIVE_FOLDER_NAME);
}

/** Saves a file into the folder, replacing an older file with the same name. Returns its link. */
function saveFile_(folder, name, bytes, mime) {
  const old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  return folder.createFile(Utilities.newBlob(bytes, mime, name)).getUrl();
}

/**
 * Finds the call's row by Call ID (or adds one) and writes only the automatic columns. A value the
 * request does not carry (for example no recording on an update) keeps what the cell already has.
 * Columns are found by header name, so reordering columns in the sheet is safe; a missing automatic
 * header is added at the end.
 */
function upsertRow_(sheet, body, files) {
  let headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(String);
  Object.keys(AUTO_COLUMNS).forEach((name) => {
    if (headers.indexOf(name) === -1) {
      sheet.getRange(1, headers.length + 1).setValue(name).setFontWeight('bold');
      headers.push(name);
    }
  });

  const idCol = headers.indexOf('Call ID') + 1;
  let row = 0;
  if (sheet.getLastRow() > 1) {
    const match = sheet
      .getRange(2, idCol, sheet.getLastRow() - 1, 1)
      .createTextFinder(String(body.callId))
      .matchEntireCell(true)
      .findNext();
    if (match) row = match.getRow();
  }
  if (!row) row = sheet.getLastRow() + 1;

  const range = sheet.getRange(row, 1, 1, headers.length);
  const values = range.getValues()[0];
  Object.keys(AUTO_COLUMNS).forEach((name) => {
    const value = AUTO_COLUMNS[name](body, files);
    if (value !== undefined && value !== null && value !== '') values[headers.indexOf(name)] = value;
  });
  range.setValues([values]);
  return row;
}

/** One line per turn, "Max: ..." / "Customer: ...", trimmed to fit a cell. */
function formatTranscript_(transcript) {
  if (!transcript) return '';
  let text = Array.isArray(transcript)
    ? transcript.map((t) => `${t.role === 'user' ? 'Customer' : 'Max'}: ${t.text || ''}`).join('\n')
    : String(transcript);
  if (text.length > MAX_CELL_CHARS) text = text.slice(0, MAX_CELL_CHARS) + '\n... (cut: full transcript in the log file)';
  return text;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
