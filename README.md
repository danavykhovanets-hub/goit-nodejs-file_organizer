# File Organizer

CLI-утиліта на Node.js для аналізу, пошуку дублікатів, сортування та очищення файлів.

## Вимоги

Node.js 20 або новіший. Зовнішніх залежностей немає, `npm install` не потрібен.

## Команди

```bash
# Статистика директорії: кількість, розміри, типи, вік файлів
node file-organizer.js scan <directory>

# Пошук файлів з однаковим вмістом (SHA-256)
node file-organizer.js duplicates <directory>

# Копіювання файлів у папки за категоріями (оригінали не змінюються)
node file-organizer.js organize <source> --output <target>

# Список файлів, старіших за N днів (нічого не видаляє)
node file-organizer.js cleanup <directory> --older-than 90

# Те саме, але з фактичним видаленням
node file-organizer.js cleanup <directory> --older-than 90 --confirm
```

Через npm scripts аргументи передаються після `--`:

```bash
npm run scan -- ./Downloads
npm run organize -- ./Downloads --output ./Organized
```

## Структура

```
file-organizer/
├── file-organizer.js   # точка входу: парсинг аргументів і виведення в консоль
└── lib/
    ├── scanner.js      # Scanner extends EventEmitter
    ├── duplicates.js   # DuplicateFinder extends EventEmitter
    ├── organizer.js    # Organizer extends EventEmitter
    ├── cleanup.js      # Cleanup extends EventEmitter
    └── utils.js        # спільні функції: обхід директорії, formatSize, прогрес-бар, повідомлення про помилки
```

Класи в `lib/` нічого не друкують: вони лише випускають події. Усе виведення в консоль живе в `file-organizer.js`.

## Технічні рішення

- **Streams.** SHA-256 рахується через `fs.createReadStream()`, тож файл ніколи не завантажується в пам'ять цілком. У `organize` файли від 10 MB копіюються через `pipeline()`, менші через `fs.copyFile()`.
- **Дублікати.** Спершу файли групуються за розміром, і хешуються лише ті, у яких є «двійник» за розміром. Файли різного розміру не можуть бути дублікатами, тому це прибирає більшість зайвої роботи. Порожні файли пропускаються.
- **Конфлікти імен.** Якщо файл з такою назвою вже існує в цільовій папці, додається суфікс: `file.pdf` → `file(1).pdf` → `file(2).pdf`.
- **Помилки.** Помилка доступу до самої директорії завершує програму з кодом 1. Помилка з окремим файлом виводиться як попередження, і обробка решти файлів продовжується.
- **Cleanup.** Без `--confirm` працює в режимі dry run і нічого не видаляє.
