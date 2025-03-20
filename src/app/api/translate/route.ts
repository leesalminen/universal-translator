import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { text, sourceLanguage, targetLanguage } = await request.json();
    
    if (!text) {
      return NextResponse.json(
        { error: 'Text to translate is required' },
        { status: 400 }
      );
    }
    
    if (!targetLanguage) {
      return NextResponse.json(
        { error: 'Target language is required' },
        { status: 400 }
      );
    }

    // Get the language names for better prompting
    const getLanguageName = (code: string): string => {
      const languages: Record<string, string> = {
        'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
        'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian', 'zh': 'Chinese',
        'ja': 'Japanese', 'ko': 'Korean', 'ar': 'Arabic', 'hi': 'Hindi'
      };
      return languages[code] || code;
    };

    const sourceLangName = getLanguageName(sourceLanguage);
    const targetLangName = getLanguageName(targetLanguage);

    // Call the OpenAI Chat API for translation
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `You are a professional translator. Translate the text from ${sourceLangName} to ${targetLangName}. 
                    Provide only the translated text with no additional explanation or notes.`
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.3,
      max_tokens: 1024,
    });

    // Extract the translated text from the response
    const translatedText = response.choices[0]?.message?.content || '';

    return NextResponse.json({
      translatedText,
      sourceLanguage,
      targetLanguage
    });
    
  } catch (error) {
    console.error('Translation API error:', error);
    return NextResponse.json(
      { error: 'Error translating text' },
      { status: 500 }
    );
  }
} 