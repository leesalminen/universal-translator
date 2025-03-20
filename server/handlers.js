const fetch = require('node-fetch');
const FormData = require('form-data');
const { OpenAI } = require('openai');

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
      
      // Store client state
      const clientState = {
        audioBuffer: null,
        sourceLanguage: 'en',
        targetLanguage: 'es',
        isProcessing: false,
      };
      
      // Handle partial audio chunks for incremental processing
      socket.on('partialAudioChunk', async (audioBuffer) => {
        // Only process if we have valid audio and aren't already processing
        if (!audioBuffer || audioBuffer.byteLength < 500) return;
        
        try {
          // Process the partial audio for incremental transcription
          await processPartialAudio(socket, audioBuffer, clientState.sourceLanguage);
        } catch (error) {
          console.error('Error processing partial audio chunk:', error);
          // Don't notify the client about errors for partial chunks
        }
      });

      // Handle complete audio file
      socket.on('audioChunk', async (audioBuffer, ack) => {
        try {
          // More detailed debug info about the received data
          console.log(`[${socket.id}] Received audio chunk, type:`, typeof audioBuffer);
          
          if (audioBuffer instanceof ArrayBuffer) {
            console.log(`[${socket.id}] Received ArrayBuffer, size: ${audioBuffer.byteLength} bytes`);
          } else if (audioBuffer instanceof Buffer) {
            console.log(`[${socket.id}] Received Buffer, size: ${audioBuffer.length} bytes`);
          } else if (audioBuffer instanceof Uint8Array) {
            console.log(`[${socket.id}] Received Uint8Array, size: ${audioBuffer.length} bytes`);
          } else {
            console.log(`[${socket.id}] Received unknown data type:`, audioBuffer);
          }
          
          // Send acknowledgment if provided
          if (typeof ack === 'function') {
            console.log(`[${socket.id}] Sending acknowledgment to client`);
            ack();
          } else {
            console.log(`[${socket.id}] No acknowledgment function provided`);
          }
          
          if (!audioBuffer || !audioBuffer.byteLength || audioBuffer.byteLength < 1000) {
            console.log(`[${socket.id}] Audio too small or invalid, skipping`);
            socket.emit('error', { message: 'Audio too small or empty' });
            return;
          }
          
          if (clientState.isProcessing) {
            console.log('Still processing previous audio, skipping');
            socket.emit('error', { message: 'Still processing previous audio' });
            return;
          }
          
          clientState.isProcessing = true;
          
          // Transcribe the audio using Whisper API
          let transcription;
          try {
            transcription = await transcribeAudio(audioBuffer, clientState.sourceLanguage);
            
            // Skip empty transcriptions
            if (!transcription || transcription.trim() === '') {
              console.log('Empty transcription, skipping');
              socket.emit('transcription', { text: '', final: true });
              clientState.isProcessing = false;
              return;
            }
            
            console.log('Transcription:', transcription);
            
            // Emit the transcription to the client
            socket.emit('transcription', { text: transcription, final: true });
            
            // Translate the transcription
            const translation = await translateText(
              transcription, 
              clientState.sourceLanguage, 
              clientState.targetLanguage,
              socket
            );
            
            console.log('Translation:', translation);
            
            // Skip emitting regular translation event when using streaming 
            // The translationStream event with partial:false will handle it instead
            
          } catch (error) {
            console.error('Error processing audio:', error);
            socket.emit('error', { message: 'Error processing audio: ' + error.message });
          } finally {
            clientState.isProcessing = false;
          }
        } catch (error) {
          console.error('Error in audioChunk handler:', error);
          clientState.isProcessing = false;
          socket.emit('error', { message: 'Server error processing audio chunk: ' + error.message });
        }
      });

      // Handle end of audio stream - process the complete audio file
      socket.on('endAudioStream', async () => {
        try {
          // Only process if we have an audio buffer and we're not already processing
          if (clientState.audioBuffer && !clientState.isProcessing) {
            clientState.isProcessing = true;
            
            await processAudioFile(socket, clientState);
            
            // Clear the audio buffer
            clientState.audioBuffer = null;
            clientState.isProcessing = false;
          }
        } catch (error) {
          console.error('Error handling end of audio stream:', error);
          clientState.isProcessing = false;
        }
      });

      // Handle initiation of translation without waiting for full audio processing
      socket.on('startTranslation', async (data) => {
        try {
          if (!data.text || data.text.trim() === '') return;
          
          console.log(`[${socket.id}] Starting early translation for: "${data.text.substring(0, 30)}..."`);
          
          // Begin translation process immediately
          const translation = await translateText(
            data.text,
            data.sourceLanguage || clientState.sourceLanguage,
            data.targetLanguage || clientState.targetLanguage,
            socket
          );
          
          // Don't emit any event here - the streaming events from translateText 
          // will handle sending the translated text to the client
        } catch (error) {
          console.error('Error in startTranslation handler:', error);
        }
      });
      
      // Handle language changes
      socket.on('changeLanguage', (data) => {
        clientState.sourceLanguage = data.sourceLanguage || 'en';
        clientState.targetLanguage = data.targetLanguage || 'es';
        console.log(`Client ${socket.id} changed languages: ${clientState.sourceLanguage} -> ${clientState.targetLanguage}`);
      });

      // Handle ping for connection testing
      socket.on('ping', (clientTime, callback) => {
        console.log(`Received ping from client ${socket.id}`);
        if (typeof callback === 'function') {
          callback(Date.now());
        }
      });

      // Handle text-to-speech requests
      socket.on('generateSpeech', async (data) => {
        try {
          if (!data.text) {
            socket.emit('error', { message: 'Text for speech synthesis is required' });
            return;
          }
          
          console.log(`Generating speech for: "${data.text.substring(0, 30)}..."`);
          
          // Select voice based on language or use default
          const voice = (data.language && voiceMap[data.language]) ? 
                        voiceMap[data.language] : 'alloy';
          
          // Call OpenAI TTS API
          const mp3 = await openai.audio.speech.create({
            model: 'tts-1',
            voice: voice, // alloy, echo, fable, onyx, nova, or shimmer
            input: data.text,
          });
          
          // Convert to buffer
          const buffer = Buffer.from(await mp3.arrayBuffer());
          
          // Send speech back to client
          // We'll split this into chunks to allow for streaming playback
          const CHUNK_SIZE = 16384; // 16KB chunks
          const totalChunks = Math.ceil(buffer.length / CHUNK_SIZE);
          
          console.log(`Streaming speech to client in ${totalChunks} chunks`);
          
          // First send metadata about the audio
          socket.emit('speechStart', { 
            contentLength: buffer.length,
            contentType: 'audio/mpeg',
            language: data.language,
            chunkSize: CHUNK_SIZE,
            totalChunks: totalChunks
          });
          
          // Track if we're sending the last chunk
          let lastChunkSent = false;
          
          // Stream chunks to client
          for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
            const chunk = buffer.slice(i, Math.min(i + CHUNK_SIZE, buffer.length));
            const isLastChunk = i + CHUNK_SIZE >= buffer.length;
            
            if (isLastChunk) {
              lastChunkSent = true;
            }
            
            // Send as a chunk with position info
            socket.emit('speechChunk', {
              chunk: chunk,
              chunkIndex: Math.floor(i / CHUNK_SIZE),
              isLastChunk: isLastChunk
            });
            
            // Small delay to avoid overwhelming the socket
            if (!isLastChunk) {
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }
          
          // Only send speechComplete if we didn't send a chunk with isLastChunk flag
          // This prevents duplicate finalization on the client
          if (!lastChunkSent) {
            // Notify client that speech is complete
            // Short delay to avoid race conditions 
            await new Promise(resolve => setTimeout(resolve, 50));
            socket.emit('speechComplete');
          }
          
          console.log(`Speech generated successfully, sent ${Math.ceil(buffer.length / CHUNK_SIZE)} chunks`);
        } catch (error) {
          console.error('Error generating speech:', error);
          socket.emit('error', { 
            message: 'Error generating speech',
            details: error.message 
          });
        }
      });
      
      // Direct speech-to-text via WebSocket without API route
      socket.on('transcribeAudio', async (audioBuffer) => {
        try {
          if (!audioBuffer || audioBuffer.byteLength < 500) {
            socket.emit('error', { message: 'Invalid or too small audio data' });
            return;
          }
          
          console.log(`Direct transcription request received, size: ${audioBuffer.byteLength} bytes`);
          
          // Perform direct transcription with OpenAI Whisper
          const transcription = await transcribeAudioWithOpenAI(
            audioBuffer, 
            clientState.sourceLanguage
          );
          
          socket.emit('transcription', {
            text: transcription || '',
            final: true
          });
          
          // If we have a transcription, automatically start translation
          if (transcription && transcription.trim()) {
            const translation = await translateTextWithOpenAI(
              transcription,
              clientState.sourceLanguage,
              clientState.targetLanguage,
              socket
            );
          }
        } catch (error) {
          console.error('Error in direct transcription:', error);
          socket.emit('error', { message: 'Transcription error: ' + error.message });
        }
      });
      
      // Handle disconnection
      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
      });
    });
  }
};

// Process complete audio file with Whisper API and translation
async function processAudioFile(socket, clientState) {
  try {
    // Only attempt to transcribe if we have enough audio data
    if (!clientState.audioBuffer || clientState.audioBuffer.length < 1000) {
      console.log('Audio file too small, skipping processing');
      socket.emit('transcription', { 
        text: '', 
        final: true 
      });
      return;
    }
    
    console.log(`Processing audio file of size ${clientState.audioBuffer.length} bytes`);
    
    // Transcribe the audio
    const transcription = await transcribeAudio(clientState.audioBuffer, clientState.sourceLanguage);
    
    // If transcription is empty, don't continue
    if (!transcription || transcription.trim() === '') {
      console.log('Empty transcription result, skipping translation');
      socket.emit('transcription', { 
        text: '', 
        final: true 
      });
      return;
    }
    
    // Send transcription to client
    socket.emit('transcription', { 
      text: transcription.trim(), 
      final: true 
    });
    
    // Translate the transcription
    const translation = await translateText(
      transcription,
      clientState.sourceLanguage,
      clientState.targetLanguage,
      socket
    );
    
    // The translation will be streamed via translationStream events
  } catch (error) {
    console.error('Error processing audio file:', error);
    
    // Send error to client
    socket.emit('error', { 
      message: 'Error processing audio', 
      details: error.message 
    });
  }
}

// Transcribe audio using Whisper API
// Process partial audio for incremental transcription
async function processPartialAudio(socket, audioBuffer, language) {
  if (!audioBuffer || audioBuffer.byteLength < 500) return;
  
  try {
    // Prepare form data for the Whisper API
    const formData = new FormData();
    const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
    
    formData.append('file', buffer, {
      filename: 'audio-partial.wav',
      contentType: 'audio/wav'
    });
    formData.append('model', 'whisper-1');
    formData.append('language', language);
    
    // Use API endpoint
    const apiEndpoint = process.env.NODE_ENV === 'development' 
      ? 'http://localhost:3000/api/whisper' 
      : 'https://yourdomain.com/api/whisper';
    
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) return;
    
    const data = await response.json();
    if (data.text && data.text.trim() !== '') {
      // Send partial transcription to client
      socket.emit('transcription', { 
        text: data.text.trim(), 
        final: false 
      });
    }
  } catch (error) {
    console.error('Error processing partial audio:', error);
    // Don't emit error for partial audio processing to avoid UI clutter
  }
}

// Import the fs module to work with temporary files
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

// Direct transcription with OpenAI API
async function transcribeAudioWithOpenAI(audioBuffer, language) {
  // Create a unique temporary file path
  const tempFilePath = path.join(os.tmpdir(), `audio-${uuidv4()}.webm`);
  
  try {
    // Create a Buffer from the audioBuffer if it's not already a Buffer
    const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
    
    console.log(`Transcribing audio with OpenAI Whisper API, buffer size: ${buffer.length} bytes, temp file: ${tempFilePath}`);
    
    // Write the buffer to a temporary file (OpenAI SDK needs a file path in Node.js)
    fs.writeFileSync(tempFilePath, buffer);
    
    // Create the transcription using the file path
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-1',
      language: language,
      response_format: 'text',
    });
    
    console.log('Transcription successful:', transcription);
    return transcription;
  } catch (error) {
    console.error('Error in direct transcription with OpenAI:', error);
    throw error;
  } finally {
    // Clean up - delete the temporary file
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        console.log(`Deleted temporary file: ${tempFilePath}`);
      }
    } catch (err) {
      console.error('Error deleting temporary file:', err);
    }
  }
}

// Legacy function kept for compatibility
async function transcribeAudio(audioBuffer, language) {
  return transcribeAudioWithOpenAI(audioBuffer, language);
}

// Direct translation with OpenAI API (streaming)
async function translateTextWithOpenAI(text, sourceLanguage, targetLanguage, socket) {
  try {
    console.log(`Translating text directly with OpenAI from ${sourceLanguage} to ${targetLanguage}`);
    
    // Get language names for better prompting
    const getLanguageName = (code) => {
      const languages = {
        'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
        'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian', 'zh': 'Chinese',
        'ja': 'Japanese', 'ko': 'Korean', 'ar': 'Arabic', 'hi': 'Hindi'
      };
      return languages[code] || code;
    };
    
    const sourceLangName = getLanguageName(sourceLanguage);
    const targetLangName = getLanguageName(targetLanguage);
    
    // Create a streaming request to OpenAI API
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
    
    let translatedText = '';
    
    // Process the stream in chunks
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        translatedText += content;
        
        // Emit intermediate translation results
        socket.emit('translationStream', {
          translatedText,
          partial: true
        });
      }
    }
    
    // Send final translation
    socket.emit('translationStream', {
      translatedText,
      partial: false
    });
    
    console.log('Translation complete:', translatedText);
    return translatedText;
  } catch (error) {
    console.error('Error in direct translation with OpenAI:', error);
    throw error;
  }
}

// Legacy function for compatibility
async function translateText(text, sourceLanguage, targetLanguage, socket) {
  return translateTextWithOpenAI(text, sourceLanguage, targetLanguage, socket);
}

 