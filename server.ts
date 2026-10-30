import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { FunctionDeclaration, GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  ALLOWED_READ_ONLY_TOOLS,
  detectWriteOrCatalogEditIntent,
  NO_DATA_BRIEFING_MESSAGE,
  PHARMACY_ASSISTANT_SYSTEM_PROMPT,
  planReadOnlyToolCalls,
  synthesizeGroundedResponseFromTools,
  type AssistantToolCallRequest,
  type ExecutedToolCallRecord,
} from './src/assistant/assistant';
import {
  parseExtractedPrescriptionJson,
  SAMPLE_HANDWRITTEN_PRESCRIPTION_ITEMS,
  SCAN_PRESCRIPTION_PROMPT,
} from './src/prescriptions/scanPrescription';
import {
  DRUG_INTERACTION_SYSTEM_PROMPT,
  evaluateDeterministicDrugInteractions,
  normalizeAiInteractionResponse,
  type DrugInteractionInputItem,
} from './src/pricing/drugInteractions';
import {
  parseExtractedLeafletJson,
  SAMPLE_FALLBACK_LEAFLET_DATA,
  SCAN_LEAFLET_PROMPT,
} from './src/services/scanLeafletService';
import {
  synthesizeStockoutPredictionInsight,
  type StockoutPredictionRow,
} from './src/dashboards';
import {
  GENERIC_DCI_INFERENCE_PROMPT,
  inferDciFromBrandNameDeterministic,
} from './src/search/genericSubstitution';

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
  {
    name: 'get_revenue',
    description:
      'Calculates total sales revenue for a specific day (YYYY-MM-DD, "today", or "yesterday") based on negative dispense stock movements and confirmed medication prices.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: {
          type: Type.STRING,
          description: 'Target date in YYYY-MM-DD format, or "today" / "yesterday".',
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'find_by_symptom_or_category',
    description:
      'Finds medications by clinical category or symptom (e.g. "Antibacterial", "Antibiotic", "Bronchodilator", "Analgesic", "Antidiabetic").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        category: {
          type: Type.STRING,
          description: 'Category or symptom keyword to search for (e.g. "Antibacterial").',
        },
      },
      required: ['category'],
    },
  },
  {
    name: 'get_sales_summary',
    description:
      'Returns total revenue (in DA) and total items sold between start_date and end_date (inclusive) based on negative stock_movement deltas with reason "dispense".',
    parameters: {
      type: Type.OBJECT,
      properties: {
        start_date: {
          type: Type.STRING,
          description: 'Start date in YYYY-MM-DD format, or "today" / "yesterday".',
        },
        end_date: {
          type: Type.STRING,
          description: 'End date in YYYY-MM-DD format, or "today" / "yesterday".',
        },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'get_top_selling',
    description:
      'Returns the top N most dispensed medications based on negative dispense stock movements, optionally filtered by therapeutic_class or category.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        category: {
          type: Type.STRING,
          description: 'Optional therapeutic_class or category filter (e.g. "Antibiotic", "Analgesic").',
        },
        limit: {
          type: Type.INTEGER,
          description: 'Maximum number of top selling medications to return (e.g. 3, 5).',
        },
      },
    },
  },
  {
    name: 'get_expiring_value',
    description:
      'Returns the total financial value (cost_price * quantity in DA) of all active batches expiring in the next 30 days.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_sales_trend',
    description:
      'Analyzes stock_movement for a specific medication over the last N days (default 30) and returns average daily sales and projected days until stockout.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        medication_id: {
          type: Type.INTEGER,
          description: 'Numeric medication ID.',
        },
        days: {
          type: Type.INTEGER,
          description: 'Number of days to analyze (default 30).',
        },
      },
      required: ['medication_id'],
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

  app.use(express.json({ limit: '15mb' }));

  // Serve static files from public directory
  app.use(express.static(path.join(__dirname, 'public')));



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

      res.json({
        responseText: deterministicResponse,
        usedFallback: true,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Internal server error',
      });
    }
  });

  app.post('/api/ai/daily-briefing', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        topSelling?: { brand_name: string; units_sold: number };
        mostCriticalLowStock?: { brand_name: string; current_qty: number; reorder_level: number } | null;
        expiringCount?: number;
        earliestExpiringBatch?: { brand_name: string; lot_number: string; quantity: number; expiry_date: string } | null;
      };

      const topSelling = body.topSelling;
      if (!topSelling || topSelling.units_sold <= 0) {
        res.json({
          briefing: NO_DATA_BRIEFING_MESSAGE,
          hasData: false,
        });
        return;
      }

      const ai = getGeminiClient();
      if (ai) {
        try {
          const s1Text = `Top selling item: ${topSelling.brand_name} (${topSelling.units_sold} units sold).`;
          const s2Text = body.mostCriticalLowStock
            ? `Most critical stockout risk: ${body.mostCriticalLowStock.brand_name} (${body.mostCriticalLowStock.current_qty} units left, reorder level ${body.mostCriticalLowStock.reorder_level}).`
            : 'Most critical stockout risk: None (stock levels stable).';
          const s3Text = body.earliestExpiringBatch
            ? `Expiring batch warning: ${body.expiringCount ?? 1} batch(es) expiring soon, including ${body.earliestExpiringBatch.brand_name} (Lot ${body.earliestExpiringBatch.lot_number}, ${body.earliestExpiringBatch.quantity} units, expires ${body.earliestExpiringBatch.expiry_date}).`
            : 'Expiring batch warning: No batches expiring in the next 30 days.';

          const prompt = `You are a pharmacy business analyst. Based on this real database summary:\n1. ${s1Text}\n2. ${s2Text}\n3. ${s3Text}\n\nProvide a concise 3-sentence morning briefing for the pharmacist. Highlight medication brand names in bold (e.g. **${topSelling.brand_name}**). Do not invent or change any numbers.`;

          const response = await withTimeout(
            ai.models.generateContent({
              model: 'gemini-3.8-flash',
              contents: prompt,
              config: {
                systemInstruction: 'You are a pharmacy business analyst. Provide a 3-sentence morning briefing using bold text for medication names. Do not invent any numbers.',
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                temperature: 0.1,
              },
            }),
            3000,
          );

          const candidate = response.text?.trim();
          if (candidate) {
            res.json({
              briefing: candidate,
              hasData: true,
            });
            return;
          }
        } catch {
          // Fall back to deterministic briefing
        }
      }

      const s1 = `Your top-selling item is **${topSelling.brand_name}** with **${topSelling.units_sold} units** dispensed.`;
      const s2 = body.mostCriticalLowStock
        ? `The most critical stockout risk is **${body.mostCriticalLowStock.brand_name}** with **${body.mostCriticalLowStock.current_qty} units** remaining against a reorder level of ${body.mostCriticalLowStock.reorder_level}.`
        : 'Stock levels are currently stable with no immediate critical stockout risks.';
      const s3 = body.earliestExpiringBatch
        ? `Warning: **${body.expiringCount ?? 1} batch(es)** are expiring within 30 days, including **${body.earliestExpiringBatch.brand_name}** (Lot \`${body.earliestExpiringBatch.lot_number}\`, **${body.earliestExpiringBatch.quantity} units** expiring on ${body.earliestExpiringBatch.expiry_date}).`
        : 'No active batches are expiring within the next 30 days.';

      res.json({
        briefing: `${s1} ${s2} ${s3}`,
        hasData: true,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to generate briefing.',
      });
    }
  });

  app.post('/api/prescriptions/scan', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        imageBase64?: string;
        mimeType?: string;
      };

      const rawImage = String(body.imageBase64 ?? '').trim();
      if (!rawImage) {
        res.status(400).json({
          error: 'imageBase64 is required to scan a prescription.',
        });
        return;
      }

      let resolvedMimeType = String(body.mimeType ?? 'image/png').trim() || 'image/png';
      let cleanBase64 = rawImage;

      const dataUrlMatch = rawImage.match(/^data:([^;,]+);base64,(.+)$/s);
      if (dataUrlMatch) {
        resolvedMimeType = dataUrlMatch[1].trim() || resolvedMimeType;
        cleanBase64 = dataUrlMatch[2].trim();
      }

      const ai = getGeminiClient();

      if (ai && !resolvedMimeType.includes('svg')) {
        try {
          const response = await withTimeout(
            ai.models.generateContent({
              model: 'gemini-3.8-flash',
              contents: [
                {
                  inlineData: {
                    mimeType: resolvedMimeType,
                    data: cleanBase64,
                  },
                },
                {
                  text: SCAN_PRESCRIPTION_PROMPT,
                },
              ],
              config: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  description:
                    'Medication names and dosages extracted from the handwritten prescription.',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: {
                        type: Type.STRING,
                        description: 'Medication brand or generic name.',
                      },
                      dosage: {
                        type: Type.STRING,
                        description: 'Medication dosage or strength (e.g. 500 mg).',
                      },
                    },
                    required: ['name', 'dosage'],
                  },
                },
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                temperature: 0,
              },
            }),
            8000,
          );

          const parsedItems = parseExtractedPrescriptionJson(response.text ?? '[]');
          if (parsedItems.length > 0) {
            res.json({
              prompt: SCAN_PRESCRIPTION_PROMPT,
              source: 'gemini-vision',
              medications: parsedItems,
            });
            return;
          }
        } catch {
          // Fall back to deterministic sample extraction if Gemini key is unavailable or times out
        }
      }

      res.json({
        prompt: SCAN_PRESCRIPTION_PROMPT,
        source: 'vision-fallback',
        medications: SAMPLE_HANDWRITTEN_PRESCRIPTION_ITEMS,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to scan prescription image.',
      });
    }
  });

  app.post('/api/leaflets/scan', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        imageBase64?: string;
        mimeType?: string;
      };

      const rawImage = String(body.imageBase64 ?? '').trim();
      if (!rawImage) {
        res.status(400).json({
          error: 'imageBase64 is required to scan a medication leaflet.',
        });
        return;
      }

      let resolvedMimeType = String(body.mimeType ?? 'image/png').trim() || 'image/png';
      let cleanBase64 = rawImage;

      const dataUrlMatch = rawImage.match(/^data:([^;,]+);base64,(.+)$/s);
      if (dataUrlMatch) {
        resolvedMimeType = dataUrlMatch[1].trim() || resolvedMimeType;
        cleanBase64 = dataUrlMatch[2].trim();
      }

      const ai = getGeminiClient();

      if (ai && !resolvedMimeType.includes('svg')) {
        try {
          const response = await withTimeout(
            ai.models.generateContent({
              model: 'gemini-3.8-flash',
              contents: [
                {
                  inlineData: {
                    mimeType: resolvedMimeType,
                    data: cleanBase64,
                  },
                },
                {
                  text: SCAN_LEAFLET_PROMPT,
                },
              ],
              config: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  description:
                    'Extracted medication leaflet fields. Leave blank if not found or cannot be read.',
                  properties: {
                    brand_name: { type: Type.STRING },
                    generic_name: { type: Type.STRING },
                    strength: { type: Type.STRING },
                    dosage_form: { type: Type.STRING },
                    posology: { type: Type.STRING },
                    interactions: { type: Type.STRING },
                    composition: { type: Type.STRING },
                    therapeutic_class: { type: Type.STRING },
                    indications: { type: Type.STRING },
                    precautions: { type: Type.STRING },
                    route: { type: Type.STRING },
                    side_effects: { type: Type.STRING },
                  },
                },
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                temperature: 0,
              },
            }),
            10000,
          );

          const parsedData = parseExtractedLeafletJson(response.text ?? '{}');
          // If Gemini extracted at least one meaningful field, return it
          const hasFields = Object.values(parsedData).some((v) => Boolean(v && v.trim()));
          if (hasFields) {
            res.json({
              prompt: SCAN_LEAFLET_PROMPT,
              source: 'gemini-vision',
              data: parsedData,
            });
            return;
          }
        } catch {
          // Fall back gracefully if Gemini key is unavailable or model call times out
        }
      }

      res.json({
        prompt: SCAN_LEAFLET_PROMPT,
        source: 'vision-fallback',
        data: SAMPLE_FALLBACK_LEAFLET_DATA,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to scan medication leaflet.',
      });
    }
  });

  app.post('/api/ai/drug-interactions', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        medications?: DrugInteractionInputItem[];
      };

      const rawMedications = Array.isArray(body.medications) ? body.medications : [];
      const sanitizedMedications: DrugInteractionInputItem[] = rawMedications
        .map((m) => ({
          medicationId: typeof m?.medicationId === 'number' ? m.medicationId : undefined,
          brandName: typeof m?.brandName === 'string' ? m.brandName.trim() : undefined,
          genericName: String(m?.genericName ?? m?.brandName ?? '').trim(),
          atcCode: typeof m?.atcCode === 'string' ? m.atcCode.trim() : null,
        }))
        .filter((m) => m.genericName.length > 0 || (m.brandName && m.brandName.length > 0));

      if (sanitizedMedications.length < 2) {
        res.json(evaluateDeterministicDrugInteractions(sanitizedMedications));
        return;
      }

      const ai = getGeminiClient();

      if (ai) {
        try {
          const medicationListText = sanitizedMedications
            .map((m, idx) => {
              const brand = m.brandName ? `Brand: "${m.brandName}"` : '';
              const generic = m.genericName ? `Generic (DCI): "${m.genericName}"` : '';
              const details = [brand, generic].filter(Boolean).join(', ');
              return `${idx + 1}. ${details || 'Medication'}`;
            })
            .join('\n');

          const strictPrompt = `You are a pharmacist. Analyze this list of medications:
${medicationListText}
Identify any major or severe drug-drug interactions. If the list does not specify the generic names (DCI) or active molecules, infer them from the brand names.
Return a JSON object: { has_interaction: boolean, warning_message: string }.`;

          const response = await withTimeout(
            ai.models.generateContent({
              model: 'gemini-3.8-flash',
              contents: strictPrompt,
              config: {
                systemInstruction:
                  'You are a pharmacist. Analyze this list of medications. Identify any major or severe drug-drug interactions between generic names (DCI) or active molecules. If generic names are absent, infer them from the brand names. Return a JSON object: { has_interaction: boolean, warning_message: string }.',
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    has_interaction: {
                      type: Type.BOOLEAN,
                      description:
                        'True if a major or severe drug-drug interaction is identified between any medications in the list.',
                    },
                    warning_message: {
                      type: Type.STRING,
                      description:
                        'Concise pharmacist explanation of the major or severe interaction and the clinical risk.',
                    },
                  },
                  required: ['has_interaction', 'warning_message'],
                },
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                temperature: 0,
              },
            }),
            4000,
          );

          const parsedJson = JSON.parse(response.text ?? '{}') as {
            has_interaction?: boolean;
            warning_message?: string;
          };

          res.json(normalizeAiInteractionResponse(sanitizedMedications, parsedJson));
          return;
        } catch {
          // Fall back to deterministic pharmacist rule engine if Gemini API is unreachable or times out
        }
      }

      res.json(evaluateDeterministicDrugInteractions(sanitizedMedications));
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to evaluate drug interactions.',
      });
    }
  });

  app.post('/api/ai/stockout-insight', async (req, res) => {
    try {
      const { medications } = req.body as {
        medications?: StockoutPredictionRow[];
      };

      const safeMedications = Array.isArray(medications) ? medications : [];
      const deterministicInsight = synthesizeStockoutPredictionInsight(safeMedications);

      const ai = getGeminiClient();
      if (ai && safeMedications.length > 0) {
        const critical = safeMedications.filter(
          (m) =>
            m.has_sufficient_history &&
            m.days_remaining !== null &&
            m.days_remaining >= 0 &&
            m.days_remaining <= 7.0,
        );

        if (critical.length > 0) {
          try {
            const prompt = `You are a clinical pharmacy stock management assistant.
Generate a single, concise 1-2 sentence stockout alert insight for the dispensary dashboard.
CRITICAL CONSTRAINT: You MUST use ONLY the exact numbers provided below. Do not perform math or invent numbers.
Medications at critical risk (0 to 7 days remaining):
${JSON.stringify(
  critical.map((c) => ({
    name: c.brand_name,
    currentStock: c.current_stock,
    avgDailyUsage: Number(c.avg_daily_usage.toFixed(2)),
    daysRemaining: Number((c.days_remaining ?? 0).toFixed(1)),
    suggestedReorderQuantity: c.suggested_reorder_qty,
  })),
)}

Example format: "Amoxil will run out in 4.0 days based on current sales speed (12 units in stock, 3.0/day). Consider reordering 84 units."`;

            const response = await withTimeout(
              ai.models.generateContent({
                model: 'gemini-3.8-flash',
                contents: prompt,
                config: {
                  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                  temperature: 0.1,
                },
              }),
              3000,
            );

            const text = response.text?.trim();
            if (text && text.length > 10) {
              res.json({
                insight: text,
                isAiGenerated: true,
              });
              return;
            }
          } catch {
            // Fall back gracefully to deterministic insight
          }
        }
      }

      res.json({
        insight: deterministicInsight,
        isAiGenerated: false,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to generate stockout insight.',
      });
    }
  });

  // ============================================================================
  // 8. Generic Substitution DCI Inference Endpoint
  // ============================================================================
  app.post('/api/ai/infer-dci', async (req, res) => {
    try {
      const { brandName } = req.body as {
        brandName?: string;
        prompt?: string;
      };

      const safeBrand = typeof brandName === 'string' ? brandName.trim() : '';
      if (!safeBrand) {
        res.json({ dci: null, source: 'deterministic' });
        return;
      }

      const deterministicDci = inferDciFromBrandNameDeterministic(safeBrand);
      const ai = getGeminiClient();

      if (ai) {
        try {
          const prompt = `You are a clinical pharmacist. ${GENERIC_DCI_INFERENCE_PROMPT}
Brand name: "${safeBrand}"
Return ONLY a JSON object: { "dci": string | null } where "dci" is the International Nonproprietary Name (INN / DCI) active molecule in English (e.g., "Amoxicillin", "Paracetamol", "Salbutamol").`;

          const response = await withTimeout(
            ai.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: prompt,
              config: {
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                temperature: 0.0,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    dci: {
                      type: Type.STRING,
                      description: 'The active molecule / DCI name for the medication brand.',
                    },
                  },
                  required: ['dci'],
                },
              },
            }),
            3500,
          );

          const rawText = response.text?.trim();
          if (rawText) {
            const parsed = JSON.parse(rawText) as { dci?: string | null };
            if (typeof parsed.dci === 'string' && parsed.dci.trim().length > 0) {
              res.json({
                dci: parsed.dci.trim(),
                source: 'ai',
              });
              return;
            }
          }
        } catch {
          // Fall back gracefully to deterministic dictionary
        }
      }

      res.json({
        dci: deterministicDci,
        source: 'deterministic',
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to infer DCI from brand name.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, watch: null },
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
