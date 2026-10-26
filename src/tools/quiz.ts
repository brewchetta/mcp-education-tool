import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { db, resolveTopic, unwrap, unwrapMaybe } from "../db";
import { QUIZ_UI_URI } from "../ui";
import { excerpt, fail, ok, safely } from "./util";

const questionSchema = z
  .object({
    question: z.string().min(1),
    choices: z.array(z.string().min(1)).min(2).max(6),
    correct_index: z.number().int().min(0).describe("0-based index into choices"),
    explanation: z.string().optional().describe("Why the answer is correct, grounded in the article"),
  })
  .refine((q) => q.correct_index < q.choices.length, {
    message: "correct_index must point at one of the choices",
  });

/** What the quiz view renders. Sent as structuredContent, so it reaches the UI but not the model's context. */
interface QuizPayload {
  quizId: string;
  title: string;
  topic: string;
  difficulty: string | null;
  questions: { question: string; choices: string[]; correct_index: number; explanation: string | null }[];
}

const LETTERS = "ABCDEF";

/**
 * Result for a tool that displays the quiz view. The UI gets the full payload (answers included,
 * needed for scoring). The model gets text only: a short brief, plus the questions and an answer key
 * so it can still present the quiz in chat if the client can't render MCP Apps.
 */
function quizResult(quiz: QuizPayload, verb: "saved" | "loaded"): CallToolResult {
  const lines = [
    `Quiz "${quiz.title}" on ${quiz.topic} (${quiz.questions.length} questions, id ${quiz.quizId}) ${verb}.`,
    `It is shown to the user as an interactive quiz: they click answers, get instant feedback, and see a final score. ` +
      `Do NOT repeat the questions or reveal answers in chat; at most say it's ready. ` +
      `When they finish, their score is added to your context.`,
    ``,
    `FALLBACK (use only if the user says they cannot see the quiz): present these questions in chat without answers.`,
    ...quiz.questions.flatMap((q, i) => [
      `${i + 1}. ${q.question}`,
      ...q.choices.map((c, j) => `   ${LETTERS[j]}. ${c}`),
    ]),
    ``,
    `ANSWER KEY (do not reveal until the user has answered): ` +
      quiz.questions.map((q, i) => `${i + 1}${LETTERS[q.correct_index]}`).join(" "),
  ];
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: quiz as unknown as Record<string, unknown>,
  };
}

export function registerQuizTools(server: McpServer): void {
  server.registerTool(
    "prepare_quiz",
    {
      description:
        "Step 1 of making a quiz: fetch the stored article for a topic plus instructions for writing a " +
        "multiple-choice quiz. After writing the questions, call save_quiz, which shows the quiz to the user.",
      inputSchema: z.object({
        topic: z.string().min(1).describe("Topic in the knowledge base"),
        num_questions: z.number().int().min(1).max(25).default(10),
        difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
      }),
    },
    safely(async ({ topic, num_questions, difficulty }) => {
      const t = await resolveTopic(topic);
      const { text, truncated } = excerpt(t.content);
      return ok(
        [
          `Write a ${num_questions}-question multiple-choice quiz (${difficulty} difficulty) on "${t.title}", ` +
            `using ONLY the source article below.`,
          ``,
          `Rules:`,
          `- 4 choices per question with exactly one correct answer; make distractors plausible, not silly.`,
          `- Spread questions across different sections; avoid trivia about dates/names unless central.`,
          `- Randomize which position holds the correct answer.`,
          `- Give each question a one-sentence explanation grounded in the article.`,
          ``,
          `Then call save_quiz with topic="${t.title}", a title, difficulty="${difficulty}", and the questions. ` +
            `save_quiz stores the quiz AND displays it to the user as an interactive quiz, so do not also ` +
            `print the questions in chat; just tell the user the quiz is ready.`,
          ``,
          `--- SOURCE: ${t.title} (${t.url ?? "no url"})${truncated ? " [truncated]" : ""} ---`,
          text,
        ].join("\n"),
      );
    }),
  );

  registerAppTool(
    server,
    "save_quiz",
    {
      title: "Save and show quiz",
      description:
        "Step 2 of making a quiz: validate and store a quiz you wrote, then display it to the user as an " +
        "interactive quiz (clickable answers, instant feedback, final score).",
      inputSchema: z.object({
        topic: z.string().min(1).describe("Topic in the knowledge base"),
        title: z.string().min(1),
        difficulty: z.enum(["easy", "medium", "hard"]).optional(),
        questions: z.array(questionSchema).min(1).max(50),
      }),
      _meta: { ui: { resourceUri: QUIZ_UI_URI } },
    },
    safely(async ({ topic, title, difficulty, questions }) => {
      const t = await resolveTopic(topic);
      const quiz = unwrap(
        await db()
          .from("quizzes")
          .insert({ topic_id: t.id, title, difficulty: difficulty ?? null })
          .select("id")
          .single(),
        "saving quiz",
      );

      const rows = questions.map((q, i) => ({
        quiz_id: quiz.id,
        position: i + 1,
        question: q.question,
        choices: q.choices,
        correct_index: q.correct_index,
        explanation: q.explanation ?? null,
      }));
      const inserted = await db().from("quiz_questions").insert(rows);
      if (inserted.error) {
        // Don't leave an empty quiz behind.
        await db().from("quizzes").delete().eq("id", quiz.id);
        return fail(`Supabase error while saving questions: ${inserted.error.message}`);
      }
      return quizResult(
        {
          quizId: quiz.id,
          title,
          topic: t.title,
          difficulty: difficulty ?? null,
          questions: questions.map((q) => ({
            question: q.question,
            choices: q.choices,
            correct_index: q.correct_index,
            explanation: q.explanation ?? null,
          })),
        },
        "saved",
      );
    }),
  );

  registerAppTool(
    server,
    "get_quiz",
    {
      title: "Open a saved quiz",
      description:
        "Open a previously saved quiz as an interactive quiz for the user to take (again). " +
        "Use list_quizzes to find ids.",
      inputSchema: z.object({ quiz_id: z.string().uuid() }),
      _meta: { ui: { resourceUri: QUIZ_UI_URI } },
    },
    safely(async ({ quiz_id }) => {
      const quiz = unwrapMaybe(
        await db()
          .from("quizzes")
          .select("id,title,difficulty,topics(title),quiz_questions(position,question,choices,correct_index,explanation)")
          .eq("id", quiz_id)
          .maybeSingle(),
        "loading quiz",
      );
      if (!quiz) return fail(`No quiz with id ${quiz_id}. Use list_quizzes to see saved quizzes.`);
      const rows = [...quiz.quiz_questions].sort((a: any, b: any) => a.position - b.position);
      return quizResult(
        {
          quizId: quiz.id,
          title: quiz.title,
          topic: (quiz.topics as any)?.title ?? "Unknown topic",
          difficulty: quiz.difficulty,
          questions: rows.map((r: any) => ({
            question: r.question,
            choices: r.choices,
            correct_index: r.correct_index,
            explanation: r.explanation,
          })),
        },
        "loaded",
      );
    }),
  );

  server.registerTool(
    "list_quizzes",
    {
      description: "List saved quizzes, optionally only those for one topic. Open one with get_quiz.",
      inputSchema: z.object({ topic: z.string().optional().describe("Limit to this topic") }),
    },
    safely(async ({ topic }) => {
      let query = db()
        .from("quizzes")
        .select("id,title,difficulty,created_at,topics(title),quiz_questions(count)")
        .order("created_at", { ascending: false });
      if (topic) query = query.eq("topic_id", (await resolveTopic(topic)).id);
      const quizzes = unwrap(await query, "listing quizzes");
      return ok(quizzes.length ? quizzes : "No saved quizzes yet. Use prepare_quiz to make one.");
    }),
  );
}
