import { GoogleGenAI } from '@google/genai';

let client: GoogleGenAI | null = null;

// Paid AI is optional and must never initialize in the free Cloudflare runtime.
export function getAi() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error('Gemini is not configured. Use the free local screenshot extractor.');
    client = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
  }
  return client;
}

export const ai = {
  models: {
    generateContent: (...args: Parameters<GoogleGenAI['models']['generateContent']>) => getAi().models.generateContent(...args),
  },
};
