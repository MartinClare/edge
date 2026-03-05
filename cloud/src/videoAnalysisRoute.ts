/**
 * Video Analysis API Route
 * 
 * POST /api/analyze-video
 * Processes video with continuous YOLO detection and interval-based Gemini verification
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import FormData from 'form-data';
import axios from 'axios';
import { 
  OPENROUTER_API_KEY, 
  OPENROUTER_API_URL, 
  MODEL_NAME, 
  getSafetyAnalysisPrompt,
  type SupportedLanguage
} from './openRouterClient.js';
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from './constants.js';
import type { SafetyAnalysisResult } from './types.js';

const router = Router();

// Allow larger files for videos (50MB)
const VIDEO_MAX_SIZE = 50 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VIDEO_MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    const videoMimeTypes = ['video/mp4', 'video/avi', 'video/mov', 'video/quicktime', 'video/x-msvideo'];
    if (!videoMimeTypes.includes(file.mimetype)) {
      cb(new Error('Invalid file type. Please upload MP4, AVI, or MOV video files.'));
      return;
    }
    cb(null, true);
  },
});

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
 * POST /api/analyze-video
 * 
 * Process video with YOLO detection on all frames and Gemini verification on interval frames
 */
router.post('/analyze-video', (req: Request, res: Response) => {
  upload.single('video')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: `Video is too large. Maximum size is 50 MB.`,
        });
      }
      return res.status(400).json({
        success: false,
        error: err.message || 'Failed to process uploaded file.',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No video file provided.',
      });
    }

    const { buffer, mimetype, originalname } = req.file;
    const language = (req.body?.language as SupportedLanguage) || 'en';
    const sampleEvery = parseInt(req.body?.sampleEvery) || 5; // Frame sampling for YOLO
    const geminiInterval = parseInt(req.body?.geminiInterval) || 10; // Seconds between Gemini checks

    try {
      console.log('🎥 Step 1: Processing video with YOLOv8...');
      
      // Step 1: Send video to YOLO backend for frame-by-frame detection
      // Use form-data package with axios for proper multipart/form-data handling
      const formData = new FormData();
      formData.append('file', buffer, {
        filename: originalname,
        contentType: mimetype,
      });
      formData.append('sample_every', sampleEvery.toString());

      console.log(`📤 Sending video to YOLO API: ${YOLO_API_URL}/detect/video-frames`);
      console.log(`   Video size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   Filename: ${originalname}`);
      
      let yoloResult;
      try {
        // Use axios which handles form-data streams better than fetch
        const yoloResponse = await axios.post(
          `${YOLO_API_URL}/detect/video-frames`,
          formData,
          {
            headers: {
              ...formData.getHeaders(),
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 300000, // 5 minutes timeout
          }
        );
        
        yoloResult = yoloResponse.data;
      } catch (axiosError) {
        console.error('❌ Failed to connect to YOLO API:', axiosError);
        if (axios.isAxiosError(axiosError)) {
          if (axiosError.code === 'ECONNREFUSED' || axiosError.message.includes('Network Error')) {
            throw new Error(`Cannot connect to YOLO API at ${YOLO_API_URL}. Please ensure the Python backend is running on port 8000.`);
          }
          if (axiosError.response) {
            const errorText = axiosError.response.data?.detail || JSON.stringify(axiosError.response.data);
            console.error('❌ YOLO API error response:', errorText);
            throw new Error(`YOLO API error: ${axiosError.response.status} - ${errorText}`);
          }
          throw new Error(`Network error: ${axiosError.message}`);
        }
        throw axiosError;
      }
      console.log(`✅ YOLO processed ${yoloResult.total_frames_sampled} frames`);

      // Step 2: Calculate which frames should be analyzed based on interval
      const fps = yoloResult.video_fps || 30;
      const frameInterval = Math.round(geminiInterval * fps / sampleEvery);
      
      // Calculate which frames should be analyzed based on interval
      const framesToAnalyze = yoloResult.frames.filter((_: any, index: number) => {
        return index % frameInterval === 0 || index === yoloResult.frames.length - 1;
      });

      console.log(`🤖 Step 2: Analyzing ${framesToAnalyze.length} frames with Gemini in parallel (every ${geminiInterval}s)...`);

      // Step 3: Analyze ALL required frames with Gemini in parallel
      const geminiPromises = framesToAnalyze.map(async (frame: any, index: number) => {
        try {
          console.log(`   Analyzing frame ${frame.frame_index} (${index + 1}/${framesToAnalyze.length})...`);
          const analysis = await analyzeFrameWithGemini(
            frame.frame_data,
            language,
            frame.frame_index,
            frame.timestamp_sec || 0,
            frame.detections
          );
          return {
            frame_number: frame.frame_index,
            timestamp: frame.timestamp_sec || 0,
            analysis,
          };
        } catch (error) {
          console.error(`   Failed to analyze frame ${frame.frame_index}:`, error);
          return {
            frame_number: frame.frame_index,
            timestamp: frame.timestamp_sec || 0,
            analysis: null,
            error: error instanceof Error ? error.message : 'Analysis failed',
          };
        }
      });

      // Wait for all Gemini analyses to complete
      const geminiAnalyses = await Promise.all(geminiPromises);
      console.log(`✅ All Gemini analyses complete: ${geminiAnalyses.length} frames analyzed`);

      // Calculate stats
      const allDetections = yoloResult.frames.flatMap((f: any) => f.detections);
      const initialStats = {
        totalFrames: yoloResult.total_frames,
        sampledFrames: yoloResult.total_frames_sampled,
        analyzedFrames: geminiAnalyses.length,
        duration: (yoloResult.total_frames / (yoloResult.video_fps || 30)),
        fps: yoloResult.video_fps,
        totalDetections: allDetections.length,
        uniqueClasses: Array.from(new Set(allDetections.map((d: any) => d.class_name))),
        violations: allDetections.filter((d: any) => d.class_name.includes('NO-')).length,
      };

      // Return YOLO results with all Gemini analyses (all done upfront)
      res.json({
        success: true,
        data: {
          filename: originalname,
          stats: initialStats,
          yoloFrames: yoloResult.frames,
          geminiAnalyses: geminiAnalyses,
        },
      });
    } catch (error) {
      console.error('❌ Video analysis error:', error);
      
      let errorMessage = 'Video analysis failed';
      if (error instanceof Error) {
        errorMessage = error.message;
        // Provide more helpful error messages
        if (error.message.includes('ECONNREFUSED') || error.message.includes('Failed to connect')) {
          errorMessage = 'Cannot connect to YOLO API. Please ensure the Python backend is running on port 8000.';
        } else if (error.message.includes('YOLO API error')) {
          errorMessage = `YOLO API error: ${error.message}`;
        }
      }
      
      return res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });
});

export default router;
