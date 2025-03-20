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

    // Create a streaming response for client processing
    const stream = await openai.chat.completions.create({
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
      stream: true, // Enable streaming response
    });

    // Convert stream to Response object for Next.js streaming
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        let translatedText = '';
        
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              translatedText += content;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ translatedText, partial: true })}\n\n`));
            }
          }

          // Send the final complete translation
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ translatedText, partial: false })}\n\n`));
          controller.close();
        } catch (error) {
          console.error('Error in stream processing:', error);
          controller.error(error);
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      },
    });
    
  } catch (error) {
    console.error('Translation API error:', error);
    return NextResponse.json(
      { error: 'Error translating text' },
      { status: 500 }
    );
  }
} 