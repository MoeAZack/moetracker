import { GoogleGenAI } from '@google/genai';

// Server-side Gemini client. Uses GEMINI_API_KEY (sourced from Secret Manager in prod).
export const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});
