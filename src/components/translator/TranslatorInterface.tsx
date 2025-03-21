"use client";

import { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MicIcon, PlayIcon, PauseIcon, ArrowUpDown } from 'lucide-react';
import { ThemeToggle } from "@/components/theme-toggle";
import { useWebSocket } from '@/components/WebSocketProvider';

// List of supported languages
const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
];

export default function TranslatorInterface() {
  // State
  const [isListening, setIsListening] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [translation, setTranslation] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState('en');
  const [targetLanguage, setTargetLanguage] = useState('es');
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioURL, setAudioURL] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  
  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  // Get socket connection from context
  const { socket, connected: socketConnected, reconnect } = useWebSocket();
  
  // Setup socket event listeners
  useEffect(() => {
    if (!socket) return;
    
    console.log("Setting up socket event listeners...");
    
    // Set up socket event listeners
    socket.on('transcription', (data) => {
      console.log('Received transcription:', data);
      if (data.text) {
        setTranscription(data.text);
        
        // If we get a final transcription and it's not empty, request translation
        if (data.final && data.text.trim() && socket) {
          setStatus('Translating...');
          console.log(`Requesting translation from ${sourceLanguage} to ${targetLanguage}`);
          socket.emit('startTranslation', {
            text: data.text,
            sourceLanguage,
            targetLanguage
          });
        }
      }
    });
    
    socket.on('translationStream', (data) => {
      console.log('Received translation data:', data);
      if (data.translation) {
        setTranslation(data.translation);
        
        // Request speech generation when translation is complete
        if (!data.partial) {
          setStatus('Generating speech...');
          console.log(`Generating speech for: "${data.translation.substring(0, 30)}${data.translation.length > 30 ? '...' : ''}"`);
          generateSpeech(data.translation);
        }
      } else {
        console.warn('Received translationStream event with missing translation property:', data);
      }
    });
    
    socket.on('speechData', (data) => {
      console.log('Received speech data:', data ? (data.metadata ? 'metadata' : 
        data.final ? 'final chunk' : 'chunk ' + data.chunkIndex) : 'undefined');
        
      if (data && (data.audioChunk || data.metadata)) {
        handleSpeechData(data);
      } else {
        console.warn('Received speechData event with unexpected format:', data);
      }
    });
    
    socket.on('error', (error) => {
      console.error('Socket error:', error);
      setStatus(`Error: ${error.message}`);
    });
    
    // Test the connection with a ping
    socket.emit('ping', Date.now(), (response: number) => {
      console.log('Server ping response, latency:', Date.now() - response, 'ms');
    });
    
    return () => {
      console.log("Cleaning up socket event listeners...");
      socket.off('transcription');
      socket.off('translationStream');
      socket.off('speechData');
      socket.off('error');
    };
  }, [socket, sourceLanguage, targetLanguage]);
  
  // Audio data buffers for generating audio from chunks
  const audioChunksMapRef = useRef<Map<number, Uint8Array>>(new Map());
  const audioMetadataRef = useRef<any>(null);
  
  // Handle audio speech data from server
  const handleSpeechData = (data: any) => {
    try {
      if (data.metadata) {
        console.log('Received speech metadata:', data.metadata);
        audioMetadataRef.current = data.metadata;
        return;
      }
      
      if (data.chunkIndex !== undefined && data.audioChunk) {
        // Store the chunk with its index
        const audioArray = new Uint8Array(data.audioChunk);
        console.log(`Received audio chunk ${data.chunkIndex}, size: ${audioArray.length} bytes`);
        audioChunksMapRef.current.set(data.chunkIndex, audioArray);
      }
      
      if (data.final) {
        console.log('Received final audio chunk, creating audio...');
        // All chunks received, create the audio
        createAudioFromChunks();
      }
    } catch (error) {
      console.error('Error handling speech data:', error);
    }
  };
  
  // Create audio from received chunks
  const createAudioFromChunks = () => {
    try {
      if (!audioChunksMapRef.current.size) {
        console.error('No audio chunks received');
        setStatus('Error: No audio data received');
        return;
      }
      
      // Sort chunks by index
      const sortedIndices = Array.from(audioChunksMapRef.current.keys()).sort((a, b) => a - b);
      console.log(`Creating audio from ${sortedIndices.length} chunks`);
      
      // Concatenate all chunks in correct order
      const totalLength = sortedIndices.reduce(
        (total, index) => total + audioChunksMapRef.current.get(index)!.length, 0
      );
      
      const combinedArray = new Uint8Array(totalLength);
      let offset = 0;
      
      sortedIndices.forEach(index => {
        const chunk = audioChunksMapRef.current.get(index)!;
        combinedArray.set(chunk, offset);
        offset += chunk.length;
      });
      
      console.log(`Created combined audio array, total size: ${combinedArray.length} bytes`);
      
      // Create blob and URL
      const blob = new Blob([combinedArray], { type: 'audio/mp3' });
      const url = URL.createObjectURL(blob);
      
      // Clean up any previous audio URL
      if (audioURL) {
        URL.revokeObjectURL(audioURL);
      }
      
      // Set the new audio URL
      setAudioURL(url);
      
      // Reset status
      setStatus('Ready to play');
      
      // Automatically play the audio
      console.log('Playing audio...');
      playAudio(url);
      
      // Clear the chunks map
      audioChunksMapRef.current.clear();
    } catch (error) {
      console.error('Error creating audio from chunks:', error);
      setStatus(`Error creating audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };
  
  // Play audio
  const playAudio = (url: string) => {
    try {
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play()
          .then(() => {
            setIsPlaying(true);
          })
          .catch(error => {
            console.error('Error playing audio:', error);
            setIsPlaying(false);
          });
      }
    } catch (error) {
      console.error('Error playing audio:', error);
    }
  };
  
  // Send text to be converted to speech
  const generateSpeech = (text: string) => {
    if (!text) {
      console.warn('Cannot generate speech: Empty text');
      return;
    }
    
    // Add a small delay to ensure the connection is stable
    setTimeout(() => {
      // Double-check socket connection status
      if (!socket) {
        console.error('Cannot generate speech: No socket');
        setStatus('Error: Connection lost. Please refresh the page.');
        return;
      }
      
      if (!socket.connected) {
        console.error('Socket exists but is disconnected. Attempting to reconnect...');
        setStatus('Reconnecting...');
        
        // Try to reconnect using our provider's reconnect function
        reconnect();
        
        // Wait a moment for the connection and try again
        setTimeout(() => {
          if (socket.connected) {
            console.log('Reconnected successfully, now sending speech request');
            sendSpeechRequest(text);
          } else {
            console.error('Failed to reconnect');
            setStatus('Error: Failed to reconnect. Please refresh the page.');
          }
        }, 1000);
        return;
      }
      
      // Socket is connected, send the request
      sendSpeechRequest(text);
    }, 100);
  };
  
  // Helper function to send the actual speech request
  const sendSpeechRequest = (text: string) => {
    console.log(`Requesting speech generation for language: ${targetLanguage}`);
    setStatus('Generating speech...');
    
    socket!.emit('generateSpeech', {
      text,
      language: targetLanguage,
    }, () => {
      // This callback will fire when the server acknowledges receipt
      console.log('Server acknowledged speech generation request');
    });
  };
  
  // Toggle between listening and not listening
  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      // Debug WebSocket connection before starting
      console.log("WebSocket connected:", socketConnected);
      console.log("WebSocket instance:", socket?.id);
      
      if (!socketConnected) {
        setStatus('Error: WebSocket not connected');
        return;
      }
      
      startListening();
    }
  };
  
  // Start speech recognition
  const startListening = async () => {
    try {
      setStatus('Requesting microphone access...');
      setTranscription('');
      setTranslation('');
      
      // Reset audio URL if it exists
      if (audioURL) {
        URL.revokeObjectURL(audioURL);
        setAudioURL(null);
      }
      
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      console.log("Microphone access granted:", stream.active);
      streamRef.current = stream;
      
      // Create media recorder with audio/wav format
      let mimeType = 'audio/wav';
      
      // Fall back to other formats if wav is not supported
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = MediaRecorder.isTypeSupported('audio/webm') 
          ? 'audio/webm' 
          : 'audio/ogg';
      }
      
      console.log("Using MIME type:", mimeType);
      
      const mediaRecorder = new MediaRecorder(stream, { 
        mimeType,
        audioBitsPerSecond: 128000
      });
      mediaRecorderRef.current = mediaRecorder;
      
      // Reset audio chunks
      audioChunksRef.current = [];
      
      // Handle data availability
      mediaRecorder.ondataavailable = (event) => {
        console.log("Audio data available:", event.data.size, "bytes, type:", event.data.type);
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      // Handle recording stop
      mediaRecorder.onstop = () => {
        console.log("MediaRecorder stopped, processing audio...");
        processAudio();
      };
      
      // Start recording
      console.log("Starting MediaRecorder...");
      mediaRecorder.start(1000); // Collect data in 1-second chunks
      setIsListening(true);
      setStatus('Listening... (speak now)');
      
      // Set a maximum recording duration (25 seconds) to prevent very large files
      const maxRecordingDuration = 25000; // 25 seconds
      const recordingTimeout = setTimeout(() => {
        if (isListening && mediaRecorderRef.current?.state === 'recording') {
          console.log(`Maximum recording duration of ${maxRecordingDuration}ms reached, stopping automatically`);
          setStatus('Maximum recording duration reached');
          stopListening();
        }
      }, maxRecordingDuration);
      
      // Clean up timeout if component unmounts
      return () => {
        clearTimeout(recordingTimeout);
      };
    } catch (error) {
      console.error('Error starting listening:', error);
      setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };
  
  // Stop speech recognition
  const stopListening = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    
    // Stop the microphone stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    setIsListening(false);
    setStatus('Processing audio...');
  };
  
  // Process audio after recording stops
  const processAudio = async () => {
    try {
      if (!socket || !socketConnected) {
        setStatus('Error: WebSocket not connected');
        return;
      }
      
      if (audioChunksRef.current.length === 0) {
        setStatus('Error: No audio recorded');
        return;
      }
      
      // Get the MIME type from the first chunk to ensure consistency
      const firstChunk = audioChunksRef.current[0];
      const mimeType = firstChunk.type;
      
      // Create a blob from the audio chunks using the original format
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      console.log("Audio recorded:", audioBlob.size, "bytes, type:", audioBlob.type);
      
      // Apply size limit to prevent errors with very large recordings
      const MAX_SIZE = 1024 * 1024; // 1MB limit
      let arrayBuffer;
      
      if (audioBlob.size > MAX_SIZE) {
        // For large recordings, create a shortened version
        console.log(`Audio exceeds ${MAX_SIZE} bytes, trimming to first 10 seconds`);
        // Keep approximately the first 10 seconds of audio (adjust based on typical chunk sizes)
        const shortenedChunks = audioChunksRef.current.slice(0, 10);
        const shortenedBlob = new Blob(shortenedChunks, { type: mimeType });
        arrayBuffer = await shortenedBlob.arrayBuffer();
        setStatus('Audio too long, using first 10 seconds...');
      } else {
        // Use the full audio for smaller recordings
        arrayBuffer = await audioBlob.arrayBuffer();
      }
      
      console.log("Sending audio data to server:", arrayBuffer.byteLength, "bytes");
      setStatus('Sending audio to server...');
      
      // Add retry logic for transcription errors
      let retryCount = 0;
      const maxRetries = 2;
      
      const sendAudioWithRetry = () => {
        socket.emit('audioChunk', arrayBuffer, { mimeType }, (response?: { success: boolean, error?: string }) => {
          console.log('Server acknowledged receipt of audio chunk', response);
          
          if (response && !response.success) {
            console.error('Server reported error:', response.error);
            
            if (retryCount < maxRetries) {
              retryCount++;
              setStatus(`Transcription error, retrying (${retryCount}/${maxRetries})...`);
              setTimeout(sendAudioWithRetry, 1000); // Retry after 1 second
            } else {
              setStatus(`Error: Failed to transcribe after ${maxRetries} attempts`);
            }
          } else {
            setStatus('Audio received by server, awaiting transcription...');
          }
        });
      };
      
      sendAudioWithRetry();
      
      // Reset audio chunks
      audioChunksRef.current = [];
    } catch (error) {
      console.error('Error processing audio:', error);
      setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };
  
  // Toggle audio playback
  const togglePlayback = () => {
    if (!audioRef.current || !audioURL) return;
    
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(error => console.error('Error playing audio:', error));
    }
  };
  
  // Swap languages
  const swapLanguages = () => {
    setSourceLanguage(targetLanguage);
    setTargetLanguage(sourceLanguage);
  };
  
  // Handle audio playback end
  const handleAudioEnd = () => {
    setIsPlaying(false);
    
    // Display status message
    setStatus('Swapping languages for next speaker...');

    // Wait a short moment before starting the next turn
    setTimeout(() => {
      try {
        // Swap languages for the next speaker
        const previousSource = sourceLanguage;
        const previousTarget = targetLanguage;
        setSourceLanguage(previousTarget);
        setTargetLanguage(previousSource);
        
        // Clear previous text
        setTranscription('');
        setTranslation('');

        // Wait for language swap to complete
        setTimeout(() => {
          try {
            setStatus('Ready for next speaker...');
            
            // Automatically start listening for the next speaker
            startListening();
          } catch (innerError) {
            console.error('Error starting next turn:', innerError);
            setStatus('Error starting next turn. Click "Start Listening" to continue.');
          }
        }, 300);
      } catch (error) {
        console.error('Error swapping languages:', error);
        setStatus('Error swapping languages. Please swap manually and click "Start Listening".');
      }
    }, 500);
  };
  
  // Create a helper to display temporary error messages without breaking the flow
  const showTemporaryError = (message: string) => {
    const prevStatus = status;
    setStatus(`Error: ${message}`);
    
    // Reset back to previous status after a delay
    setTimeout(() => {
      setStatus(prevStatus);
    }, 3000);
  };
  
  // Add global error handling for the socket
  useEffect(() => {
    if (!socket) return;
    
    const handleSocketError = (error: any) => {
      console.error('WebSocket error:', error);
      
      // If we're already recording, don't interrupt the current session
      if (isListening) {
        showTemporaryError(error.message || 'Connection error');
      } else {
        setStatus(`Error: ${error.message || 'Connection error'}`);
      }
    };
    
    socket.on('error', handleSocketError);
    socket.on('connect_error', handleSocketError);
    
    return () => {
      socket.off('error', handleSocketError);
      socket.off('connect_error', handleSocketError);
    };
  }, [socket, isListening, status]);
  
  return (
    <div className="flex flex-col h-full w-full max-w-5xl mx-auto gap-4">
      <div className="flex items-center justify-between w-full">
        <h1 className="text-2xl font-bold">Real-time Translator</h1>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${socketConnected ? 'bg-green-500' : 'bg-red-500'}`} 
               title={socketConnected ? 'Connected' : 'Disconnected'} />
          <ThemeToggle />
        </div>
      </div>
      
      <div className="flex items-center justify-center mb-2">
        <p className="text-sm font-medium">
          <span className="font-bold">{LANGUAGES.find(l => l.code === sourceLanguage)?.name}</span>
          {' → '}
          <span className="font-bold">{LANGUAGES.find(l => l.code === targetLanguage)?.name}</span>
          {isPlaying && <span className="ml-2 text-blue-500">(Will swap after playback)</span>}
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Source language section */}
        <div className="flex flex-col gap-2 p-4 border rounded-lg">
          <div className="flex items-center justify-between">
            <Select 
              value={sourceLanguage}
              onValueChange={setSourceLanguage}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Source Language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button 
              variant="outline"
              size="icon"
              onClick={swapLanguages}
              aria-label="Swap languages"
            >
              <ArrowUpDown className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="relative min-h-[200px] p-2 border rounded bg-muted">
            <p className="whitespace-pre-wrap">{transcription || 'Your speech will appear here...'}</p>
          </div>
          
          <Button 
            onClick={toggleListening}
            variant={isListening ? "destructive" : "default"}
            className="mt-2"
            disabled={isPlaying} // Disable button during playback
          >
            <MicIcon className="mr-2 h-4 w-4" />
            {isListening ? 'Stop Listening' : isPlaying ? 'Next speaker after playback' : 'Start Listening'}
          </Button>
        </div>
        
        {/* Target language section */}
        <div className="flex flex-col gap-2 p-4 border rounded-lg">
          <div className="flex items-center justify-between">
            <Select 
              value={targetLanguage}
              onValueChange={setTargetLanguage}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Target Language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {audioURL && (
              <Button 
                variant="outline"
                size="icon"
                onClick={togglePlayback}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
              </Button>
            )}
          </div>
          
          <div className="relative min-h-[200px] p-2 border rounded bg-muted">
            <p className="whitespace-pre-wrap">{translation || 'Translation will appear here...'}</p>
          </div>
          
          <p className="text-sm text-muted-foreground">{status}</p>
        </div>
      </div>
      
      <audio ref={audioRef} onEnded={handleAudioEnd} className="hidden" />
      
      <div className="text-center text-xs text-muted-foreground mt-2">
        <p>When playback finishes, languages will automatically swap and recording will start for the next speaker.</p>
        <p className="mt-1">This enables natural back-and-forth conversation between two people speaking different languages.</p>
      </div>
    </div>
  );
} 