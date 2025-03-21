const { OpenAI } = require('openai');
const { v4: uuidv4 } = require('uuid');

// We'll initialize the OpenAI client when the socket handlers are set up
let openai;

// Voice mapping for different languages
const voiceMap = {
  'en': 'nova',     // English - female voice
  'es': 'shimmer',  // Spanish
  'fr': 'nova',     // French
  'de': 'shimmer',  // German
  'it': 'alloy',    // Italian
  'pt': 'alloy',    // Portuguese
  'ru': 'echo',     // Russian
  'zh': 'shimmer',  // Chinese
  'ja': 'nova',     // Japanese
  'ko': 'alloy',    // Korean
  'ar': 'echo',     // Arabic
  'hi': 'shimmer'   // Hindi
};

// Language name mapping
const languageNames = {
  'en': 'English',
  'es': 'Spanish',
  'fr': 'French',
  'de': 'German',
  'it': 'Italian',
  'pt': 'Portuguese',
  'ru': 'Russian',
  'zh': 'Chinese',
  'ja': 'Japanese',
  'ko': 'Korean',
  'ar': 'Arabic',
  'hi': 'Hindi'
};

// Process audio chunks and handle WebSocket communication
module.exports = {
  // Setup WebSocket event handlers
  setupSocketHandlers: (io, config = {}) => {
    // Initialize OpenAI with the provided API key
    openai = new OpenAI({
      apiKey: config.openaiApiKey,
    });
    
    console.log('OpenAI API initialized with key:', config.openaiApiKey ? '******' + config.openaiApiKey.slice(-4) : 'missing');
    
    io.on('connection', async (socket) => {
      console.log('Client connected:', socket.id);
      
      // Handle ping for connection testing
      socket.on('ping', (timestamp, callback) => {
        if (callback) callback(Date.now());
      });
      
      // Handle audio chunk for transcription
      socket.on('audioChunk', async (audioBuffer, options, ack) => {
        try {
          console.log(`Received audio chunk from ${socket.id}, size: ${audioBuffer.byteLength} bytes`);
          
          // Extract MIME type from options if provided
          let mimeType = 'audio/webm';
          if (options && options.mimeType) {
            mimeType = options.mimeType;
            console.log(`Client specified MIME type: ${mimeType}`);
          }
          
          // Early validation
          if (!audioBuffer || audioBuffer.byteLength < 1000) {
            console.log('Audio too small or empty, skipping');
            if (typeof ack === 'function') {
              ack({ success: false, error: 'Audio too small or empty' });
            }
            return;
          }
          
          // Send acknowledgment for receipt if provided
          if (typeof ack === 'function') {
            ack({ success: true });
          }
          
          try {
            // Transcribe the audio with the specified format
            const transcription = await transcribeAudio(audioBuffer, mimeType);
            
            // Skip empty transcriptions
            if (!transcription || transcription.trim() === '') {
              console.log('Empty transcription, skipping');
              socket.emit('transcription', { text: '', final: true });
              return;
            }
            
            console.log('Transcription:', transcription);
            
            // Emit the transcription to the client
            socket.emit('transcription', { text: transcription, final: true });
          } catch (transcriptionError) {
            console.error('Error in transcription:', transcriptionError);
            socket.emit('error', { message: 'Error processing audio: ' + transcriptionError.message });
            
            // If we have an acknowledgment function, update it with the error
            // This allows the client retry mechanism to work
            if (typeof ack === 'function') {
              try {
                ack({ success: false, error: transcriptionError.message });
              } catch (ackError) {
                console.error('Error sending failure acknowledgment:', ackError);
              }
            }
          }
        } catch (error) {
          console.error('Error processing audio:', error);
          socket.emit('error', { message: 'Error processing audio: ' + error.message });
          
          // If we have an acknowledgment function, update it with the error
          if (typeof ack === 'function') {
            try {
              ack({ success: false, error: error.message });
            } catch (ackError) {
              console.error('Error sending failure acknowledgment:', ackError);
            }
          }
        }
      });
      
      // Handle language change notification
      socket.on('changeLanguage', (data) => {
        console.log(`Client ${socket.id} changed languages - Source: ${data.sourceLanguage}, Target: ${data.targetLanguage}`);
      });
      
      // Handle translation request
      socket.on('startTranslation', async (data) => {
        try {
          if (!data.text || !data.sourceLanguage || !data.targetLanguage) {
            socket.emit('error', { message: 'Missing translation parameters' });
            return;
          }
          
          console.log(`Translation request: ${data.sourceLanguage} -> ${data.targetLanguage}`);
          console.log(`Source text: ${data.text.substring(0, 50)}${data.text.length > 50 ? '...' : ''}`);
          
          // Translate the text
          const translation = await translateText(data.text, data.sourceLanguage, data.targetLanguage);
          console.log('Translation complete:', translation);
          
          // Emit translation with the expected format
          socket.emit('translationStream', { 
            translation: translation, 
            partial: false 
          });
          
        } catch (error) {
          console.error('Error translating text:', error);
          socket.emit('error', { message: 'Translation error: ' + error.message });
        }
      });
      
      // Handle speech generation request
      socket.on('generateSpeech', async (data, ack) => {
        try {
          // Send acknowledgment if provided to confirm receipt
          if (typeof ack === 'function') {
            ack();
          }
          
          if (!data.text || !data.language) {
            socket.emit('error', { message: 'Missing speech generation parameters' });
            return;
          }
          
          console.log(`Speech generation request for language: ${data.language}`);
          console.log(`Text to speak: ${data.text.substring(0, 50)}${data.text.length > 50 ? '...' : ''}`);
          
          const voice = voiceMap[data.language] || 'alloy';
          
          // Generate speech with OpenAI
          const response = await openai.audio.speech.create({
            model: "tts-1",
            voice: voice,
            input: data.text,
          });
          
          // Get audio as buffer
          const buffer = Buffer.from(await response.arrayBuffer());
          console.log(`Generated speech audio, size: ${buffer.length} bytes`);
          
          // Send metadata to client
          socket.emit('speechData', {
            metadata: {
              language: data.language,
              totalChunks: 1,
              contentType: 'audio/mp3'
            }
          });
          
          // Split buffer into manageable chunks
          const CHUNK_SIZE = 16384; // 16KB chunks
          const totalChunks = Math.ceil(buffer.length / CHUNK_SIZE);
          
          // Send each chunk separately
          for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, buffer.length);
            const chunk = buffer.slice(start, end);
            
            console.log(`Sending speech chunk ${i+1}/${totalChunks}, size: ${chunk.length} bytes`);
            socket.emit('speechData', {
              chunkIndex: i,
              audioChunk: chunk,
              final: i === totalChunks - 1
            });
            
            // Add small delay between chunks to prevent network congestion
            if (i < totalChunks - 1) {
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }
          
          console.log('Speech generation complete, sent in', totalChunks, 'chunks');
        } catch (error) {
          console.error('Error generating speech:', error);
          socket.emit('error', { message: 'Speech generation error: ' + error.message });
        }
      });
      
      // Handle disconnection
      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
      });
    });
  }
};

// Transcribe audio using OpenAI Whisper API
async function transcribeAudio(audioBuffer, mimeType = 'audio/webm') {
  try {
    // Extract proper file extension from MIME type
    let fileExtension = 'webm'; // Default
    if (mimeType.includes('wav')) {
      fileExtension = 'wav';
    } else if (mimeType.includes('mp3') || mimeType.includes('mpeg')) {
      fileExtension = 'mp3';
    } else if (mimeType.includes('ogg')) {
      fileExtension = 'ogg';
    }
    
    // Generate a unique filename with the appropriate extension
    const tempFilename = `audio-${uuidv4()}.${fileExtension}`;
    
    // Log the audio buffer information for debugging
    console.log(`Transcribing audio: ${audioBuffer.byteLength} bytes, format: ${mimeType}, file: ${tempFilename}`);
    
    const fs = require('fs');
    const path = require('path');
    
    // Create a temporary directory if it doesn't exist
    const tempDir = path.join('/tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Write the buffer to a temporary file
    const tempFilePath = path.join(tempDir, tempFilename);
    fs.writeFileSync(tempFilePath, audioBuffer);
    
    console.log(`Saved audio to temp file: ${tempFilePath}`);
    
    try {
      // Call the OpenAI API to transcribe the audio using a file path
      const response = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: "whisper-1",
        response_format: "text"
      });
      
      // Clean up the temporary file
      try {
        fs.unlinkSync(tempFilePath);
        console.log(`Deleted temporary file: ${tempFilePath}`);
      } catch (cleanupError) {
        console.error('Error deleting temporary file:', cleanupError);
      }
      
      console.log(`Transcription successful: "${response.substring(0, 50)}${response.length > 50 ? '...' : ''}"`);
      return response;
    } catch (apiError) {
      // Log detailed API error information
      console.error('OpenAI API error details:', apiError);
      
      // Clean up the temporary file even on error
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.error('Error deleting temporary file after API error:', cleanupError);
      }
      
      throw apiError;
    }
  } catch (error) {
    console.error('OpenAI Whisper API error:', error);
    throw new Error(`Transcription failed: ${error.message}`);
  }
}

// Translate text using OpenAI
async function translateText(text, sourceLanguage, targetLanguage) {
  try {
    const sourceLang = languageNames[sourceLanguage] || sourceLanguage;
    const targetLang = languageNames[targetLanguage] || targetLanguage;
    
    // Use ChatGPT for translation
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a translator from ${sourceLang} to ${targetLang}. Translate the following text, maintaining the tone and meaning. Only return the translation with no additional text or explanations.`
        },
        {
          role: "user",
          content: text
        }
      ],
      temperature: 0.3, // Lower temperature for more consistent translations
      max_tokens: 1024,
    });
    
    // Extract the translated text from the response
    const translation = response.choices[0].message.content.trim();
    return translation;
  } catch (error) {
    console.error('OpenAI translation error:', error);
    throw new Error(`Translation failed: ${error.message}`);
  }
}

 