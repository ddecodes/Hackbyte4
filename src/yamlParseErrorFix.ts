/**
 * Uses Gemini to propose a corrected YAML string from a js-yaml parse error.
 */
import * as jsYaml from 'js-yaml';
import { generateContentJson } from './geminiGraphValidation';

export interface ParseErrorFixProposal {
    analysis: string;
    changeSummary: string;
    proposedYaml: string;
}

const MAX_YAML_CHARS = 120_000;

function parseJsonObjectFromModelText(text: string): Record<string, unknown> {
    const trimmed = text.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed);
    const raw = (fenced ? fenced[1] : trimmed).trim();
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Model did not return a JSON object');
    }
    return parsed as Record<string, unknown>;
}

function validateProposedYamlLoads(proposedYaml: string, log?: (msg: string) => void): void {
    const L = log ?? (() => {});
    try {
        jsYaml.loadAll(proposedYaml, (doc) => {
            void doc;
        });
    } catch (e) {
        L(`Proposed YAML still fails js-yaml: ${String(e)}`);
        throw new Error(
            `Proposed YAML still does not parse: ${e instanceof Error ? e.message : String(e)}`
        );
    }
}

export async function proposeYamlParseFix(
    apiKey: string,
    model: string,
    errorMessage: string,
    yamlContent: string,
    fileLabel: string,
    log?: (msg: string) => void
): Promise<ParseErrorFixProposal> {
    const L = log ?? (() => {});
    const truncated = yamlContent.length > MAX_YAML_CHARS;
    const body = truncated ? yamlContent.slice(0, MAX_YAML_CHARS) : yamlContent;
    const instruction = `You are helping fix a YAML file that fails to parse (JavaScript js-yaml / YAML 1.2 style).

File: ${fileLabel}

Parser error message:
${errorMessage}

${truncated ? `NOTE: Only the first ${MAX_YAML_CHARS} characters of the file are shown below (file was truncated for this request).\n\n` : ''}
Current file content:
"""
${body}
"""

Return ONLY a JSON object (no markdown fences) with exactly these string fields:
- "analysis": 2-6 sentences explaining what is wrong and where.
- "changeSummary": numbered list (plain text) of concrete edits you will make so an engineer can approve before applying.
- "proposedYaml": the complete corrected file content as a single string. It MUST parse with js-yaml loadAll. Preserve structure, comments, and key order where reasonable. Do not invent unrelated keys unless required for validity.

If you cannot safely fix it, set "proposedYaml" to the same as input and explain in "analysis" why.`;

    const text = await generateContentJson(apiKey, model, instruction, L);
    const obj = parseJsonObjectFromModelText(text);
    const analysis = typeof obj.analysis === 'string' ? obj.analysis.trim() : '';
    const changeSummary =
        typeof obj.changeSummary === 'string' ? obj.changeSummary.trim() : '';
    const proposedYaml =
        typeof obj.proposedYaml === 'string' ? obj.proposedYaml : '';
    if (!proposedYaml) {
        throw new Error('Model response missing proposedYaml');
    }
    validateProposedYamlLoads(proposedYaml, L);
    return {
        analysis: analysis || 'No analysis provided.',
        changeSummary: changeSummary || 'See proposed YAML.',
        proposedYaml,
    };
}
