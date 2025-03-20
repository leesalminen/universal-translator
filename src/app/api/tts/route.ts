import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { text, language } = await request.json();
    
    if (!text) {
      return NextResponse.json(
        { error: 'Text for speech synthesis is required' },
        { status: 400 }
      );
    }

    // Select appropriate voice based on language
    let voice = 'alloy';  // Default
    
    // Map language codes to appropriate voices
    // You can customize this mapping based on preference
    const voiceMap: Record<string, string> = {
      'en': 'nova',      // English - female voice
      'es': 'shimmer',   // Spanish
      'fr': 'nova',      // French
      'de': 'shimmer',   // German
      'it': 'alloy',     // Italian
      'pt': 'alloy',     // Portuguese
      'ru': 'echo',      // Russian
      'zh': 'shimmer',   // Chinese
      'ja': 'nova',      // Japanese
      'ko': 'alloy',     // Korean
      'ar': 'echo',      // Arabic
      'hi': 'shimmer'    // Hindi
    };
    
    // Use the mapped voice if available
    if (language && voiceMap[language]) {
      voice = voiceMap[language];
    }

    // Call the OpenAI TTS API
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
      input: text,
    });

    // Convert to array buffer
    const buffer = Buffer.from(await mp3.arrayBuffer());

    // Return the audio as a stream
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('TTS API error:', error);
    return NextResponse.json(
      { error: 'Error generating speech' },
      { status: 500 }
    );
  }
} 