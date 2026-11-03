const crypto = require("node:crypto");

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
    const type = question?.type === "long" ? "long" : question?.type === "short" ? "short" : "";
    if (!text || text.length > 160 || !type) return { error: "Each question needs text (up to 160 characters) and a valid response type." };
    questions.push({
      id: crypto.randomUUID(),
      text,
      type,
      required: question.required !== false
    });
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
  for (const question of form.questions) {
    const rawAnswer = sourceAnswers[question.id];
    const answer = typeof rawAnswer === "string" ? rawAnswer.trim() : "";
    const maxLength = question.type === "long" ? 900 : 250;
    if (question.required && !answer) return { error: `Answer “${question.text}” is required.` };
    if (answer.length > maxLength) return { error: `Answer “${question.text}” must be ${maxLength} characters or fewer.` };
    answers[question.id] = answer;
  }

  return { answers };
}

module.exports = { normalizeApplicationAnswers, normalizeApplicationForm };
