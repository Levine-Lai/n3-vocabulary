"use strict";

const root = document.querySelector("#main");
const storageKey = "n3-vocabulary-v1";
const freshState = () => ({ attempts: {}, imported: {} });
let state = freshState();
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved?.attempts && saved?.imported) state = saved;
} catch { notice("本机记录无法读取。"); }

const beijingDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" });
let today = beijingDate.format(new Date());
let published = {};
let date;
let position = 0;
let screen = "daily";
let quiz = null;
let requestNumber = 0;

function notice(message) {
  const output = document.querySelector("#notice");
  output.textContent = message;
  output.hidden = !message;
}
function save() {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); }
  catch { notice("浏览器无法保存记录，请先导出备份。"); }
}
function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}
function usable(set) {
  return /^\d{4}-\d{2}-\d{2}$/.test(set?.date) &&
    Array.isArray(set.questions) && set.questions.length > 0 && set.questions.every(item =>
      typeof item.id === "string" && typeof item.sentence === "string" &&
      typeof item.word === "string" && /^[ABCD]$/.test(item.correct_option) &&
      ["A", "B", "C", "D"].every(letter => typeof item.options?.[letter] === "string"));
}
function dates() {
  return [...new Set([today, ...Object.keys(published), ...Object.keys(state.imported)])]
    .filter(day => day.slice(0, 10) <= today)
    .sort().reverse();
}
function attempt() {
  return state.attempts[date] ??= { answers: {}, submitted: false };
}
const letters = ["A", "B", "C", "D"];
function plainJapanese(value) {
  return value.replace(/（[ぁ-ゖァ-ヺー]+）|[／【】]/gu, "");
}
function ruby(value) {
  return escape(value.replace(/[／【】]/g, ""))
    .replace(/([\p{Script=Han}々]+)（([ぁ-ゖァ-ヺー]+)）/gu,
      (_, word, reading) => `<ruby>${word}<rt>${reading}</rt></ruby>`);
}
function example(item, notes) {
  const source = (item.sentence_with_readings ||
    item.sentence.replace(/【[^】]+】/, item.word)).replace(/[／【】]/g, "");
  const units = source.match(/[^（](?:（[ぁ-ゖァ-ヺー]+）)?/gu) ?? [];
  const plain = plainJapanese(source);
  const ranges = notes.map(({ text }, index) => ({ index, start: plain.indexOf(text), length: text.length }))
    .filter(range => range.start >= 0)
    .sort((a, b) => a.start - b.start);
  let offset = 0;
  let output = "";
  for (const range of ranges) {
    if (range.start < offset) continue;
    output += ruby(units.slice(offset, range.start).join(""));
    offset = range.start + range.length;
    output += `<span class="phrase tone-${range.index % 3}">${ruby(units.slice(range.start, offset).join(""))}</span>`;
  }
  return output + ruby(units.slice(offset).join(""));
}
function result(item, letter, showAnswerLabels = false) {
  const correct = item.correct_option;
  const lesson = (item.id.startsWith("2026-11-11-") ? lessons[Number(item.id.split("-").at(-1))] : null) ?? {};
  const notes = item.sentence_parts ?? lesson.parts ?? [
    { text: item.word, note: item.meaning }
  ];
  const choices = letters.map(key => {
    const label = item.options[key];
    const definition = key === correct ? `${item.reading} · ${item.meaning}` :
      item.option_explanations?.[key] || (Object.hasOwn(optionGlossary, label) ? optionGlossary[label] : "") || (letter === key ? item.error_analysis : "") ||
      (item.type === "日语选读音" ? `这个读音与「${item.word}」不对应。` : "这个写法与题目给出的读音或语境不匹配。");
    return `<li><b><span lang="ja">${key}　${escape(label)}</span>${showAnswerLabels && key === letter ? ' <small>我的选择</small>' : ""}${showAnswerLabels && key === correct ? ' <small>正确答案</small>' : ""}</b><span>${escape(definition)}</span></li>`;
  }).join("");
  return `<div class="result">
    <section class="result-box"><h3>原句</h3><p class="jp" lang="ja">${example(item, notes)}</p></section>
    <section class="result-box"><h3>句子拆解</h3><ul class="phrase-list">
      ${notes.map(({ text, note }, index) => `<li><b lang="ja" class="phrase tone-${index % 3}">${escape(text)}</b><span>${escape(note)}</span></li>`).join("")}
    </ul>${!item.sentence_parts && !lesson.parts && item.sentence_analysis ? `<p>${escape(item.sentence_analysis)}</p>` : ""}</section>
    <section class="result-box"><h3>四个选项</h3><ul class="choice-notes">${choices}</ul></section>
    ${item.sentence_translation || lesson.translation ? `<section class="result-box"><h3>中文翻译</h3><p>${escape(item.sentence_translation || lesson.translation)}</p></section>` : ""}
  </div>`;
}
function render() {
  document.querySelector("#daily").setAttribute("aria-pressed", String(screen === "daily"));
  document.querySelector("#review").setAttribute("aria-pressed", String(screen === "review"));
  if (screen === "review") return renderReview();
  const choices = dates().map(day => `<option value="${escape(day)}"${date === day ? " selected" : ""}>${escape(day)}</option>`).join("");
  const heading = `<div class="head"><div><h1>每日练习</h1><p class="meta">${escape(date ?? today)} · 北京时间${date && date !== today ? " · 历史练习" : ""}</p></div>
    ${choices ? `<select aria-label="练习日期" id="date">${choices}</select>` : ""}</div>`;
  if (!quiz) {
    root.innerHTML = heading + '<div class="panel empty"><p>今天的题目尚未发布。</p><button id="reload">刷新题库</button></div>';
    root.querySelector("#reload").onclick = init;
    bindDate();
    return;
  }
  const current = attempt();
  const item = quiz.questions[position];
  const letter = current.answers[item.id];
  const answered = quiz.questions.filter(question => current.answers[question.id]).length;
  const score = quiz.questions.filter(question => current.answers[question.id] === question.correct_option).length;
  const sentence = escape(item.sentence).replace(/【([^】]+)】/g, "<mark>$1</mark>");
  const buttons = ["A", "B", "C", "D"].map(key => {
    const label = item.options[key];
    let style = letter === key ? "chosen" : "";
    if (current.submitted && key === item.correct_option) style = "right";
    if (current.submitted && key === letter && key !== item.correct_option) style = "wrong";
    return `<button class="${style}" data-answer="${key}" aria-pressed="${letter === key}" ${current.submitted ? "disabled" : ""}><span class="letter">${key}</span><span lang="ja">${escape(label)}</span></button>`;
  }).join("");
  const numbers = quiz.questions.map((question, index) => {
    const answer = current.answers[question.id];
    const style = current.submitted ? (answer === question.correct_option ? "right" : "wrong") : (answer ? "done" : "");
    return `<button data-index="${index}" aria-label="第 ${index + 1} 题${answer ? "，已作答" : ""}" class="${style} ${index === position ? "current" : ""}" ${index === position ? 'aria-current="step"' : ""}>${index + 1}</button>`;
  }).join("");
  root.innerHTML = heading + `<div class="layout"><article class="panel" aria-labelledby="question-heading">
    <h2 id="question-heading">${position + 1} / ${quiz.questions.length}　${escape(item.type)}</h2>
    ${current.submitted ? "" : `<p class="sentence" lang="ja">${sentence}</p>`}<div class="options">${buttons}</div>
    ${current.submitted ? result(item, letter) : ""}
    <div class="actions"><button id="previous" ${position === 0 ? "disabled" : ""}>上一题</button><button id="next" ${position === quiz.questions.length - 1 ? "disabled" : ""}>下一题</button></div>
    </article><aside class="panel side">
    <h2>${current.submitted ? `得分 ${score} / ${quiz.questions.length}` : "答题进度"}</h2>
    <p class="meta">${current.submitted ? "选择题号查看解析" : `已答 ${answered} / ${quiz.questions.length}`}</p>
    <progress aria-label="已答题数" value="${answered}" max="${quiz.questions.length}"></progress><div class="numbers">${numbers}</div>
    ${current.submitted ? '<button id="mistakes" class="primary">查看错题本</button>' : `<button id="submit" class="primary" ${answered !== quiz.questions.length ? "disabled" : ""}>提交答案</button>`}
    </aside></div>`;
  bindDate();
  root.querySelectorAll("[data-answer]").forEach(button => button.onclick = () => {
    current.answers[item.id] = button.dataset.answer;
    save();
    render();
    root.querySelector(`[data-answer="${button.dataset.answer}"]`)?.focus({ preventScroll: true });
  });
  root.querySelectorAll("[data-index]").forEach(button => button.onclick = () => go(Number(button.dataset.index)));
  root.querySelector("#previous").onclick = () => go(position - 1);
  root.querySelector("#next").onclick = () => go(position + 1);
  const submit = root.querySelector("#submit");
  if (submit) submit.onclick = () => {
    current.submitted = true;
    current.mistakes = quiz.questions.filter(question => current.answers[question.id] !== question.correct_option);
    save();
    go(0);
  };
  const mistakes = root.querySelector("#mistakes");
  if (mistakes) mistakes.onclick = () => changeScreen("review");
}
function bindDate() {
  const select = root.querySelector("#date");
  if (select) select.onchange = () => showDate(select.value);
}
function go(index) {
  position = index;
  render();
  root.querySelector(".layout")?.scrollIntoView({ block: "nearest" });
}
function renderReview() {
  const seen = new Set();
  const entries = Object.entries(state.attempts).sort(([a], [b]) => b.localeCompare(a))
    .flatMap(([day, record]) => record.submitted && Array.isArray(record.mistakes) ?
      record.mistakes.map(item => ({ day, item, letter: record.answers[item.id] })) : [])
    .filter(({ item, letter }) => {
      if (!letter || letter === item.correct_option) return false;
      const key = JSON.stringify([item.id, letter]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  root.innerHTML = `<div class="head"><div><h1>错题本</h1><p class="meta">${entries.length} 道错题</p></div></div>` +
    (entries.length ? `<div class="list">${entries.map(({ day, item, letter }) => `<details class="panel"><summary><span lang="ja">${escape(item.word)}</span>　<small>${escape(day.slice(0, 10))}</small></summary>${result(item, letter, true)}</details>`).join("")}</div>` : '<div class="panel empty">提交练习后，错题会出现在这里。</div>');
}
async function showDate(day) {
  const sequence = ++requestNumber;
  date = day;
  position = 0;
  quiz = null;
  const imported = state.imported[day];
  if (usable(imported)) {
    quiz = imported;
  } else if (published[day]) {
    root.innerHTML = '<p role="status">正在加载题目…</p>';
    try {
      const response = await fetch(published[day], { cache: "no-cache" });
      if (!response.ok) throw Error();
      const data = await response.json();
      if (!usable(data)) throw Error();
      if (sequence !== requestNumber) return;
      quiz = data;
    } catch {
      if (sequence !== requestNumber) return;
      notice("题目加载失败，请刷新题库。");
    }
  }
  render();
}
function changeScreen(next) {
  screen = next;
  if (screen === "daily" && date !== today) {
    void showDate(today);
    return;
  }
  render();
}
function checkDate() {
  const nextDay = beijingDate.format(new Date());
  if (nextDay === today) return;
  const wasToday = date === today;
  today = nextDay;
  if (screen !== "daily") return;
  if (wasToday) void showDate(today);
  else render();
}
window.setInterval(checkDate, 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkDate();
});
async function loadQuizData(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw Error();
  return response.json();
}
async function loadHistory() {
  const history = await loadQuizData("./quizzes/history.json");
  let changed = false;
  for (const [day, { answers, ...set }] of Object.entries(history)) {
    if (!usable(set) || !set.questions.every(item => /^[ABCD]$/.test(answers?.[item.id]))) continue;
    if (!Object.hasOwn(state.imported, day)) {
      state.imported[day] = set;
      changed = true;
    }
    if (!Object.hasOwn(state.attempts, day)) {
      const mistakes = set.questions.filter(item => answers[item.id] !== item.correct_option);
      state.attempts[day] = { answers, mistakes, submitted: true };
      changed = true;
    }
  }
  if (changed) save();
}
async function init() {
  notice("");
  const [index, history] = await Promise.allSettled([
    loadQuizData("./quizzes/index.json"),
    loadHistory()
  ]);
  if (index.status === "fulfilled") published = index.value;
  else notice("题库加载失败，请检查网络后重试。");
  if (index.status === "fulfilled" && history.status === "rejected") {
    notice("历史记录加载失败，请刷新页面重试。");
  }
  await showDate(today);
}

document.querySelector("#daily").onclick = () => changeScreen("daily");
document.querySelector("#review").onclick = () => changeScreen("review");
document.querySelector("#export").onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, ...state }, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "N3-练习记录.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const files = document.querySelector("#files");
document.querySelector("#import").onclick = () => files.click();
files.onchange = async () => {
  let count = 0;
  for (const file of files.files) {
    try {
      const data = JSON.parse(await file.text());
      if (data.version === 1 && data.attempts && data.imported) {
        for (const [key, record] of Object.entries(data.attempts)) {
          if (!/^\d{4}-\d{2}-\d{2}(?: .+)?$/.test(key) || !record?.answers) continue;
          if (Object.hasOwn(state.attempts, key) && state.attempts[key].submitted && !key.includes(" 历史错题 ")) continue;
          const answers = Object.fromEntries(Object.entries(record.answers).filter(([, value]) => /^[ABCD]$/.test(value)));
          const mistakes = Array.isArray(record.mistakes) ?
            record.mistakes.filter(item => usable({ date: key.slice(0, 10), questions: [item] }) &&
              answers[item.id] && answers[item.id] !== item.correct_option) : [];
          state.attempts[key] = { answers, mistakes, submitted: record.submitted === true };
        }
        for (const [key, set] of Object.entries(data.imported)) {
          if (/^\d{4}-\d{2}-\d{2}(?: .+)?$/.test(key) && usable(set)) state.imported[key] = set;
        }
      } else if (usable(data) && data.status === "graded") {
        const key = data.date + (data.session ? " " + String(data.session) : "");
        const answers = Object.fromEntries(data.questions.filter(item => /^[ABCD]$/.test(item.user_answer)).map(item => [item.id, item.user_answer]));
        const mistakes = data.questions.filter(item => answers[item.id] && answers[item.id] !== item.correct_option);
        if (!Object.hasOwn(state.attempts, key) || !state.attempts[key].submitted) {
          state.attempts[key] = { answers, mistakes, submitted: true };
          state.imported[key] = data;
        }
      } else continue;
      count++;
    } catch { /* A malformed file does not interrupt the remaining imports. */ }
  }
  files.value = "";
  save();
  notice(count ? `已读取 ${count} 个记录文件。` : "未找到可导入的作答记录。");
  if (screen === "daily" && date) await showDate(date);
  else render();
};
init();

