import { GoogleGenAI } from '@google/genai';

// Production uses the Cloud Run service identity and Vertex AI so extraction does
// not depend on a separate AI Studio prepaid-credit balance. Local development
// keeps the API-key path for compatibility.
const useVertex = process.env.GEMINI_PROVIDER === 'vertex';
export const ai = new GoogleGenAI(useVertex ? {
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.GOOGLE_CLOUD_LOCATION || 'global',
  httpOptions: { headers: { 'User-Agent': 'moetracker-cloud-run' } },
} : {
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
});
