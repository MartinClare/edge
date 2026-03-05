/**
 * Video Folder API Route
 * 
 * GET /api/videos/list - List available videos from folder
 * POST /api/analyze-video-file - Analyze video from file path (no upload needed)
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { 
  OPENROUTER_API_KEY, 
  OPENROUTER_API_URL, 
  MODEL_NAME, 
  getSafetyAnalysisPrompt,
  type SupportedLanguage
} from './openRouterClient.js';
import type { SafetyAnalysisResult } from './types.js';

const router = Router();
const YOLO_API_URL = process.env.YOLO_API_URL || 'http://localhost:8000';

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
  
  const detectionSummary = yoloDetections.map((d: any) => d.class_name).join(', ');
  const enhancedPrompt = `${analysisPrompt}\n\n**Frame Context:**\n- Frame: ${frameNumber}\n- Time: ${timestamp.toFixed(2)}s\n- YOLO Detected: ${detectionSummary}\n\nProvide safety analysis for this specific moment.`;
  
  const imageDataUrl = `data:image/jpeg;base64,${frameBase64}`;
  
  const openRouterResponse = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3001',
      'X-Title': 'Axon Vision Video Analysis',
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
 * Send SSE event to client
 */
function sendSSE(res: Response, event: string, data: any) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * GET /api/videos/list
 * List available videos from the Python backend's video folder
 */
router.get('/videos/list', async (_req: Request, res: Response) => {
  try {
    const response = await axios.get(`${YOLO_API_URL}/videos/list`);
    res.json(response.data);
  } catch (error) {
    console.error('❌ Failed to list videos:', error);
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        return res.status(503).json({
          success: false,
          error: `Cannot connect to YOLO API at ${YOLO_API_URL}. Please ensure the Python backend is running on port 8000.`
        });
      }
      if (error.response) {
        return res.status(error.response.status).json({
          success: false,
          error: error.response.data?.detail || 'Failed to list videos'
        });
      }
    }
    res.status(500).json({
      success: false,
      error: 'Failed to list videos'
    });
  }
});

/**
 * POST /api/analyze-video-file-stream
 * Analyze video from file path (no upload needed) with streaming results
 */
router.post('/analyze-video-file-stream', (req: Request, res: Response) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

  const { filePath, sampleEvery, geminiInterval, language } = req.body;
  
  if (!filePath) {
    sendSSE(res, 'error', { error: 'No file path provided' });
    return res.end();
  }

  const sampleEveryNum = parseInt(sampleEvery) || 5;
  const geminiIntervalNum = parseInt(geminiInterval) || 10;
  const lang = (language as SupportedLanguage) || 'en';

  (async () => {
    try {
      sendSSE(res, 'status', { message: 'Processing video from file...', progress: 10 });

      // Call Python backend with file path (no upload!)
      const formData = new FormData();
      formData.append('file_path', filePath);
      formData.append('sample_every', sampleEveryNum.toString());

      console.log(`📤 Processing video file: ${filePath}`);
      
      let yoloResult;
      try {
        const yoloResponse = await axios.post(
          `${YOLO_API_URL}/detect/video-file`,
          formData,
          {
            headers: {
              ...formData.getHeaders(),
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 300000,
            onUploadProgress: (progressEvent) => {
              if (progressEvent.total) {
                const progress = 10 + Math.round((progressEvent.loaded / progressEvent.total) * 50);
                sendSSE(res, 'progress', { 
                  message: 'Processing with YOLO...', 
                  progress 
                });
              }
            },
          }
        );
        
        yoloResult = yoloResponse.data;
      } catch (axiosError) {
        console.error('❌ Failed to process video file:', axiosError);
        if (axios.isAxiosError(axiosError)) {
          if (axiosError.code === 'ECONNREFUSED') {
            sendSSE(res, 'error', { 
              error: `Cannot connect to YOLO API at ${YOLO_API_URL}. Please ensure the Python backend is running on port 8000.` 
            });
            return res.end();
          }
          if (axiosError.response) {
            const errorText = axiosError.response.data?.detail || JSON.stringify(axiosError.response.data);
            sendSSE(res, 'error', { error: `YOLO API error: ${axiosError.response.status} - ${errorText}` });
            return res.end();
          }
          sendSSE(res, 'error', { error: `Network error: ${axiosError.message}` });
          return res.end();
        }
        sendSSE(res, 'error', { error: 'Unknown error occurred' });
        return res.end();
      }

      sendSSE(res, 'status', { 
        message: `YOLO processed ${yoloResult.total_frames_sampled} frames`, 
        progress: 60 
      });

      // Send YOLO frames
      sendSSE(res, 'yolo-frames', {
        frames: yoloResult.frames,
        stats: {
          totalFrames: yoloResult.total_frames,
          sampledFrames: yoloResult.total_frames_sampled,
          fps: yoloResult.video_fps,
          duration: (yoloResult.total_frames / (yoloResult.video_fps || 30)),
        },
      });

      // Calculate which frames should be analyzed with Gemini
      const fps = yoloResult.video_fps || 30;
      const frameInterval = Math.round(geminiIntervalNum * fps / sampleEveryNum);
      
      const framesToAnalyze = yoloResult.frames.filter((_: any, index: number) => {
        return index % frameInterval === 0 || index === yoloResult.frames.length - 1;
      });

      sendSSE(res, 'status', { 
        message: `Analyzing ${framesToAnalyze.length} frames with Deep Vision...`, 
        progress: 70 
      });

      // Analyze frames with Gemini in parallel
      let completedCount = 0;
      const geminiPromises = framesToAnalyze.map(async (frame: any, index: number) => {
        try {
          const analysis = await analyzeFrameWithGemini(
            frame.frame_data,
            lang,
            frame.frame_index,
            frame.timestamp_sec || 0,
            frame.detections
          );
          
          completedCount++;
          const progress = 70 + Math.round((completedCount / framesToAnalyze.length) * 25);
          
          sendSSE(res, 'gemini-analysis', {
            frame_number: frame.frame_index,
            timestamp: frame.timestamp_sec || 0,
            analysis,
          });
          
          sendSSE(res, 'progress', { 
            message: `Deep Vision analysis: ${completedCount}/${framesToAnalyze.length}`, 
            progress 
          });
          
          return {
            frame_number: frame.frame_index,
            timestamp: frame.timestamp_sec || 0,
            analysis,
          };
        } catch (error) {
          console.error(`   Failed to analyze frame ${frame.frame_index}:`, error);
          completedCount++;
          return {
            frame_number: frame.frame_index,
            timestamp: frame.timestamp_sec || 0,
            analysis: null,
            error: error instanceof Error ? error.message : 'Analysis failed',
          };
        }
      });

      const geminiAnalyses = await Promise.all(geminiPromises);

      // Calculate final stats
      const allDetections = yoloResult.frames.flatMap((f: any) => f.detections);
      const finalStats = {
        totalFrames: yoloResult.total_frames,
        sampledFrames: yoloResult.total_frames_sampled,
        analyzedFrames: geminiAnalyses.length,
        duration: (yoloResult.total_frames / (yoloResult.video_fps || 30)),
        fps: yoloResult.video_fps,
        totalDetections: allDetections.length,
        uniqueClasses: Array.from(new Set(allDetections.map((d: any) => d.class_name))),
        violations: allDetections.filter((d: any) => d.class_name.includes('NO-')).length,
      };

      // Send final complete result
      sendSSE(res, 'complete', {
        filename: filePath.split(/[/\\]/).pop() || filePath,
        stats: finalStats,
        yoloFrames: yoloResult.frames,
        geminiAnalyses: geminiAnalyses,
      });

      res.end();
    } catch (error) {
      console.error('❌ Video file analysis error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Video analysis failed';
      sendSSE(res, 'error', { error: errorMessage });
      res.end();
    }
  })();
});

export default router;
