"use strict";

const fs = require("node:fs");
const path = require("node:path");
const input = process.argv[2];
if (!input) throw Error("请提供每日练习 JSON 文件路径。");
const source = JSON.parse(fs.readFileSync(input, "utf8").replace(/^\uFEFF/, ""));
const fields = ["id", "type", "word", "sentence", "options", "correct_option", "reading", "meaning",
  "sentence_with_readings", "sentence_translation", "sentence_analysis"];
if (!/^\d{4}-\d{2}-\d{2}$/.test(source.date) || source.session || source.questions?.length !== 12) {
  throw Error("仅接受有 12 题的每日练习。");
}
const questions = source.questions.map((question, index) => {
  const target = index < 7 ? "日语选读音" : "读音选日语";
  if (question.type !== target || !/^[ABCD]$/.test(question.correct_option) ||
    !fields.every(field => question[field] && (field === "options" || typeof question[field] === "string")) ||
    !["A", "B", "C", "D"].every(letter => typeof question.options[letter] === "string") ||
    new Set(Object.values(question.options)).size !== 4 ||
    question.options[question.correct_option] !== (index < 7 ? question.reading : question.word)) {
    throw Error(`第 ${index + 1} 题的题型、选项或解析有缺漏。`);
  }
  const clean = Object.fromEntries(fields.map(field => [field, question[field]]));
  clean.options = Object.fromEntries(["A", "B", "C", "D"].map(letter => [letter, question.options[letter]]));
  if (question.option_explanations) {
    clean.option_explanations = Object.fromEntries(["A", "B", "C", "D"]
      .filter(letter => letter !== clean.correct_option && typeof question.option_explanations[letter] === "string")
      .map(letter => [letter, question.option_explanations[letter]]));
  }
  if (question.sentence_parts) {
    const plain = question.sentence_with_readings.replace(/（[ぁ-ゖァ-ヺー]+）|[／【】]/gu, "");
    if (!Array.isArray(question.sentence_parts) || question.sentence_parts.length < 2 ||
      !question.sentence_parts.every(part => typeof part?.text === "string" && part.text &&
        plain.includes(part.text) && typeof part.note === "string" && part.note)) {
      throw Error(`第 ${index + 1} 题的拆解没有对应原句。`);
    }
    clean.sentence_parts = question.sentence_parts.map(({ text, note }) => ({ text, note }));
  }
  return clean;
});
if (new Set(questions.map(question => question.id)).size !== 12 ||
  new Set(questions.map(question => question.word)).size !== 12) throw Error("题号或词汇重复。");
const directory = path.resolve(__dirname, "../quizzes");
fs.mkdirSync(directory, { recursive: true });
const file = path.join(directory, source.date + ".json");
const payload = JSON.stringify({ date: source.date, questions }, null, 2) + "\n";
if (fs.existsSync(file) && fs.readFileSync(file, "utf8") !== payload) throw Error("当天题目已发布，需保留已有题目。");
fs.writeFileSync(file, payload);
const index = Object.fromEntries(fs.readdirSync(directory).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
  .sort().map(name => [name.slice(0, 10), "./quizzes/" + name]));
fs.writeFileSync(path.join(directory, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`已准备 ${source.date} 的公开题目和解析。`);

