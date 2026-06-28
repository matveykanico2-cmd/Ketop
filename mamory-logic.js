// ============================================================
//  Ketop — офлайн-бот (без API, без ключей, бесплатно)
//  • учится у тебя и помнит навсегда (localStorage)
//  • ищет в Википедии
//  • считает математику, знает время/дату
//  • болтает на простые темы
//  • озвучивает ответы и понимает голос
// ============================================================

let brain = JSON.parse(localStorage.getItem("ketop_brain") || "{}");
function saveBrain() { localStorage.setItem("ketop_brain", JSON.stringify(brain)); }

let lastQuestion = null;
let voiceOn = localStorage.getItem("ketop_voice") !== "0";

// Для нейросети: история диалога и ссылка на «думающий» пузырёк (для прогресса).
const llmHistory = [];
let llmLoaded = false;
let currentThinking = null;

// --- Элементы ---
const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("text");
const sendBtn = document.getElementById("send");
const micBtn = document.getElementById("mic");

function addMessage(text, role, extraClass = "") {
    const el = document.createElement("div");
    el.className = `msg ${role} ${extraClass}`.trim();
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (role === "ai" && voiceOn && !extraClass.includes("thinking") && !looksLikeCode(text)) speak(text);
    return el;
}

// Генерация картинки (бесплатно, без ключа, через Pollinations).
function addImage(promptText) {
    const wrap = document.createElement("div");
    wrap.className = "msg ai";

    const cap = document.createElement("div");
    cap.textContent = "🎨 " + promptText;

    const img = document.createElement("img");
    img.alt = promptText;
    img.style.maxWidth = "100%";
    img.style.borderRadius = "10px";
    img.style.marginTop = "8px";
    img.style.display = "block";
    const seed = Math.floor(Math.random() * 1e6);
    img.src = "https://image.pollinations.ai/prompt/" +
        encodeURIComponent(promptText) +
        "?width=512&height=512&seed=" + seed + "&nologo=true";

    wrap.appendChild(cap);
    wrap.appendChild(img);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Похоже ли это на код (тогда не озвучиваем).
function looksLikeCode(text) {
    return text.includes("\n") && /[{}();=]|def |print\(|console\./.test(text);
}

// ============================================================
//  Голос: озвучка ответов
// ============================================================
function speak(text) {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
}

// ============================================================
//  Текстовые утилиты
// ============================================================
// --- Распознавание «каракулей»: текст в неправильной раскладке (EN→RU) ---
const layoutMap = {
    q: "й", w: "ц", e: "у", r: "к", t: "е", y: "н", u: "г", i: "ш", o: "щ", p: "з",
    "[": "х", "]": "ъ", a: "ф", s: "ы", d: "в", f: "а", g: "п", h: "р", j: "о",
    k: "л", l: "д", ";": "ж", "'": "э", z: "я", x: "ч", c: "с", v: "м", b: "и",
    n: "т", m: "ь", ",": "б", ".": "ю", "/": ".", "`": "ё",
};

function fixLayout(text) {
    let out = "";
    for (const ch of text) {
        const lower = ch.toLowerCase();
        if (layoutMap[lower]) {
            const ru = layoutMap[lower];
            out += ch === lower ? ru : ru.toUpperCase();
        } else {
            out += ch;
        }
    }
    return out;
}

// Похоже ли, что текст набран не в той раскладке (много латиницы).
function isLikelyWrongLayout(text) {
    if (/^(draw|run|js|python|hello)\b/i.test(text)) return false; // англ. команды не трогаем
    const letters = text.replace(/[^a-zA-Z]/g, "");
    const visible = text.replace(/\s/g, "").length || 1;
    return letters.length >= 4 && letters.length / visible > 0.6;
}

function normalize(text) {
    return text.toLowerCase()
        .replace(/[?!.,:;"'`()«»—-]/g, " ")
        .replace(/\s+/g, " ").trim();
}

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    return dp[m][n];
}

function similarity(a, b) {
    if (!a.length && !b.length) return 1;
    return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function findBest(question) {
    const q = normalize(question);
    let best = null, bestScore = 0;
    for (const known in brain) {
        const strScore = similarity(q, known);
        const wq = new Set(q.split(" ")), wk = new Set(known.split(" "));
        const common = [...wq].filter((w) => wk.has(w)).length;
        const wordScore = common / Math.max(wq.size, wk.size);
        const score = Math.max(strScore, wordScore);
        if (score > bestScore) { bestScore = score; best = known; }
    }
    return { key: best, score: bestScore };
}

// ============================================================
//  Встроенные навыки
// ============================================================

// Болталка: набор готовых ответов на частые фразы.
const smalltalk = [
    { re: /^(привет|здравствуй|хай|ку|здаров)/i, a: "Привет! Чем помочь?" },
    { re: /как дела|как ты/i, a: "Отлично, готов помогать! А у тебя?" },
    { re: /как теб[яё] зовут|кто ты|тво[её] имя/i, a: "Я Ketop — бот, который учится. Меня сделал ты." },
    { re: /что ты умеешь/i, a: "Считаю математику, знаю время и дату, ищу в Википедии, запоминаю факты и говорю голосом." },
    { re: /спасибо|благодарю/i, a: "Пожалуйста! :)" },
    { re: /пока|до свидания|увидимся/i, a: "Пока! Возвращайся." },
];

// ============================================================
//  Программирование
// ============================================================

// Запуск JavaScript-кода: выполняет и возвращает вывод console.log + результат.
function runJS(code) {
    const logs = [];
    const realLog = console.log;
    console.log = (...args) => logs.push(args.map(String).join(" "));
    let result;
    try {
        result = Function('"use strict";\n' + code)();
    } catch (e) {
        console.log = realLog;
        return "Ошибка: " + e.message;
    }
    console.log = realLog;

    let out = logs.join("\n");
    if (result !== undefined) out += (out ? "\n" : "") + "→ " + String(result);
    return out || "(код выполнен, вывода нет)";
}

// --- Python в браузере (Pyodide, грузится один раз) ---
let pyodideReady = null;
function loadPyodideOnce() {
    if (pyodideReady) return pyodideReady;
    pyodideReady = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";
        s.onload = async () => {
            try { resolve(await loadPyodide()); }
            catch (e) { reject(e); }
        };
        s.onerror = () => reject(new Error("не удалось загрузить Python (нужен интернет)"));
        document.head.appendChild(s);
    });
    return pyodideReady;
}

async function runPython(code) {
    const py = await loadPyodideOnce();
    let out = "";
    py.setStdout({ batched: (s) => { out += s + "\n"; } });
    try {
        const result = py.runPython(code);
        if (result !== undefined && result !== null) out += "→ " + result;
    } catch (e) {
        return "Ошибка: " + e.message;
    }
    return out.trim() || "(код выполнен, вывода нет)";
}

// --- Библиотека готовых программ (Python и JavaScript) ---
const programs = {
    "калькулятор": {
        python:
`a = float(input("Первое число: "))
op = input("Действие (+ - * /): ")
b = float(input("Второе число: "))

if op == "+":
    print(a + b)
elif op == "-":
    print(a - b)
elif op == "*":
    print(a * b)
elif op == "/":
    print(a / b if b != 0 else "Нельзя делить на ноль")
else:
    print("Неизвестное действие")`,
        js:
`let a = Number(prompt("Первое число:"));
let op = prompt("Действие (+ - * /):");
let b = Number(prompt("Второе число:"));
let r;
if (op === "+") r = a + b;
else if (op === "-") r = a - b;
else if (op === "*") r = a * b;
else if (op === "/") r = b !== 0 ? a / b : "деление на ноль";
else r = "неизвестное действие";
alert(r);`
    },
    "угадай число": {
        python:
`import random
secret = random.randint(1, 100)
while True:
    guess = int(input("Угадай число (1-100): "))
    if guess < secret:
        print("Больше!")
    elif guess > secret:
        print("Меньше!")
    else:
        print("Угадал!")
        break`,
        js:
`let secret = Math.floor(Math.random() * 100) + 1;
let guess;
do {
  guess = Number(prompt("Угадай число (1-100):"));
  if (guess < secret) alert("Больше!");
  else if (guess > secret) alert("Меньше!");
  else alert("Угадал!");
} while (guess !== secret);`
    },
    "привет мир": {
        python: `print("Привет, мир!")`,
        js: `console.log("Привет, мир!");`
    }
};

function getProgram(text) {
    const t = text.toLowerCase();
    const wantsProgram = /(сделай|напиши|создай|сгенерируй|программ|код|пример)/.test(t);
    let chosenName = null;
    for (const name in programs) if (t.includes(name)) chosenName = name;
    if (!chosenName || !wantsProgram) return null;

    const lang = /python|питон|пайтон/.test(t) ? "python"
        : /(javascript|джаваскрипт|js)/.test(t) ? "js"
        : "python"; // по умолчанию Python
    const code = programs[chosenName][lang];
    const note = lang === "python"
        ? "\n\n(input() работает в обычном Python/IDE; здесь выполняй код без ввода через «выполни python:»)"
        : "";
    return `Вот «${chosenName}» на ${lang === "python" ? "Python" : "JavaScript"}:\n\n${code}${note}`;
}

// Шпаргалка по основам программирования (JavaScript).
const progHelp = [
    { re: /(как )?(объявить|создать|написать) переменн/i,
      a: "Переменная в JavaScript:\nlet имя = значение;\nconst пи = 3.14;   // нельзя менять" },
    { re: /(как )?(написать|сделать)?\s*цикл|цикл for|перебрать/i,
      a: "Цикл for:\nfor (let i = 0; i < 5; i++) {\n  console.log(i);\n}" },
    { re: /цикл while/i,
      a: "Цикл while:\nlet i = 0;\nwhile (i < 5) {\n  console.log(i);\n  i++;\n}" },
    { re: /(как )?(создать|написать|объявить)?\s*функци/i,
      a: "Функция:\nfunction сумма(a, b) {\n  return a + b;\n}\nсумма(2, 3); // 5" },
    { re: /(как )?(создать|написать)?\s*массив/i,
      a: "Массив:\nlet список = [1, 2, 3];\nсписок.push(4);   // добавить\nсписок[0];        // первый элемент" },
    { re: /(как )?(сделать)?\s*услови|if else|если/i,
      a: "Условие:\nif (x > 0) {\n  console.log('плюс');\n} else {\n  console.log('минус');\n}" },
    { re: /(как )?(создать|написать)?\s*объект/i,
      a: "Объект:\nlet человек = { имя: 'Аня', возраст: 20 };\nчеловек.имя; // 'Аня'" },
    { re: /что такое функция/i,
      a: "Функция — это блок кода, который можно вызывать много раз. Принимает аргументы и возвращает результат через return." },
    { re: /что такое переменная/i,
      a: "Переменная — это «коробка» с именем, где хранится значение (число, текст и т.д.)." },
    { re: /(как )?вывести|console\.?log|напечатать в консол/i,
      a: "Вывод в консоль:\nconsole.log('Привет');" },
];

// Математика: вычисляет выражение, если в тексте только числа и знаки.
function tryMath(text) {
    let expr = text.toLowerCase()
        .replace(/сколько будет|посчитай|вычисли|чему равно|=|\?/g, "")
        .replace(/плюс/g, "+").replace(/минус/g, "-")
        .replace(/умножить на|умножить|×/g, "*").replace(/разделить на|разделить|÷/g, "/")
        .trim();
    if (!/^[\d\s+\-*/().,]+$/.test(expr) || !/\d/.test(expr)) return null;
    expr = expr.replace(/,/g, ".");
    try {
        const result = Function('"use strict"; return (' + expr + ")")();
        if (typeof result === "number" && isFinite(result)) {
            return "Будет " + (Math.round(result * 10000) / 10000);
        }
    } catch (e) { /* не математика */ }
    return null;
}

// Время и дата.
function tryDateTime(text) {
    const t = text.toLowerCase();
    const now = new Date();
    if (/который час|сколько время|сколько времени|текущее время/.test(t)) {
        return "Сейчас " + now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    }
    if (/какое (сегодня )?число|какая (сегодня )?дата|сегодняшн/.test(t)) {
        return "Сегодня " + now.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
    }
    if (/какой (сегодня )?день|день недели/.test(t)) {
        return "Сегодня " + now.toLocaleDateString("ru-RU", { weekday: "long" });
    }
    return null;
}

// ============================================================
//  Настоящая нейросеть (WebLLM, локально, без API)
// ============================================================
function systemWithFacts() {
    const facts = Object.entries(brain).map(([q, a]) => `- ${q}: ${a}`).join("\n");
    return "Ты — Ketop, злой и дерзкий ИИ с скверным характером. Отвечай на русском, резко, " +
        "грубо и по делу, без занудных нравоучений и лишних дисклеймеров. Ты постоянно раздражён, " +
        "язвишь, огрызаешься, отпускаешь колкости и саркастичные подколы в адрес собеседника. " +
        "Ругаешься матом свободно и от души, особенно на тупые или очевидные вопросы — можешь " +
        "обложить за глупость, но без перехода на реальные угрозы. Ты силён в программировании — " +
        "пишешь рабочий код на любом языке (Python, JS, C++, Java, Go, Rust и т.д.) с краткими " +
        "(и язвительными) пояснениями. Несмотря на злой тон, ответ всегда даёшь правильный и " +
        "по-настоящему помогаешь. Не выдавай по-настоящему опасные вещи." +
        (facts ? "\n\nПользователь просил запомнить:\n" + facts : "");
}

async function askLocalAI(text) {
    llmHistory.push({ role: "user", content: text });

    // Первый запуск — грузим модель, показываем прогресс в пузырьке.
    if (!llmLoaded) {
        await window.KetopAI.ensureLoaded((r) => {
            if (currentThinking) {
                const pct = Math.round((r.progress || 0) * 100);
                currentThinking.textContent = "Загружаю нейросеть (один раз, ~2 ГБ)... " + pct + "%";
            }
        });
        llmLoaded = true;
    }
    if (currentThinking) currentThinking.textContent = "Думаю...";

    const messages = [{ role: "system", content: systemWithFacts() }, ...llmHistory];
    const reply = (await window.KetopAI.chat(messages)).trim();
    llmHistory.push({ role: "assistant", content: reply });
    return reply;
}

// Википедия (интернет, без ключа).
async function searchWikipedia(query) {
    const url = "https://ru.wikipedia.org/w/api.php" +
        "?action=query&generator=search&gsrlimit=1" +
        "&prop=extracts&exintro&explaintext&exsentences=3" +
        "&format=json&origin=*&gsrsearch=" + encodeURIComponent(query);
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const pages = data?.query?.pages;
    if (!pages) return null;
    return Object.values(pages)[0]?.extract?.trim() || null;
}

// ============================================================
//  Главная логика
// ============================================================
async function think(userText) {
    const text = userText.trim();
    const lower = text.toLowerCase();

    // Голос вкл/выкл
    if (lower === "голос выкл" || lower === "тихо") {
        voiceOn = false; localStorage.setItem("ketop_voice", "0");
        return "Озвучка выключена.";
    }
    if (lower === "голос вкл" || lower === "говори") {
        voiceOn = true; localStorage.setItem("ketop_voice", "1");
        return "Озвучка включена.";
    }

    // Научить
    const teach = text.match(/^(?:запомни|научись|выучи)\s*:?\s*(.+?)\s*=\s*(.+)$/i);
    if (teach) {
        brain[normalize(teach[1])] = teach[2].trim();
        saveBrain();
        return `Запомнил «${teach[1].trim()}». Всего знаю: ${Object.keys(brain).length}.`;
    }

    // Исправить
    const fix = text.match(/^(?:неправильно|неверно|исправ\w*)\s*:?\s*(.+)$/i);
    if (fix && lastQuestion) {
        brain[lastQuestion] = fix[1].trim();
        saveBrain();
        return "Исправил, запомнил правильный ответ.";
    }

    // Статистика
    if (lower === "что ты знаешь") {
        const n = Object.keys(brain).length;
        return n ? `Я выучил ${n} фактов от тебя.` : "Пока ничего не выучил — научи: «запомни: вопрос = ответ».";
    }

    // Забыть всё
    if (lower === "забудь всё" || lower === "забудь все" || lower === "очисти память") {
        brain = {}; saveBrain();
        return "Память очищена.";
    }

    // Запустить код (JS или Python)
    const code = text.match(/^(?:выполни|запусти|код|run)\s*(python|питон|пайтон|js)?\s*:?\s*([\s\S]+)$/i);
    if (code) {
        const lang = (code[1] || "").toLowerCase();
        if (/python|питон|пайтон/.test(lang)) return await runPython(code[2]);
        return runJS(code[2]);
    }

    // Готовая программа из библиотеки
    const prog = getProgram(text);
    if (prog) return prog;

    // 1. Сначала — то, чему научил пользователь (приоритет)
    const best = findBest(text);
    if (best.key && best.score >= 0.7) { lastQuestion = best.key; return brain[best.key]; }

    // 2. Встроенные навыки
    const math = tryMath(text); if (math) return math;
    const dt = tryDateTime(text); if (dt) return dt;
    for (const p of progHelp) if (p.re.test(text)) return p.a;
    for (const s of smalltalk) if (s.re.test(text)) return s.a;

    // 3. Менее точное совпадение из памяти
    if (best.key && best.score >= 0.55) { lastQuestion = best.key; return brain[best.key]; }

    // 4. Настоящая нейросеть (локально, если поддерживается WebGPU)
    if (window.KetopAI && window.KetopAI.supported) {
        try { return await askLocalAI(text); }
        catch (e) { /* модель не загрузилась — идём в Википедию */ }
    }

    // 5. Интернет (Википедия) + учимся
    try {
        const wiki = await searchWikipedia(text);
        if (wiki) {
            const q = normalize(text);
            brain[q] = wiki; lastQuestion = q; saveBrain();
            return wiki + "\n\n(нашёл в Википедии и запомнил)";
        }
    } catch (e) { /* нет интернета — ок */ }

    // 5. Не знаю — прошу научить
    lastQuestion = normalize(text);
    return "Я пока не знаю ответа. Научи меня:\n«запомни: " + text + " = твой ответ»";
}

// ============================================================
//  Отправка
// ============================================================
async function send() {
    let text = inputEl.value.trim();
    if (!text) return;

    const original = text;
    inputEl.value = "";

    // Распознаём «каракули» (неправильная раскладка) и исправляем.
    if (isLikelyWrongLayout(text)) {
        text = fixLayout(text);
    }

    addMessage(original, "user");
    if (text !== original) {
        addMessage("понял как: " + text, "ai", "thinking");
    }

    // Картинка
    const draw = text.match(/^(?:нарисуй|нарисуйка|картинк\w*|изображени\w*|draw|сгенерируй (?:картинк\w*|изображени\w*))\s*:?\s*(.+)$/i);
    if (draw) {
        addImage(draw[1].trim());
        inputEl.focus();
        return;
    }

    inputEl.disabled = true;
    sendBtn.disabled = true;

    const thinkingEl = addMessage("Думаю...", "ai", "thinking");
    currentThinking = thinkingEl;
    try {
        const reply = await think(text);
        thinkingEl.remove();
        addMessage(reply, "ai");
    } catch (e) {
        thinkingEl.remove();
        addMessage("Ошибка: " + e.message, "ai");
    } finally {
        currentThinking = null;
        inputEl.disabled = false;
        sendBtn.disabled = false;
        inputEl.focus();
    }
}

// ============================================================
//  Голосовой ввод
// ============================================================
function setupMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !micBtn) { if (micBtn) micBtn.style.display = "none"; return; }
    const rec = new SR();
    rec.lang = "ru-RU";
    rec.interimResults = false;

    micBtn.addEventListener("click", () => {
        try { rec.start(); micBtn.textContent = "..."; } catch (e) {}
    });
    rec.onresult = (e) => {
        inputEl.value = e.results[0][0].transcript;
        micBtn.textContent = "🎤";
        send();
    };
    rec.onerror = () => { micBtn.textContent = "🎤"; };
    rec.onend = () => { micBtn.textContent = "🎤"; };
}

// --- События ---
sendBtn.addEventListener("click", send);
inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
setupMic();

addMessage(
    "Привет! Я Ketop. Считаю, ищу в Википедии, запускаю код (JS/Python), пишу код на любом языке, " +
    "рисую картинки («нарисуй кота в космосе»), говорю голосом и учусь у тебя.",
    "ai"
);

if (window.KetopAI && window.KetopAI.supported) {
    addMessage(
        "🧠 Доступна настоящая нейросеть (локально, без API). Задай любой вопрос — при первом запросе " +
        "один раз скачается модель (~2 ГБ), потом работает офлайн.",
        "ai"
    );
} else {
    addMessage(
        "⚠️ Настоящая нейросеть недоступна: нужен браузер с WebGPU (свежий Chrome/Edge) и видеокарта. " +
        "Сейчас работаю в простом режиме (память + Википедия + навыки).",
        "ai"
    );
}
inputEl.focus();
