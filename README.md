# a11y — плагін Claude Code (локальний)

Флоу доступності для вебзастосунків, незалежно від фреймворку:

| Команда | Що робить | Стан |
| --- | --- | --- |
| `/a11y:audit` | Аудит WCAG через Chrome DevTools MCP: звіт `.md` зі скріншотами і кольори всіх елементів | готово (v0.1) |
| `/a11y:lab` | Лабораторія контрасту з даних аудиту і теми проєкту: варіанти рішень картками, вибір копіюється для агента | готово (v0.1) |
| `/a11y:record` | Фіксує прийняте в лабораторії рішення в документі рішень і в `lab.json`; контраст рахує скриптом | готово (v0.1) |

Не опублікований: ставиться з цієї теки як локальний маркетплейс.

## Встановлення

Потрібен Chrome DevTools MCP, з `--isolated`: без нього всі сесії ділять один профіль Chrome, і поки його тримає одна сесія, в інших MCP не стартує («The browser is already running»):

```bash
claude mcp add chrome-devtools -s user -- npx -y chrome-devtools-mcp@latest --isolated
```

Плагін — разово, з кореня цієї теки:

```bash
claude plugin marketplace add ./
```

```bash
claude plugin install a11y@a11y-local
```

Або без установки, для однієї сесії:

```bash
claude --plugin-dir ./plugins/a11y
```

Після змін у файлах плагіна — `/reload-plugins` у сесії.

## Структура

```
.claude-plugin/marketplace.json   локальний маркетплейс
plugins/a11y/
  .claude-plugin/plugin.json
  skills/audit/SKILL.md           /a11y:audit
  skills/lab/SKILL.md             /a11y:lab
  skills/record/SKILL.md          /a11y:record
  templates/report.md             шаблон звіту
  templates/lab.html              рушій лабораторії (дані вбудовуються збіркою)
  templates/decisions.md          шаблон документа рішень
  references/wcag-audit.md        критерії, пороги, чим перевіряємо
  references/lab-schema.md        формат lab.json
  references/palette-heuristics.md звідки брати варіанти палітри
  scripts/page-audit.js           структура сторінки (evaluate_script)
  scripts/elements.js             кольори, фон, шрифт кожного елемента (evaluate_script)
  scripts/check-report.mjs        самоперевірка звіту: посилання, скріншоти, якорі
  scripts/build-lab.mjs           перевірка lab.json і збірка lab.html
  scripts/contrast-table.mjs      таблиці токенів і контрасту для документа рішень
  scripts/lab-math.mjs            спільна математика контрасту для build-lab і contrast-table
  examples/lab.json               короткий приклад: 7 токенів, 5 рядків, одне рішення
```

## Перевірка

```bash
claude plugin validate ./
```

```bash
node plugins/a11y/scripts/check-report.mjs <тека-звіту>/README.md
```

```bash
node plugins/a11y/scripts/build-lab.mjs plugins/a11y/examples/lab.json
```
