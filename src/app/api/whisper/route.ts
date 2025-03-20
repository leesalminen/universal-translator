import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('file') as File;
    
    if (!audioFile) {
      return NextResponse.json(
        { error: 'Audio file is required' },
        { status: 400 }
      );
    }

    // Debug information
    console.log('Received audio file:');
    console.log('- Name:', audioFile.name);
    console.log('- Size:', audioFile.size, 'bytes');
    console.log('- Type:', audioFile.type);
    
    // Skip processing if file is too small (likely noise or silence)
    if (audioFile.size < 1000) {
      console.log('Audio file too small, skipping processing');
      return NextResponse.json({
        text: '',
        language: formData.get('language') as string || 'auto-detected',
      });
    }

    try {
      // Explicitly log that we're sending to Whisper API
      console.log('Sending audio to Whisper API...');
      
      // Use OpenAI's official client which handles file uploads properly
      const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: formData.get('language') as string || undefined,
      });

      console.log('Whisper API response success:', transcription.text);
      
      return NextResponse.json({
        text: transcription.text,
        language: formData.get('language') as string || 'auto-detected',
      });
    } catch (apiError: any) {
      // Log the full error for debugging
      console.error('Whisper API error details:', apiError);
      if (apiError.response?.data) {
        console.error('Whisper API response data:', JSON.stringify(apiError.response.data));
      }
      if (apiError.message) {
        console.error('Whisper API error message:', apiError.message);
      }
      
      return NextResponse.json(
        { error: 'Error processing audio' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Whisper API error:', error);
    return NextResponse.json(
      { error: 'Error processing audio' },
      { status: 500 }
    );
  }
}

// Set the appropriate content length limit for audio files
export const config = {
  api: {
    bodyParser: false,
    responseLimit: '10mb',
  },
}; 