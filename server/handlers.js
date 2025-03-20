const fetch = require('node-fetch');
const FormData = require('form-data');

// Process audio chunks and handle WebSocket communication
module.exports = {
  // Setup WebSocket event handlers
  setupSocketHandlers: (io) => {
    io.on('connection', async (socket) => {
      console.log('Client connected:', socket.id);
      
      // Store client state
      const clientState = {
        audioBuffer: null,
        sourceLanguage: 'en',
        targetLanguage: 'es',
        isProcessing: false,
      };

      // Handle audio chunk - for WebSocket approach, we now receive a complete audio file
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
              clientState.targetLanguage
            );
            
            console.log('Translation:', translation);
            
            // Emit the translation to the client
            socket.emit('translation', { text: translation, final: true });
            
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
      clientState.targetLanguage
    );
    
    // Send translation to client
    socket.emit('translation', { 
      text: translation.trim(), 
      final: true 
    });
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
async function transcribeAudio(audioBuffer, language) {
  try {
    const formData = new FormData();
    
    // In Node.js, we need to use Buffer directly with FormData
    // Create a Buffer from the audioBuffer if it's not already a Buffer
    const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
    
    // Append the buffer directly to FormData with the correct filename and content type
    formData.append('file', buffer, {
      filename: 'audio.wav',
      contentType: 'audio/wav'
    });
    formData.append('model', 'whisper-1');
    formData.append('language', language);
    
    // Use absolute URL for better reliability
    const apiEndpoint = process.env.NODE_ENV === 'development' 
      ? 'http://localhost:3000/api/whisper' 
      : 'https://yourdomain.com/api/whisper';
    
    console.log('Sending audio to Whisper API, buffer size:', buffer.length);
    
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Whisper API response:', response.status, errorText);
      throw new Error(`Whisper API error: ${errorText}`);
    }
    
    const data = await response.json();
    console.log('Transcription successful:', data.text);
    return data.text;
  } catch (error) {
    console.error('Error transcribing audio:', error);
    throw error;
  }
}

// Translate text using translation API
async function translateText(text, sourceLanguage, targetLanguage) {
  try {
    const apiEndpoint = process.env.NODE_ENV === 'development' 
      ? 'http://localhost:3000/api/translate' 
      : 'https://yourdomain.com/api/translate';
    
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        sourceLanguage,
        targetLanguage,
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Translation API error: ${error}`);
    }
    
    const data = await response.json();
    return data.translatedText;
  } catch (error) {
    console.error('Error translating text:', error);
    throw error;
  }
} 