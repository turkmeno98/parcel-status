// Run setup once, then deploy as a web app executing as your account.
function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (!id || !props.getProperty('WEBHOOK_SECRET')) throw new Error('Set SPREADSHEET_ID and WEBHOOK_SECRET in Script Properties');
  var book = SpreadsheetApp.openById(id);
  var sheet = book.getSheetByName('Облако') || book.insertSheet('Облако');
  if (!sheet.getLastRow()) {
    sheet.getRange(1, 1, 1, 7).setValues([['Время проверки (МСК)', 'Товар', 'Предыдущий статус', 'Новый статус', 'Событие WB (МСК)', 'Запись', 'Ключ события']]);
    sheet.getRange(1, 1, 1, 7).setBackground('#eeeeee').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, 7, 180);
    sheet.setColumnWidth(4, 300);
  }
  book.setSpreadsheetTimeZone('Europe/Moscow');
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 100000) return answer(false);
    var body = JSON.parse(raw);
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty('WEBHOOK_SECRET') || body.secret !== props.getProperty('WEBHOOK_SECRET')) return answer(false);
    if (!Array.isArray(body.events) || body.events.length > 100 || typeof body.product !== 'string' || body.product.length > 200) return answer(false);
    var sheet = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID')).getSheetByName('Облако');
    if (!sheet) return answer(false);
    var count = sheet.getLastRow();
    if (count > 1000) return answer(false);
    var keys = count > 1 ? sheet.getRange(2, 7, count - 1, 1).getValues().map(function(row) { return String(row[0]); }) : [];
    var previous = count > 1 ? String(sheet.getRange(count, 4).getValue()) : '';
    var rows = [];
    body.events.forEach(function(event) {
      if (!event || !/^\d{1,8}:\d{16,22}$/.test(event.key) || typeof event.name !== 'string' || !event.name.trim() || event.name.length > 300 || !Number.isFinite(Date.parse(event.at))) throw new Error('Invalid event');
      if (keys.indexOf(event.key) >= 0) return;
      rows.push([new Date(), safeText(body.product), safeText(previous), safeText(event.name), new Date(event.at), 'Из облачного трекера', event.key]);
      previous = event.name;
      keys.push(event.key);
    });
    if (rows.length) {
      var range = sheet.getRange(count + 1, 1, rows.length, 7);
      range.setValues(rows).setWrap(true);
      sheet.getRange(count + 1, 1, rows.length, 1).setNumberFormat('dd.MM.yyyy HH:mm');
      sheet.getRange(count + 1, 5, rows.length, 1).setNumberFormat('dd.MM.yyyy HH:mm');
    }
    return answer(true);
  } catch (_) { return answer(false); }
  finally { lock.releaseLock(); }
}
function safeText(value) { return /^[=+@-]/.test(value) ? "'" + value : value; }
function answer(ok) { return ContentService.createTextOutput(JSON.stringify({ok:ok})).setMimeType(ContentService.MimeType.JSON); }
