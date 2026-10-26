import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps/app-with-deps";

// Shape of the structuredContent that save_quiz / get_quiz return.
interface Question {
  question: string;
  choices: string[];
  correct_index: number;
  explanation?: string | null;
}
interface QuizData {
  quizId: string;
  title: string;
  topic: string;
  difficulty?: string | null;
  questions: Question[];
}

/** `order[displayIndex]` is the index into `question.choices` shown at that position. */
interface Item {
  q: Question;
  order: number[];
}

const LETTERS = "ABCDEF";
const root = document.getElementById("app") as HTMLElement;

let quiz: QuizData;
let items: Item[] = [];
let picked: (number | null)[] = []; // original choice index the user chose, per question
let current = 0;
let onKey: ((e: KeyboardEvent) => void) | null = null;

// ---------- small DOM helpers (all text goes through textContent, never innerHTML) ----------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function showMessage(text: string): void {
  onKey = null;
  root.replaceChildren(el("p", "empty", text));
}

function header(progressPct: number, label: string): HTMLElement {
  const wrap = el("div");
  const meta = el("div", "meta");
  meta.append(el("span", "", `${quiz.topic} · ${quiz.title}`), el("span", "grow"));
  if (quiz.difficulty) meta.append(el("span", "chip", quiz.difficulty));
  meta.append(el("span", "", label));

  const bar = el("div", "bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-valuenow", String(Math.round(progressPct)));
  bar.setAttribute("aria-label", label);
  const fill = el("span");
  fill.style.width = `${progressPct}%`;
  bar.append(fill);

  wrap.append(meta, bar);
  return wrap;
}

// ---------- quiz flow ----------

function start(data: QuizData, shuffleChoices: boolean): void {
  quiz = data;
  items = data.questions.map((q) => {
    const order = q.choices.map((_, i) => i);
    return { q, order: shuffleChoices ? shuffled(order) : order };
  });
  picked = items.map(() => null);
  current = 0;
  renderQuestion();
}

function renderQuestion(): void {
  const { q, order } = items[current];
  const total = items.length;

  const choiceButtons: HTMLButtonElement[] = [];
  const group = el("div", "choices");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Answer choices");

  const feedback = el("div", "feedback");
  feedback.setAttribute("role", "status");
  feedback.hidden = true;

  const isLast = current === total - 1;
  const nextBtn = el("button", "btn", isLast ? "See results" : "Next question");
  nextBtn.type = "button";
  nextBtn.disabled = true;
  nextBtn.addEventListener("click", () => {
    if (isLast) renderResults();
    else {
      current += 1;
      renderQuestion();
    }
  });

  function choose(displayIdx: number): void {
    if (picked[current] !== null) return; // locked after the first answer
    const chosen = order[displayIdx];
    picked[current] = chosen;
    const correct = chosen === q.correct_index;

    choiceButtons.forEach((btn, d) => {
      btn.setAttribute("aria-disabled", "true");
      btn.setAttribute("aria-checked", String(d === displayIdx));
      if (order[d] === q.correct_index) btn.classList.add("correct");
      else if (d === displayIdx) btn.classList.add("wrong");
    });

    const correctLetter = LETTERS[order.indexOf(q.correct_index)];
    feedback.className = `feedback ${correct ? "good" : "bad"}`;
    feedback.replaceChildren(
      el("div", "verdict", correct ? "Correct!" : `Not quite. The answer is ${correctLetter}.`),
    );
    if (q.explanation) feedback.append(el("p", "", q.explanation));
    feedback.hidden = false;

    nextBtn.disabled = false;
    nextBtn.focus();
  }

  order.forEach((origIdx, d) => {
    const btn = el("button", "choice");
    btn.type = "button";
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", "false");
    btn.append(el("span", "letter", LETTERS[d]), el("span", "text", q.choices[origIdx]));
    btn.addEventListener("click", () => choose(d));
    choiceButtons.push(btn);
    group.append(btn);
  });

  onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    let d = LETTERS.toLowerCase().indexOf(key);
    if (d === -1 && /^[1-6]$/.test(key)) d = Number(key) - 1;
    if (d >= 0 && d < order.length) {
      e.preventDefault();
      choose(d);
    }
  };

  const actions = el("div", "actions");
  actions.append(nextBtn);

  root.replaceChildren(
    header((current / total) * 100, `Question ${current + 1} of ${total}`),
    el("h2", "question", q.question),
    group,
    feedback,
    actions,
    el("p", "hint", `Click an answer or press 1–${order.length} / A–${LETTERS[order.length - 1]}.`),
  );
}

function renderResults(): void {
  onKey = null;
  const total = items.length;
  const results = items.map((it, i) => ({
    it,
    chosen: picked[i],
    correct: picked[i] === it.q.correct_index,
  }));
  const score = results.filter((r) => r.correct).length;
  const pct = Math.round((score / total) * 100);
  const missed = results.filter((r) => !r.correct);

  const message =
    pct === 100 ? "Perfect score!"
    : pct >= 80 ? "Great work!"
    : pct >= 60 ? "Solid effort."
    : pct >= 40 ? "Getting there."
    : "Keep practicing. Review the missed questions below.";

  const scoreBox = el("div", "score");
  scoreBox.setAttribute("role", "status");
  scoreBox.append(
    el("div", "big", `${score} / ${total}`),
    el("div", "pct", `${pct}% correct`),
    el("div", "msg", message),
  );

  const review = el("div", "review");
  results.forEach(({ it, chosen, correct }, i) => {
    const details = el("details");
    details.open = !correct; // missed questions start expanded
    const summary = el("summary");
    summary.append(el("span", `mark ${correct ? "good" : "bad"}`, correct ? "✓" : "✗"), el("span", "", `${i + 1}. ${it.q.question}`));

    const body = el("div", "detail");
    const yours = chosen === null ? "(no answer)" : it.q.choices[chosen];
    const ya = el("div");
    ya.append(el("strong", "", "Your answer: "), document.createTextNode(yours));
    body.append(ya);
    if (!correct) {
      const ca = el("div");
      ca.append(el("strong", "", "Correct answer: "), document.createTextNode(it.q.choices[it.q.correct_index]));
      body.append(ca);
    }
    if (it.q.explanation) body.append(el("div", "", it.q.explanation));
    details.append(summary, body);
    review.append(details);
  });

  const status = el("span", "status");
  status.setAttribute("role", "status");

  const retake = el("button", "btn", "Retake quiz");
  retake.type = "button";
  retake.addEventListener("click", () => start(quiz, true));

  const actions = el("div", "actions");
  actions.append(retake);

  if (missed.length > 0) {
    const ask = el("button", "btn secondary", "Ask Claude to explain my misses");
    ask.type = "button";
    ask.addEventListener("click", async () => {
      ask.disabled = true;
      status.textContent = "";
      try {
        const res = await app.sendMessage({
          role: "user",
          content: [{ type: "text", text: missedMessage(score, total, missed) }],
        });
        status.textContent = res.isError ? "Claude couldn't take that message." : "Sent to Claude.";
        if (res.isError) ask.disabled = false;
      } catch {
        status.textContent = "Couldn't reach Claude from here. Just ask in chat.";
        ask.disabled = false;
      }
    });
    actions.append(ask);
  }
  actions.append(status);

  root.replaceChildren(header(100, "Finished"), scoreBox, actions, review);
  reportToModel(score, total, missed);
}

type Result = { it: Item; chosen: number | null; correct: boolean };

function describeMiss(r: Result): string {
  const yours = r.chosen === null ? "no answer" : r.it.q.choices[r.chosen];
  return `"${r.it.q.question}" (I chose "${yours}"; correct: "${r.it.q.choices[r.it.q.correct_index]}")`;
}

function missedMessage(score: number, total: number, missed: Result[]): string {
  return (
    `I finished the "${quiz.title}" quiz on ${quiz.topic} and scored ${score}/${total}. ` +
    `Please explain the ones I missed:\n` +
    missed.map((r, i) => `${i + 1}. ${describeMiss(r)}`).join("\n")
  );
}

/** Let the model know the outcome without triggering a reply; it's used if the user asks about it next. */
function reportToModel(score: number, total: number, missed: Result[]): void {
  const text =
    `The user finished the "${quiz.title}" quiz (id ${quiz.quizId}) on ${quiz.topic}: ${score}/${total} correct.` +
    (missed.length ? ` Missed: ${missed.map(describeMiss).join("; ")}.` : " No misses.");
  app.updateModelContext({ content: [{ type: "text", text }] }).catch(() => {
    /* host may not support context updates; the on-screen result is unaffected */
  });
}

// ---------- host wiring ----------

type HostCtx = ReturnType<App["getHostContext"]>;

function applyHost(ctx: HostCtx): void {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

function isQuizData(x: unknown): x is QuizData {
  const d = x as QuizData | undefined;
  return (
    !!d &&
    Array.isArray(d.questions) &&
    d.questions.length > 0 &&
    d.questions.every(
      (q) =>
        typeof q.question === "string" &&
        Array.isArray(q.choices) &&
        q.choices.length >= 2 &&
        Number.isInteger(q.correct_index) &&
        q.correct_index >= 0 &&
        q.correct_index < q.choices.length,
    )
  );
}

const app = new App({ name: "education-quiz", version: "0.1.0" });

app.ontoolresult = (result) => {
  if (isQuizData(result.structuredContent)) {
    start(result.structuredContent, false);
    return;
  }
  const text = result.content?.find((c) => c.type === "text");
  showMessage(text && "text" in text ? text.text : "No quiz data was returned.");
};
app.onhostcontextchanged = (ctx) => applyHost({ ...app.getHostContext(), ...ctx });

document.addEventListener("keydown", (e) => onKey?.(e));

app
  .connect()
  .then(() => applyHost(app.getHostContext()))
  .catch((err) => showMessage(`Couldn't connect to the host: ${err instanceof Error ? err.message : err}`));
