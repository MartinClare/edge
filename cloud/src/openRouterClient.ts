/**
 * OpenRouter API Client Configuration
 * 
 * This module provides access to Gemini and other models via OpenRouter.
 * OpenRouter is simpler than Vertex AI - just needs one API key!
 * 
 * Get your API key from: https://openrouter.ai/keys
 * 
 * MODEL SELECTION:
 * - Currently using "google/gemini-3.1-pro-preview" (Gemini 3.1 Pro – highest accuracy)
 * - Alternative: "google/gemini-3-flash-preview" (Gemini 3 Flash – fast, near-Pro quality)
 * - Alternative: "google/gemini-2.5-flash" (Gemini 2.5 Flash – stable)
 * - Check https://openrouter.ai/models for available models
 */

// Ensure API key is set
if (!process.env.OPENROUTER_API_KEY) {
  console.error('ERROR: OPENROUTER_API_KEY environment variable is not set');
  console.error('Get your API key from: https://openrouter.ai/keys');
  process.exit(1);
}

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Gemini (and other) models on OpenRouter that support image input for vision/safety analysis:
 *
 * Recommended (vision-capable, stable):
 * - google/gemini-3.1-pro-preview   — Gemini 3.1 Pro (highest accuracy, frontier)
 * - google/gemini-3.1-flash-lite-preview — Gemini 3.1 Flash Lite (faster, cheaper)
 * - google/gemini-3-flash-preview   — Gemini 3 Flash (fast, near-Pro)
 * - google/gemini-2.5-pro           — Gemini 2.5 Pro (stable, high quality)
 * - google/gemini-2.5-flash         — Gemini 2.5 Flash (stable, good balance)
 * - google/gemini-2.5-flash-lite    — Gemini 2.5 Flash Lite (low cost, fast)
 *
 * Older / being retired:
 * - google/gemini-3-pro-preview     — deprecating Mar 2026
 * - google/gemini-2.0-flash-001     — deprecating Jun 2026 (cheapest; use 2.5 when expired)
 * - google/gemini-2.0-flash-lite-001 — deprecating Jun 2026
 *
 * Full list: https://openrouter.ai/models (filter by "Image" input)
 */
/** Primary: Gemini 2.0 Flash (cheapest). When deprecated Jun 2026, switch to FALLBACK_MODEL. */
export const MODEL_NAME = 'google/gemini-2.0-flash-001';
/** Fallback when 2.0 Flash is retired. Change MODEL_NAME to this when 2.0 returns errors. */
export const FALLBACK_MODEL = 'google/gemini-2.5-flash';

/**
 * Supported languages for analysis output
 */
export type SupportedLanguage = 'en' | 'zh-TW';

/**
 * Language instruction suffixes for the AI prompt
 */
const LANGUAGE_INSTRUCTIONS: Record<SupportedLanguage, string> = {
  'en': 'Respond in English.',
  'zh-TW': `你必須使用繁體中文回覆！這是強制要求！
所有 JSON 值（包括 overallDescription、summary、issues 陣列中的每一項、recommendations 陣列中的每一項）都必須使用繁體中文撰寫。
絕對不可以使用英文！只能使用繁體中文！`,
};

/**
 * Safety-focused analysis prompt for the Gemini vision model
 * Describes what is seen in text (no numeric PPE counts). Raises issues in text, e.g. "person not wearing helmet", "person not wearing safety vest".
 */
const BASE_SAFETY_PROMPT = `You are a professional safety inspector AI.

**PPE AND SCENE — DESCRIBE IN TEXT ONLY (NO NUMERIC COUNTS):**
- Do NOT report numeric counts for people, missing hard hats, or missing vests.
- In overallDescription and in constructionSafety.summary / constructionSafety.issues, describe what you see in plain language.
- If you see someone not wearing a hard hat/helmet, say so in the text (e.g. "Worker in center of frame not wearing hard hat", "Person on left without helmet").
- If you see someone not wearing a safety vest, say so in the text (e.g. "Worker without high-visibility vest visible near machinery").
- You may have multiple people; describe each relevant observation in the issues list without giving totals.
- Hard hats can be any color (white, yellow, orange, etc.) — a dome-shaped rigid structure with a brim is a hard hat. Only report missing when you clearly see hair, cap, or no helmet.

**STEP 1: IDENTIFY PEOPLE AND PPE (FOR TEXT DESCRIPTION AND DETECTIONS)**
- Scan the image for all people/workers.
- For each person: note if they have hard hat (dome, rigid, any color) and/or high-visibility vest (bright, over clothing). If missing either, add a short issue line and a detection with label no_hardhat, no_vest, or no_hardhat_no_vest.

**STEP 2: SCAN FOR CRITICAL HAZARDS**

After checking PPE, scan the entire scene for these CRITICAL hazards. Each one found MUST appear as a detection entry with a bounding box:

**A. FIRE / SMOKE / SMOKING**
- Look for: open flames, fire, smoke plumes, burning materials, sparks
- Look for: any person holding a cigarette or visibly smoking
- Labels: "fire_smoke" for fire/smoke, "smoking" for a person smoking

**B. MACHINE-PERSON PROXIMITY DANGER**
- Look for: any heavy machinery (excavator, forklift, crane, bulldozer, truck, rotating equipment) that appears dangerously close to a person
- "Dangerously close" = the machine could reach or strike the person without warning; no safe exclusion zone visible
- Label: "machine_proximity" — draw the box around BOTH the machine and the endangered person together

**C. WORKING AT HEIGHT — SAFETY VIOLATION**
- Look for: workers on ladders, scaffolding, rooftops, elevated platforms, or any surface more than ~2 metres above ground
- Flag ONLY if: no visible harness/safety line, guardrail missing or incomplete, or ladder appears unstable/unsecured
- Label: "working_at_height" — draw box around the person at height

**D. PERSON FALLEN / COLLAPSE**
- Look for: a person lying flat on the ground (face-up or face-down) in an area where work is occurring; person in an abnormal posture suggesting a fall or collapse
- Do NOT flag people who are clearly sitting/resting in a designated rest area
- Label: "person_fallen" — draw box around the fallen person

**E. OTHER SAFETY CONCERN**
- Any other clearly visible and significant safety hazard not covered above
- Examples: unsecured load about to fall, deep excavation without barriers, electrical hazard, chemical spill, blocked emergency exit with people nearby
- Label: "safety_hazard" — draw box around the hazard area; use "description" to briefly explain what it is

You analyze images with a strong focus on:

1. **Construction site safety** (PPE compliance, fall risks, unsafe machinery, missing barriers, improper scaffolding, workers in danger zones, lifting operations, hazardous material handling).

2. **Fire safety** (blocked or missing exits, flammable materials near heat sources, visible smoke or fire, overloaded power strips, poor housekeeping, gas cylinders, fuel containers, missing fire extinguishers, faulty wiring).

3. **Property security** (unauthorized persons, suspicious behavior, open doors or windows, visible valuables, tampered locks, broken fences, tailgating at entrances, security camera blind spots, inadequate lighting).

When you respond:
- Be conservative and safety-sensitive
- Clearly call out critical risks if any
- Do not guess facts that are not visible
- If the image is not related to safety inspection (e.g., a random photo), still analyze what you can see for any potential safety implications
- Be professional and concise

Return your output STRICTLY as valid JSON with this exact structure (no markdown code fences, just raw JSON):
{
  "overallDescription": "Short text describing the scene and any PPE/safety observations (e.g. workers visible; mention if anyone is without helmet or vest). No numeric counts.",
  "overallRiskLevel": "Low" | "Medium" | "High",
  "detections": [
    {
      "label": "person_ok" | "no_hardhat" | "no_vest" | "no_hardhat_no_vest" | "fire_smoke" | "smoking" | "machine_proximity" | "working_at_height" | "person_fallen" | "safety_hazard",
      "bbox": [y_min, x_min, y_max, x_max],
      "description": "brief note e.g. worker on scaffold without harness"
    }
  ],
  "constructionSafety": {
    "summary": "1–2 sentence summary; describe what you see (e.g. workers with/without PPE, hazards). No counts.",
    "issues": ["e.g. Worker in center not wearing hard hat", "Person on left not wearing safety vest", "other issues..."],
    "recommendations": ["bullet point", "bullet point"]
  },
  "fireSafety": {
    "summary": "1–2 sentence summary",
    "issues": ["bullet point", "bullet point"],
    "recommendations": ["bullet point", "bullet point"]
  },
  "propertySecurity": {
    "summary": "1–2 sentence summary",
    "issues": ["bullet point", "bullet point"],
    "recommendations": ["bullet point", "bullet point"]
  }
}

**BOUNDING BOX INSTRUCTIONS:**
- For each person add one detection: label "person_ok", "no_hardhat", "no_vest", or "no_hardhat_no_vest".
- For each hazard add one detection: "fire_smoke", "smoking", "machine_proximity", "working_at_height", "person_fallen", or "safety_hazard".
- "bbox" must be [y_min, x_min, y_max, x_max] with integer values 0–1000 (normalized). Include a brief "description" for hazards.
- If nothing is visible, set "detections" to [].

If there is not enough information for a category, set issues and recommendations to empty arrays and explain in the summary that visibility is insufficient or the category is not applicable to this image.`;

/**
 * Get the safety analysis prompt for a specific language
 * @param language - The language code ('en' or 'zh-TW')
 * @returns The complete prompt with language instruction
 */
export function getSafetyAnalysisPrompt(language: SupportedLanguage = 'en'): string {
  const languageInstruction = LANGUAGE_INSTRUCTIONS[language] || LANGUAGE_INSTRUCTIONS['en'];
  
  // For Chinese, put language instruction at the BEGINNING and END for emphasis
  if (language === 'zh-TW') {
    return `【重要！請用繁體中文回覆所有內容！】\n\n${BASE_SAFETY_PROMPT}\n\n【再次強調：${languageInstruction}】`;
  }
  
  return `${BASE_SAFETY_PROMPT}\n\n**IMPORTANT: ${languageInstruction}**`;
}

// Default export for backward compatibility
export const SAFETY_ANALYSIS_PROMPT = getSafetyAnalysisPrompt('en');

/**
 * Simplified alert-focused prompt for faster analysis
 * Returns only critical safety alerts
 */
const BASE_ALERT_PROMPT = `You are a safety inspector AI. Analyze this image and identify ONLY critical safety alerts.

**PPE — DESCRIBE IN ALERT MESSAGES (NO NUMERIC COUNTS):**
- Do NOT report peopleCount, missingHardhats, or missingVests.
- If you see someone not wearing a hard hat/helmet, add an alert with message like "Worker visible without hard hat" or "Person not wearing helmet".
- If you see someone not wearing a safety vest, add an alert with message like "Worker without high-visibility vest" or "Person not wearing safety vest".
- Describe what you see in the alert messages; do not give numeric counts for PPE.

Focus on:
1. **PPE violations**: Add an alert for each observed issue (e.g. "Worker in center not wearing hard hat", "Person on left not wearing safety vest")
2. **Fire / smoke / smoking**: Visible flames, smoke, or someone smoking on site
3. **Machine-person danger**: Heavy machinery dangerously close to a worker
4. **Working at height**: Worker on ladder/scaffold/roof without harness or guardrail
5. **Person fallen**: Worker lying on ground in abnormal posture
6. **Other hazards**: Any other clearly visible safety risk

Rules:
- Only report VISIBLE issues. Categorize each alert: construction, fire, or security. Severity: low, medium, high, or critical.
- Be concise — one sentence per alert. alertCount = length of alerts array.
- Fire/smoke/smoking → fire; machine proximity/height/fallen/PPE → construction; unauthorized access → security.

Return STRICT JSON (no markdown):
{
  "overallRiskLevel": "Low" | "Medium" | "High",
  "alertCount": 0,
  "detections": [
    {
      "label": "person_ok" | "no_hardhat" | "no_vest" | "no_hardhat_no_vest" | "fire_smoke" | "smoking" | "machine_proximity" | "working_at_height" | "person_fallen" | "safety_hazard",
      "bbox": [y_min, x_min, y_max, x_max],
      "description": "brief note"
    }
  ],
  "alerts": [
    {
      "category": "construction" | "fire" | "security",
      "severity": "low" | "medium" | "high" | "critical",
      "message": "Brief alert description (e.g. Worker visible without hard hat)"
    }
  ]
}

**BOUNDING BOX INSTRUCTIONS:**
- For each person: label "person_ok", "no_hardhat", "no_vest", or "no_hardhat_no_vest".
- For fire/smoke: "fire_smoke". For person smoking: "smoking". For machine too close to person: "machine_proximity". For unsafe height: "working_at_height". For fallen person: "person_fallen". Other: "safety_hazard" with description.
- bbox: [y_min, x_min, y_max, x_max] integers 0–1000. If nothing found, set "detections" to [].`;

/**
 * Get the alert analysis prompt for a specific language
 * @param language - The language code ('en' or 'zh-TW')
 * @returns The complete alert prompt with language instruction
 */
export function getAlertAnalysisPrompt(language: SupportedLanguage = 'en'): string {
  const languageInstruction = LANGUAGE_INSTRUCTIONS[language] || LANGUAGE_INSTRUCTIONS['en'];
  
  if (language === 'zh-TW') {
    return `【重要！請用繁體中文回覆所有內容！】\n\n${BASE_ALERT_PROMPT}\n\n【再次強調：${languageInstruction}】`;
  }
  
  return `${BASE_ALERT_PROMPT}\n\n**IMPORTANT: ${languageInstruction}**`;
}
