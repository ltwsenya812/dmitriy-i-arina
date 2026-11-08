/**
 * Приём ответов из анкеты гостя → Google Таблица.
 *
 * Лист «Ответы»: одна строка на гостя. Если человек отправит анкету
 * повторно с тем же именем, его строка обновится, а не задвоится.
 * Лист «Итого»: сколько придут, сколько не смогут, напитки.
 *
 * Установка — см. README.md, раздел «Подсчёт гостей».
 */

var ANSWERS = 'Ответы';
var SUMMARY = 'Итого';
var HEADER = ['Когда ответил', 'Имя и фамилия', 'Придёт', 'Напитки'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var p = (e && e.parameter) || {};
    var name = String(p.name || '').trim().slice(0, 120);
    if (!name) return json({ ok: false, error: 'no name' });
    var attend = p.attend === 'no' ? 'Нет' : 'Да';
    var drinks = String(p.drinks || '').slice(0, 200);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = answersSheet(ss);
    var row = [new Date(), name, attend, drinks];

    var last = sh.getLastRow();
    var existing = -1;
    if (last > 1) {
      var names = sh.getRange(2, 2, last - 1, 1).getValues();
      var key = name.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
      for (var i = 0; i < names.length; i++) {
        var n = String(names[i][0]).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
        if (n === key) { existing = i + 2; break; }
      }
    }
    if (existing > 0) sh.getRange(existing, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);

    summarySheet(ss);
    return json({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

/** Открытие адреса в браузере: просто показывает, что всё работает. */
function doGet() {
  return json({ ok: true, message: 'Анкета подключена' });
}

/** Запустите один раз вручную, чтобы создать листы и выдать разрешения. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  answersSheet(ss);
  summarySheet(ss);
}

function answersSheet(ss) {
  var sh = ss.getSheetByName(ANSWERS);
  if (!sh) {
    sh = ss.insertSheet(ANSWERS, 0);
    sh.appendRow(HEADER);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADER.length).setFontWeight('bold');
    sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 240); sh.setColumnWidth(4, 260);
  }
  return sh;
}

function summarySheet(ss) {
  var sh = ss.getSheetByName(SUMMARY);
  if (sh) return sh;
  sh = ss.insertSheet(SUMMARY);
  var a = "'" + ANSWERS + "'!";
  sh.getRange('A1:B9').setValues([
    ['Придут', '=COUNTIF(' + a + 'C2:C,"Да")'],
    ['Не смогут', '=COUNTIF(' + a + 'C2:C,"Нет")'],
    ['Всего ответов', '=COUNTA(' + a + 'B2:B)'],
    ['', ''],
    ['Напитки (среди тех, кто придёт)', ''],
    ['Вино', '=COUNTIFS(' + a + 'C2:C,"Да",' + a + 'D2:D,"*Вино*")'],
    ['Шампанское', '=COUNTIFS(' + a + 'C2:C,"Да",' + a + 'D2:D,"*Шампанское*")'],
    ['Крепкие напитки', '=COUNTIFS(' + a + 'C2:C,"Да",' + a + 'D2:D,"*Крепкие*")'],
    ['Без алкоголя', '=COUNTIFS(' + a + 'C2:C,"Да",' + a + 'D2:D,"*Без алкоголя*")']
  ]);
  sh.getRange('A1:A3').setFontWeight('bold');
  sh.getRange('A5').setFontWeight('bold');
  sh.setColumnWidth(1, 260);
  return sh;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
