const crypto = require("node:crypto");

const APPLICATION_QUESTION_TYPES = new Set(["short", "long", "multiple_choice", "dropdown", "checkboxes", "file", "rating"]);
const APPLICATION_CHOICE_TYPES = new Set(["multiple_choice", "dropdown", "checkboxes"]);
const APPLICATION_FILE_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "text/plain"
]);
const APPLICATION_FILE_EXTENSIONS = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain"
};
const MAX_APPLICATION_FILE_SIZE = 512 * 1024;
const MAX_APPLICATION_FILES = 10;

function hasExpectedFileContent(type, bytes) {
  if (type === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (type === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/jpeg") return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) && bytes.subarray(-2).equals(Buffer.from([255, 217]));
  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
  const text = bytes.toString("utf8");
  return !text.includes("\0") && Buffer.from(text, "utf8").equals(bytes);
}

function normalizeApplicationForm(body) {
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const sourceQuestions = body?.questions;

  if (title.length < 3 || title.length > 100) return { error: "Title must be between 3 and 100 characters." };
  if (description.length > 2_000) return { error: "Description must be 2,000 characters or fewer." };
  if (!Array.isArray(sourceQuestions) || sourceQuestions.length < 1 || sourceQuestions.length > 20) {
    return { error: "Add between 1 and 20 questions." };
  }

  const questions = [];
  for (const question of sourceQuestions) {
    const text = typeof question?.text === "string" ? question.text.trim() : "";
    const type = APPLICATION_QUESTION_TYPES.has(question?.type) ? question.type : "";
    if (!text || text.length > 160 || !type) return { error: "Each question needs text (up to 160 characters) and a valid response type." };

    const normalized = {
      id: crypto.randomUUID(),
      text,
      type,
      required: question.required !== false
    };
    if (APPLICATION_CHOICE_TYPES.has(type)) {
      const sourceOptions = question.options;
      if (!Array.isArray(sourceOptions)) return { error: `Add between 2 and 20 options for “${text}”.` };
      const options = sourceOptions.map((option) => typeof option === "string" ? option.trim() : "");
      if (options.length < 2 || options.length > 20 || options.some((option) => !option || option.length > 80)) {
        return { error: `Add between 2 and 20 options of 80 characters or fewer for “${text}”.` };
      }
      if (new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) {
        return { error: `Options for “${text}” must be unique.` };
      }
      normalized.options = options;
    }
    questions.push(normalized);
  }

  return { title, description, questions };
}

function normalizeApplicationAnswers(form, body) {
  const sourceAnswers = body?.answers;
  if (!sourceAnswers || typeof sourceAnswers !== "object" || Array.isArray(sourceAnswers)) {
    return { error: "Complete the application questions." };
  }

  const questionIds = new Set(form.questions.map((question) => question.id));
  if (Object.keys(sourceAnswers).some((id) => !questionIds.has(id))) {
    return { error: "The application contains an invalid question." };
  }

  const answers = {};
  let totalFileBytes = 0;
  let totalFileCount = 0;
  for (const question of form.questions) {
    const rawAnswer = sourceAnswers[question.id];
    if (question.type === "file") {
      if (!rawAnswer || typeof rawAnswer !== "object" || Array.isArray(rawAnswer)) {
        if (question.required) return { error: `Answer “${question.text}” is required.` };
        answers[question.id] = "";
        continue;
      }
      const name = typeof rawAnswer.name === "string" ? rawAnswer.name.trim() : "";
      const type = typeof rawAnswer.type === "string" ? rawAnswer.type.toLowerCase() : "";
      const data = typeof rawAnswer.data === "string" ? rawAnswer.data : "";
      const bytes = Buffer.from(data, "base64");
      const safeName = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120);
      const extension = safeName.includes(".") ? safeName.split(".").pop().toLowerCase() : "";
      if (!safeName || !APPLICATION_FILE_TYPES.has(type) || APPLICATION_FILE_EXTENSIONS[extension] !== type || !data || bytes.length === 0 || bytes.length > MAX_APPLICATION_FILE_SIZE || bytes.toString("base64") !== data || Number(rawAnswer.size) !== bytes.length || !hasExpectedFileContent(type, bytes)) {
        return { error: `File for “${question.text}” must be a PDF, DOCX, JPG, PNG, or TXT file up to 512 KB.` };
      }
      totalFileCount += 1;
      if (totalFileCount > MAX_APPLICATION_FILES) return { error: "An application can include up to 10 uploaded files." };
      totalFileBytes += bytes.length;
      if (totalFileBytes > MAX_APPLICATION_FILE_SIZE) return { error: "All uploaded files together must be 512 KB or smaller." };
      answers[question.id] = { name: safeName, type, size: bytes.length, data };
      continue;
    }

    if (question.type === "checkboxes") {
      const selected = Array.isArray(rawAnswer) ? rawAnswer : rawAnswer === undefined ? [] : [rawAnswer];
      if (selected.some((option) => typeof option !== "string" || !question.options.includes(option)) || new Set(selected).size !== selected.length) {
        return { error: `Select valid options for “${question.text}”.` };
      }
      if (question.required && selected.length === 0) return { error: `Answer “${question.text}” is required.` };
      answers[question.id] = selected;
      continue;
    }

    const answer = typeof rawAnswer === "string" ? rawAnswer.trim() : "";
    if (question.required && !answer) return { error: `Answer “${question.text}” is required.` };
    const maxLength = question.type === "long" ? 900 : 250;
    if (answer.length > maxLength) return { error: `Answer “${question.text}” must be ${maxLength} characters or fewer.` };
    if (["multiple_choice", "dropdown"].includes(question.type) && answer && !question.options.includes(answer)) {
      return { error: `Select a valid option for “${question.text}”.` };
    }
    if (question.type === "rating" && answer && !/^(?:[1-9]|10)$/.test(answer)) {
      return { error: `Choose a rating from 1 to 10 for “${question.text}”.` };
    }
    answers[question.id] = answer;
  }

  return { answers };
}

module.exports = { normalizeApplicationAnswers, normalizeApplicationForm };
