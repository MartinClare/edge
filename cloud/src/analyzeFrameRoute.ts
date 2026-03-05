/**
 * Single Frame Analysis API Route
 * 
 * POST /api/analyze-frame
 * Analyzes a single frame with Gemini based on user settings
 */

import { Router, Request, Response } from 'express';
import { 
  OPENROUTER_API_KEY, 
  OPENROUTER_API_URL, 
  MODEL_NAME, 
  getSafetyAnalysisPrompt,
  type SupportedLanguage
} from './openRouterClient.js';
import type { SafetyAnalysisResult } from './types.js';

const router = Router();

/**
 * Parse Gemini response
 */
function parseGeminiResponse(responseText: string): SafetyAnalysisResult {
  let cleanedText = responseText.trim();
  if (cleanedText.startsWith('```json')) {
    cleanedText = cleanedText.slice(7);
  } else if (cleanedText.startsWith('```')) {
    cleanedText = cleanedText.slice(3);
  }
  if (cleanedText.endsWith('```')) {
    cleanedText = cleanedText.slice(0, -3);
  }
  cleanedText = cleanedText.trim();

  try {
    const parsed = JSON.parse(cleanedText) as SafetyAnalysisResult;
    if (!parsed.overallDescription || !parsed.overallRiskLevel) {
      throw new Error('Invalid response structure');
    }
    const categories = ['constructionSafety', 'fireSafety', 'propertySecurity'] as const;
    for (const category of categories) {
      if (!parsed[category]) {
        parsed[category] = {
          summary: 'Analysis not available for this category.',
          issues: [],
          recommendations: [],
        };
      }
      parsed[category].issues = parsed[category].issues || [];
      parsed[category].recommendations = parsed[category].recommendations || [];
    }
    return parsed;
  } catch (error) {
    console.error('Failed to parse Gemini response:', error);
    throw new Error('Failed to parse AI analysis response');
  }
}

/**
 * Analyze a frame with Gemini
 */
async function analyzeFrameWithGemini(
  frameBase64: string,
  language: SupportedLanguage,
  frameNumber: number,
  timestamp: number,
  yoloDetections: any[]
): Promise<SafetyAnalysisResult> {
  const analysisPrompt = getSafetyAnalysisPrompt(language);
  
  // Add YOLO context to prompt
  const detectionSummary = yoloDetections.map((d: any) => d.class_name).join(', ');
  const enhancedPrompt = `${analysisPrompt}\n\n**Frame Context:**\n- Frame: ${frameNumber}\n- Time: ${timestamp.toFixed(2)}s\n- YOLO Detected: ${detectionSummary}\n\nProvide safety analysis for this specific moment.`;
  
  const imageDataUrl = `data:image/jpeg;base64,${frameBase64}`;
  
  const openRouterResponse = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3001',
      'X-Title': 'Axon Vision Frame Analysis',
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: enhancedPrompt },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  if (!openRouterResponse.ok) {
    const contentType = openRouterResponse.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      const errorData = await openRouterResponse.json() as { error?: { message?: string } };
      throw new Error(errorData.error?.message || `API error: ${openRouterResponse.status}`);
    }
    throw new Error(`API error: ${openRouterResponse.status}`);
  }

  const result = await openRouterResponse.json() as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };
  const responseText = result.choices?.[0]?.message?.content;
  
  if (!responseText) {
    throw new Error('Empty response from AI model');
  }

  return parseGeminiResponse(responseText);
}

/**
 * POST /api/analyze-frame
 * 
 * Analyze a single frame with Gemini
 */
router.post('/analyze-frame', async (req: Request, res: Response) => {
  try {
    const { frameData, frameNumber, timestamp, yoloDetections, language } = req.body;

    if (!frameData) {
      return res.status(400).json({
        success: false,
        error: 'Frame data is required',
      });
    }

    if (frameNumber === undefined || timestamp === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Frame number and timestamp are required',
      });
    }

    const lang = (language as SupportedLanguage) || 'en';
    const detections = yoloDetections || [];

    console.log(`🤖 Analyzing frame ${frameNumber} at ${timestamp.toFixed(2)}s...`);

    const analysis = await analyzeFrameWithGemini(
      frameData,
      lang,
      frameNumber,
      timestamp,
      detections
    );

    return res.json({
      success: true,
      data: {
        frame_number: frameNumber,
        timestamp: timestamp,
        analysis,
      },
    });
  } catch (error) {
    console.error('❌ Frame analysis error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Frame analysis failed';
    return res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

export default router;
