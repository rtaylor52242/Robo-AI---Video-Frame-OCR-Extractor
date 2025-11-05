
import { GoogleGenAI } from "@google/genai";
import type { Frame } from '../types';

const dataUrlToPart = (dataUrl: string) => {
  const base64Data = dataUrl.split(',')[1];
  const mimeTypeMatch = dataUrl.match(/^data:(.*);base64,/);
  if (!mimeTypeMatch) {
    throw new Error("Invalid data URL format");
  }
  const mimeType = mimeTypeMatch[1];
  return {
    inlineData: {
      data: base64Data,
      mimeType,
    },
  };
};

export const analyzeFramesForText = async (frames: Frame[], onProgress: (message: string) => void): Promise<string[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const allWords: string[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    onProgress(`Analyzing frame ${i + 1} of ${frames.length} with Gemini...`);
    try {
      const imagePart = dataUrlToPart(frame.imageDataUrl);
      const textPart = { text: "Perform OCR on this image. Extract all visible text. Return only the extracted text, with individual words separated by single spaces. If no text is found, return an empty response." };
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: { parts: [imagePart, textPart] },
      });

      const text = response.text;
      if (text) {
        allWords.push(text);
      }
    } catch (error) {
      console.error(`Error analyzing frame ${frame.id}:`, error);
      onProgress(`Skipping frame ${i + 1} due to an error.`);
    }
  }

  return allWords;
};
