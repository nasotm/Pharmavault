import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { FunctionDeclaration, GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  ALLOWED_READ_ONLY_TOOLS,
  detectWriteOrCatalogEditIntent,
  PHARMACY_ASSISTANT_SYSTEM_PROMPT,
  planReadOnlyToolCalls,
  synthesizeGroundedResponseFromTools,
  type AssistantToolCallRequest,
  type ExecutedToolCallRecord,
} from './src/assistant/assistant';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const READ_ONLY_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'search_medication',
    description:
      'Search medications by barcode, brand_name prefix, or fuzzy match across brand_name, generic_name, and aliases. Returns id, name, and location.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Medication brand name, generic name, alias, or barcode to search for.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_stock',
    description:
      'Get total stock quantity (SUM(batch.quantity)) and per-batch expiry list for a specific medication_id.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        medication_id: {
          type: Type.INTEGER,
          description: 'Numeric medication ID returned by search_medication.',
        },
      },
      required: ['medication_id'],
    },
  },
  {
    name: 'list_low_stock',
    description:
      'List all medications where current stock SUM(batch.quantity) <= reorder_level, sorted by (quantity / reorder_level) ascending, with reorder suggestions.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        include_all: {
          type: Type.BOOLEAN,
          description: 'Optional flag to list all low-stock rows.',
        },
      },
    },
  },
  {
    name: 'list_expiring',
    description:
      'List active batches expiring within the specified number of days, sorted by expiry date ascending.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        days: {
          type: Type.INTEGER,
          description: 'Number of days ahead to check for expiring batches (e.g. 30, 60, 90).',
        },
      },
      required: ['days'],
    },
  },
  {
    name: 'calc_price',
    description:
      'Calculate line totals, subtotal, discount, tax, and grand total for items using exact integer-cent arithmetic. Refuses to compute a grand total if any item has NULL price ("price not entered").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          description: 'Items and quantities to price.',
          items: {
            type: Type.OBJECT,
            properties: {
              medication_id: {
                type: Type.INTEGER,
                description: 'Medication ID if known.',
              },
              query: {
                type: Type.STRING,
                description: 'Medication name query if medication_id is not yet resolved.',
              },
              quantity: {
                type: Type.INTEGER,
                description: 'Number of packs/units.',
              },
            },
            required: ['quantity'],
          },
        },
        discount_pct: {
          type: Type.NUMBER,
          description: 'Optional discount percentage between 0 and 100.',
        },
        tax_pct: {
          type: Type.NUMBER,
          description: 'Optional tax percentage between 0 and 100.',
        },
      },
      required: ['items'],
    },
  },
];

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Model call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Preserve COOP/COEP headers for OPFS SQLite Wasm cross-origin isolation
  app.use((_req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/ai/health', (_req, res) => {
    const hasGeminiKey = Boolean(
      process.env.GEMINI_API_KEY &&
        process.env.GEMINI_API_KEY.trim() !== '' &&
        process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
    );
    res.json({
      ok: true,
      readOnlyMode: true,
      model: 'gemini-3.8-flash',
      geminiConfigured: hasGeminiKey,
      allowedTools: Array.from(ALLOWED_READ_ONLY_TOOLS),
    });
  });

  app.post('/api/ai/chat', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        mode?: 'plan' | 'synthesize';
        userMessage?: string;
        contextMedicationId?: number | null;
        contextMedicationName?: string | null;
        toolCalls?: ExecutedToolCallRecord[];
      };

      const mode = body.mode ?? 'plan';
      const userMessage = String(body.userMessage ?? '').trim();

      if (!userMessage) {
        res.status(400).json({ error: 'userMessage is required' });
        return;
      }

      // Check for write or catalog-field modification attempts immediately
      const writeCheck = detectWriteOrCatalogEditIntent(userMessage);
      if (writeCheck.isDeclinedIntent && writeCheck.reason) {
        res.json({
          declined: true,
          declineMessage: writeCheck.reason,
          toolCalls: [],
          responseText: writeCheck.reason,
        });
        return;
      }

      const ai = getGeminiClient();

      if (mode === 'plan') {
        const deterministicCalls = planReadOnlyToolCalls(userMessage, {
          contextMedicationId: body.contextMedicationId,
          contextMedicationName: body.contextMedicationName,
        });

        let plannedCalls: AssistantToolCallRequest[] = deterministicCalls;

        // If deterministic planner didn't find a specific multi-tool chain and Gemini is configured,
        // consult Gemini 3.8 Flash with ThinkingLevel.LOW and a 2.5s budget
        if (ai && deterministicCalls.length === 0) {
          try {
            const contextHint = body.contextMedicationId
              ? `\nCurrently selected medication on screen: ID=${body.contextMedicationId} (${body.contextMedicationName ?? 'selected item'}). If the user refers to "this", use medication_id=${body.contextMedicationId}.`
              : '';

            const response = await withTimeout(
              ai.models.generateContent({
                model: 'gemini-3.8-flash',
                contents: `${userMessage}${contextHint}`,
                config: {
                  systemInstruction: PHARMACY_ASSISTANT_SYSTEM_PROMPT,
                  tools: [{ functionDeclarations: READ_ONLY_FUNCTION_DECLARATIONS }],
                  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                  temperature: 0,
                },
              }),
              2500,
            );

            if (response.functionCalls && response.functionCalls.length > 0) {
              plannedCalls = response.functionCalls
                .filter((fc) => fc.name && ALLOWED_READ_ONLY_TOOLS.has(fc.name))
                .map((fc) => ({
                  name: String(fc.name),
                  args: (fc.args as Record<string, unknown>) ?? {},
                }));
            }
          } catch {
            plannedCalls = deterministicCalls;
          }
        }

        res.json({
          declined: false,
          toolCalls: plannedCalls,
        });
        return;
      }

      // mode === 'synthesize'
      const executedCalls = Array.isArray(body.toolCalls) ? body.toolCalls : [];
      const deterministicResponse = synthesizeGroundedResponseFromTools(
        userMessage,
        executedCalls,
      );

      // Verify whether any tool returned a NULL price so we never risk a model hallucinating a number
      const serializedTools = JSON.stringify(executedCalls);
      const containsNullPrice =
        serializedTools.includes('"unit_price_cents":null') ||
        serializedTools.includes('"hasNullPrice":true') ||
        serializedTools.includes('price not entered');

      if (ai && !containsNullPrice && executedCalls.length > 0) {
        try {
          const response = await withTimeout(
            ai.models.generateContent({
              model: 'gemini-3.8-flash',
              contents: `Pharmacist question: "${userMessage}"\n\nExecuted read-only tool results (authoritative SQLite data):\n${JSON.stringify(
                executedCalls.map((c) => ({
                  name: c.name,
                  args: c.args,
                  result: c.result,
                })),
                null,
                2,
              )}\n\nProvide a concise, strictly grounded answer using ONLY the numbers, locations, expiry dates, and prices from these tool results.`,
              config: {
                systemInstruction: PHARMACY_ASSISTANT_SYSTEM_PROMPT,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                temperature: 0,
              },
            }),
            2500,
          );

          const text = response.text?.trim();
          if (text) {
            res.json({
              responseText: text,
            });
            return;
          }
        } catch {
          // Fall back to deterministic synthesis below
        }
      }

      res.json({
        responseText: deterministicResponse,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Internal server error',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
