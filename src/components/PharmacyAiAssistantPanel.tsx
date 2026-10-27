import React, { useEffect, useState } from 'react';
import {
  AssistantModelUnreachableError,
  AssistantRateLimitError,
  defaultAssistantRateLimiter,
  runAssistantTurn,
  type AssistantRequestLogEntry,
  type ExecutedToolCallRecord,
} from '../assistant';
import { getRepositoryDatabase, type Medication } from '../db/repository';

export interface PharmacyAiAssistantPanelProps {
  selectedMedication: Medication | null;
}

interface ChatMessageItem {
  id: string;
  role: 'assistant';
  userPrompt: string;
  responseText: string;
  toolCalls: ExecutedToolCallRecord[];
  status: AssistantRequestLogEntry['status'];
  timestamp: string;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: {
    0: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export const PharmacyAiAssistantPanel: React.FC<PharmacyAiAssistantPanelProps> = ({
  selectedMedication,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [queryInput, setQueryInput] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [isListeningVoice, setIsListeningVoice] = useState<boolean>(false);
  const [voiceStatusNote, setVoiceStatusNote] = useState<string | null>(null);
  const [isModelOffline, setIsModelOffline] = useState<boolean>(false);
  const [rateLimitStatus, setRateLimitStatus] = useState(() =>
    defaultAssistantRateLimiter.getStatus(),
  );

  // Check model reachability on mount and listen to browser online/offline events
  useEffect(() => {
    let mounted = true;

    const handleOffline = () => {
      if (mounted) {
        setIsModelOffline(true);
        setIsOpen(false);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('offline', handleOffline);
    }

    fetch('/api/ai/health', { method: 'GET' })
      .then((res) => {
        if (mounted && !res.ok) {
          setIsModelOffline(true);
        }
      })
      .catch(() => {
        // Keep usable via local read-only planner unless explicitly unreachable during chat
      });

    return () => {
      mounted = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('offline', handleOffline);
      }
    };
  }, []);

  const refreshRateStatus = () => {
    setRateLimitStatus(defaultAssistantRateLimiter.getStatus());
  };

  const triggerOfflineFallback = () => {
    setIsModelOffline(true);
    setIsOpen(false);
    if (typeof document !== 'undefined') {
      const searchInput = document.getElementById(
        'primary-medication-search-input',
      ) as HTMLInputElement | null;
      if (searchInput) {
        searchInput.focus();
      }
    }
  };

  const formatToolCallSignature = (tc: ExecutedToolCallRecord): string => {
    const args = tc.args ?? {};
    if (tc.name === 'get_revenue') {
      return `get_revenue(${JSON.stringify(String(args.date ?? 'today'))})`;
    }
    if (tc.name === 'list_expiring') {
      return `list_expiring(${String(args.days ?? 30)})`;
    }
    if (tc.name === 'find_by_symptom_or_category') {
      return `find_by_symptom_or_category(${JSON.stringify(String(args.category ?? ''))})`;
    }
    if (tc.name === 'search_medication' && args.query) {
      return `search_medication(${JSON.stringify(String(args.query))})`;
    }
    if (tc.name === 'get_stock' && args.medication_id !== undefined) {
      return `get_stock(${String(args.medication_id)})`;
    }
    return tc.name;
  };

  const renderFormattedAssistantText = (rawText: string): React.ReactNode => {
    const tokens = rawText.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return tokens.map((token, idx) => {
      if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
        return (
          <strong key={idx} className="font-semibold text-slate-900 dark:text-white">
            {token.slice(2, -2)}
          </strong>
        );
      }
      if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
        return (
          <code
            key={idx}
            className="px-1 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded text-[11px] font-mono"
          >
            {token.slice(1, -1)}
          </code>
        );
      }
      return <React.Fragment key={idx}>{token}</React.Fragment>;
    });
  };

  const executePrompt = async (
    promptText: string,
    forcedToolCalls?: { name: string; args: Record<string, unknown> }[],
  ) => {
    const trimmed = promptText.trim();
    if (!trimmed) return;

    setQueryInput('');
    setIsLoading(true);
    setErrorBanner(null);

    try {
      const db = getRepositoryDatabase();
      const nowIso = new Date().toISOString();
      const turn = await runAssistantTurn(db, trimmed, {
        contextMedicationId: selectedMedication?.id ?? 1,
        contextMedicationName: selectedMedication?.brand_name ?? 'Amoxil',
        referenceDate: nowIso.slice(0, 10),
        referenceTimestamp: nowIso,
        forcedToolCalls,
        useRemoteModelEndpoint: !forcedToolCalls,
      });

      const newMsg: ChatMessageItem = {
        id: turn.logEntry.id,
        role: 'assistant',
        userPrompt: turn.userPrompt,
        responseText: turn.responseText,
        toolCalls: turn.toolCalls,
        status: turn.status,
        timestamp: turn.logEntry.timestamp,
      };

      setMessages((prev) => [newMsg, ...prev]);
      refreshRateStatus();
    } catch (err) {
      refreshRateStatus();
      if (err instanceof AssistantModelUnreachableError) {
        triggerOfflineFallback();
        return;
      }
      if (err instanceof AssistantRateLimitError) {
        setErrorBanner(err.message);
        return;
      }
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await executePrompt(queryInput);
  };

  const handleVoiceInput = () => {
    if (typeof window === 'undefined') return;
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRecCtor = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecCtor) {
      setVoiceStatusNote('Voice input is not supported in this browser; please type your question.');
      return;
    }

    try {
      const recognition = new SpeechRecCtor();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      setIsListeningVoice(true);
      setVoiceStatusNote('Listening...');

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        const transcript = event.results?.[0]?.[0]?.transcript ?? '';
        if (transcript) {
          setQueryInput(transcript);
          setVoiceStatusNote(`Heard: "${transcript}"`);
          void executePrompt(transcript);
        }
      };

      recognition.onerror = () => {
        setIsListeningVoice(false);
        setVoiceStatusNote('Microphone unavailable. Please type your question.');
      };

      recognition.onend = () => {
        setIsListeningVoice(false);
      };

      recognition.start();
    } catch {
      setIsListeningVoice(false);
      setVoiceStatusNote('Could not start microphone.');
    }
  };

  // Offline fallback: if the model is unreachable, hide the AI Assistant so the plain search bar remains primary
  if (isModelOffline) {
    return null;
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end">
      {/* Floating Chat Window */}
      {isOpen && (
        <section
          id="ai-assistant-section"
          data-testid="ai-assistant-panel"
          aria-label="Pharmacy Inventory Assistant"
          className="mb-4 w-[calc(100vw-3rem)] sm:w-[440px] max-h-[80vh] bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-700/80 rounded-2xl shadow-2xl shadow-slate-900/15 flex flex-col overflow-hidden"
        >
          {/* Chat Window Header */}
          <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-300">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                  />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-bold tracking-tight text-white">
                  Pharmacy Assistant
                </h2>
                <p className="text-[11px] text-slate-300">
                  Read-only inventory &amp; sales lookup · Context: {selectedMedication?.brand_name ?? 'Amoxil'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <span
                data-testid="ai-rate-limit-badge"
                className="sr-only"
              >
                {rateLimitStatus.used}/{rateLimitStatus.max}
              </span>
              <button
                type="button"
                data-testid="ai-close-window-btn"
                onClick={() => setIsOpen(false)}
                aria-label="Close assistant window"
                className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Scrollable Messages & Quick Chips Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/60 dark:bg-slate-950/50">
            {/* Suggested Questions */}
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Suggested Questions
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  data-testid="ai-quick-expiring"
                  onClick={() => void executePrompt('What is expiring this month?')}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-sky-950/50 hover:text-sky-700 dark:hover:text-sky-300 hover:border-sky-200 border border-slate-200/90 dark:border-slate-700 rounded-lg transition-colors shadow-2xs"
                >
                  What is expiring this month?
                </button>
                <button
                  type="button"
                  data-testid="ai-quick-revenue-today"
                  onClick={() => void executePrompt('How much did we sell today?')}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-sky-950/50 hover:text-sky-700 dark:hover:text-sky-300 hover:border-sky-200 border border-slate-200/90 dark:border-slate-700 rounded-lg transition-colors shadow-2xs"
                >
                  How much did we sell today?
                </button>
                <button
                  type="button"
                  data-testid="ai-quick-category-antibacterial"
                  onClick={() => void executePrompt('Find Antibacterial medications')}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-sky-950/50 hover:text-sky-700 dark:hover:text-sky-300 hover:border-sky-200 border border-slate-200/90 dark:border-slate-700 rounded-lg transition-colors shadow-2xs"
                >
                  Find Antibacterial medications
                </button>
                <button
                  type="button"
                  data-testid="ai-quick-where-amox"
                  onClick={() => void executePrompt('where are the amoxicillin capsules')}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-sky-950/50 hover:text-sky-700 dark:hover:text-sky-300 hover:border-sky-200 border border-slate-200/90 dark:border-slate-700 rounded-lg transition-colors shadow-2xs"
                >
                  Where are amoxicillin capsules?
                </button>
                <button
                  type="button"
                  data-testid="ai-quick-low-stock"
                  onClick={() => void executePrompt("what's running low?")}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-sky-950/50 hover:text-sky-700 dark:hover:text-sky-300 hover:border-sky-200 border border-slate-200/90 dark:border-slate-700 rounded-lg transition-colors shadow-2xs"
                >
                  What&apos;s running low?
                </button>
                <button
                  type="button"
                  data-testid="ai-quick-calc-this"
                  onClick={() =>
                    void executePrompt('how much for 3 boxes of this with 10% off')
                  }
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-sky-950/50 hover:text-sky-700 dark:hover:text-sky-300 hover:border-sky-200 border border-slate-200/90 dark:border-slate-700 rounded-lg transition-colors shadow-2xs"
                >
                  3 boxes with 10% off
                </button>
                <button
                  type="button"
                  data-testid="ai-quick-null-price"
                  onClick={() => void executePrompt('how much is Lantus SoloStar?')}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-sky-950/50 hover:text-sky-700 dark:hover:text-sky-300 hover:border-sky-200 border border-slate-200/90 dark:border-slate-700 rounded-lg transition-colors shadow-2xs"
                >
                  Price of Lantus SoloStar?
                </button>
              </div>
            </div>

            {errorBanner && (
              <div
                role="alert"
                data-testid="ai-assistant-error-banner"
                className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-800 dark:text-red-200"
              >
                {errorBanner}
              </div>
            )}

            {/* Conversation Feed */}
            {messages.length === 0 ? (
              <div
                data-testid="ai-assistant-empty-state"
                className="p-5 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl text-center space-y-1.5"
              >
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                  Type any question about sales, expiry, categories, stock, or pricing
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Every answer is grounded strictly in read-only tools over your pharmacy database.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg) => (
                  <article
                    key={msg.id}
                    data-testid="ai-assistant-message-card"
                    className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden shadow-2xs"
                  >
                    <div className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                      <span
                        data-testid="ai-assistant-user-prompt"
                        className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate"
                      >
                        &ldquo;{msg.userPrompt}&rdquo;
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0">
                        {msg.timestamp.slice(11, 16)}
                      </span>
                    </div>

                    <div className="p-3.5 space-y-3">
                      <div
                        data-testid="ai-assistant-answer-text"
                        className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 whitespace-pre-line leading-relaxed"
                      >
                        {renderFormattedAssistantText(msg.responseText)}
                      </div>

                      {/* Tool Calls Displayed Under Each Answer */}
                      <div
                        data-testid="ai-message-tool-calls"
                        className="pt-2.5 border-t border-slate-100 dark:border-slate-800 space-y-1.5"
                      >
                        <div className="text-[11px] font-medium text-slate-400">
                          Verified Sources ({msg.toolCalls.length})
                        </div>

                        {msg.toolCalls.length === 0 ? (
                          <div className="text-[11px] text-slate-400">
                            Read-only policy response (no database changes permitted)
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {msg.toolCalls.map((tc) => (
                              <div
                                key={tc.id}
                                data-testid={`ai-tool-call-${tc.name}`}
                                className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-mono ${
                                  tc.status === 'rejected_by_guard'
                                    ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
                                    : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate font-semibold" title={formatToolCallSignature(tc)}>
                                    {formatToolCallSignature(tc)}
                                  </span>
                                  <span
                                    className={`px-1.5 py-0.5 text-[10px] rounded font-sans font-medium shrink-0 ${
                                      tc.status === 'rejected_by_guard'
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                    }`}
                                  >
                                    {tc.status === 'rejected_by_guard' ? 'Blocked' : 'Verified'}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          {/* Input Bar */}
          <form
            onSubmit={handleFormSubmit}
            className="p-3.5 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 space-y-2 shrink-0"
          >
            {voiceStatusNote && (
              <div data-testid="ai-voice-status-note" className="text-[11px] text-slate-500 px-1">
                {voiceStatusNote}
              </div>
            )}
            <div className="flex items-center gap-2">
              <label htmlFor="ai-assistant-query-input" className="sr-only">
                Ask the pharmacy assistant
              </label>
              <input
                id="ai-assistant-query-input"
                data-testid="ai-assistant-input"
                type="text"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="Type a question (e.g., How much did we sell today?)..."
                className="flex-1 px-3.5 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-xl focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
              />
              <button
                type="button"
                data-testid="ai-assistant-voice-btn"
                onClick={handleVoiceInput}
                aria-label="Voice input"
                title="Voice input"
                className={`p-2 rounded-xl border transition-colors ${
                  isListeningVoice
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                  />
                </svg>
              </button>
              <button
                type="submit"
                data-testid="ai-assistant-send-btn"
                disabled={isLoading || !queryInput.trim()}
                className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-xl hover:bg-sky-700 disabled:opacity-50 transition-colors"
              >
                {isLoading ? '...' : 'Ask'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Floating Action Button (Chat Bubble Icon in Bottom Right Corner) */}
      <button
        type="button"
        data-testid="ai-assistant-fab"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? 'Close Pharmacy Assistant' : 'Open Pharmacy Assistant'}
        className="flex items-center gap-2.5 px-4 py-3.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white shadow-xl shadow-slate-900/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
      >
        <svg
          className="w-5 h-5 text-sky-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
          />
        </svg>
        <span className="text-xs font-semibold tracking-tight pr-0.5">
          {isOpen ? 'Close Assistant' : 'Ask Assistant'}
        </span>
      </button>
    </div>
  );
};
