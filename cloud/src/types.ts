/**
 * Type definitions for the safety analysis API
 */

/**
 * Risk level enumeration
 */
export type RiskLevel = 'Low' | 'Medium' | 'High';

/**
 * Safety category analysis result
 */
export interface SafetyCategory {
  summary: string;
  issues: string[];
  recommendations: string[];
}

/**
 * Complete safety analysis response from Gemini
 */
export interface SafetyAnalysisResult {
  overallDescription: string;
  overallRiskLevel: RiskLevel;
  constructionSafety: SafetyCategory;
  fireSafety: SafetyCategory;
  propertySecurity: SafetyCategory;
  peopleCount?: number;
  missingHardhats?: number;
  missingVests?: number;
}

/**
 * API success response
 */
export interface AnalysisSuccessResponse {
  success: true;
  data: SafetyAnalysisResult;
}

/**
 * API error response
 */
export interface AnalysisErrorResponse {
  success: false;
  error: string;
}

/**
 * Combined API response type
 */
export type AnalysisResponse = AnalysisSuccessResponse | AnalysisErrorResponse;

/**
 * Alert item for streamlined safety alerts
 */
export interface SafetyAlert {
  category: 'construction' | 'fire' | 'security';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
}

/**
 * Streamlined alert-only analysis result
 */
export interface AlertAnalysisResult {
  overallRiskLevel: RiskLevel;
  alertCount: number;
  alerts: SafetyAlert[];
  peopleCount?: number;
  missingHardhats?: number;
  missingVests?: number;
}

/**
 * API success response for alerts
 */
export interface AlertSuccessResponse {
  success: true;
  data: AlertAnalysisResult;
}

/**
 * API error response for alerts
 */
export interface AlertErrorResponse {
  success: false;
  error: string;
}

/**
 * Combined API response type for alerts
 */
export type AlertResponse = AlertSuccessResponse | AlertErrorResponse;
