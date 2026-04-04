/**
 * Calls Google Gemini to classify graph nodes (YAML fragments) as good / warning / error.
 */

export interface GraphNodePayload {
    id: string;
    label: string;
    snippet: string;
}

export interface NodeValidationResult {
    nodeId: string;
    status: 'good' | 'warning' | 'error';
    message: string;
}

const MAX_SNIPPET_LEN = 2000;

export function trimSnippet(snippet: string): string {
    if (snippet.length <= MAX_SNIPPET_LEN) {
        return snippet;
    }
    return snippet.slice(0, MAX_SNIPPET_LEN) + '…';
}

function normalizeStatus(raw: string): 'good' | 'warning' | 'error' {
    const s = (raw || '').toLowerCase().trim();
    if (s === 'error' || s === 'critical' || s === 'invalid') {
        return 'error';
    }
    if (s === 'warning' || s === 'warn' || s === 'caution' || s === 'degraded') {
        return 'warning';
    }
    return 'good';
}

function parseJsonArrayFromModelText(text: string): unknown[] {
    const trimmed = text.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed);
    const raw = (fenced ? fenced[1] : trimmed).trim();
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed;
        }
    } catch {
        // fall through
    }
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start >= 0 && end > start) {
        const parsed = JSON.parse(raw.slice(start, end + 1));
        if (Array.isArray(parsed)) {
            return parsed;
        }
    }
    throw new Error('Gemini response was not a JSON array');
}

async function generateContentJson(
    apiKey: string,
    model: string,
    userPrompt: string,
    log?: (msg: string) => void
): Promise<string> {
    const L = log ?? (() => { });
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = {
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
        },
    };

    L(`Gemini request: model=${model}, userPromptLength=${userPrompt.length}`);

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    L(`Gemini HTTP ${res.status} ${res.statusText}`);

    if (!res.ok) {
        const errText = await res.text();
        L(`Gemini error body: ${errText.slice(0, 1500)}${errText.length > 1500 ? '…' : ''}`);
        throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 500)}`);
    }

    const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { message?: string };
        promptFeedback?: { blockReason?: string };
    };

    if (data.error?.message) {
        L(`Gemini response error field: ${data.error.message}`);
        throw new Error(data.error.message);
    }

    if (data.promptFeedback?.blockReason) {
        L(`Gemini promptFeedback.blockReason: ${data.promptFeedback.blockReason}`);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
        const summary = JSON.stringify(data).slice(0, 800);
        L(`Gemini no candidate text; response snippet: ${summary}…`);
        throw new Error('Empty response from Gemini (no candidates)');
    }

    L(
        `Gemini raw output (${text.length} chars): ${text.slice(0, 4000)}${text.length > 4000 ? '…' : ''}`
    );
    return text;
}

function mapRow(row: unknown, allowedIds: Set<string>): NodeValidationResult | null {
    if (!row || typeof row !== 'object') {
        return null;
    }
    const o = row as Record<string, unknown>;
    const nodeId = typeof o.nodeId === 'string' ? o.nodeId : typeof o.id === 'string' ? o.id : '';
    if (!nodeId || !allowedIds.has(nodeId)) {
        return null;
    }
    const status = normalizeStatus(String(o.status ?? 'good'));
    const message =
        typeof o.message === 'string'
            ? o.message.slice(0, 500)
            : typeof o.detail === 'string'
                ? o.detail.slice(0, 500)
                : status === 'good'
                    ? 'Looks fine for this fragment.'
                    : 'See model output.';
    return { nodeId, status, message };
}

/**
 * Validates one chunk of nodes in a single API call.
 */
export async function validateGraphNodeChunk(
    apiKey: string,
    model: string,
    nodes: GraphNodePayload[],
    log?: (msg: string) => void
): Promise<NodeValidationResult[]> {
    const L = log ?? (() => { });

    if (nodes.length === 0) {
        return [];
    }

    const allowedIds = new Set(nodes.map((n) => n.id));

    const instruction = `You review YAML-derived JSON fragments (e.g. Kubernetes, app config). For each node, assess validity, common mistakes, missing required fields, risky values, and type issues.

Return ONLY a JSON array (no markdown). Each element must be:
{"nodeId":"<id from input>","status":"good"|"warning"|"error","message":"<1-2 short sentences for a UI tooltip>"}

Rules:
- "good": fragment appears valid and consistent.
- "warning": suspicious, deprecated, or error-prone but might work.
- "error": clear breakage (wrong types, empty required objects, invalid structure).

Input:
${JSON.stringify(nodes)}`;

    const text = await generateContentJson(apiKey, model, instruction, L);
    const arr = parseJsonArrayFromModelText(text);
    L(`Parsed JSON array with ${arr.length} row(s); allowed node ids: ${[...allowedIds].join(', ')}`);

    const out: NodeValidationResult[] = [];
    const seen = new Set<string>();

    for (const row of arr) {
        const mapped = mapRow(row, allowedIds);
        if (mapped && !seen.has(mapped.nodeId)) {
            seen.add(mapped.nodeId);
            out.push(mapped);
        } else if (row && typeof row === 'object') {
            const o = row as Record<string, unknown>;
            const id = typeof o.nodeId === 'string' ? o.nodeId : typeof o.id === 'string' ? o.id : '';
            if (id && !allowedIds.has(id)) {
                L(`Skipped row: nodeId "${id}" not in this chunk (model used wrong id?)`);
            }
        }
    }

    // Fill missing ids as good so every node gets a result
    for (const n of nodes) {
        if (!seen.has(n.id)) {
            out.push({
                nodeId: n.id,
                status: 'good',
                message: 'No specific issues reported for this fragment.',
            });
        }
    }

    return out;
}

