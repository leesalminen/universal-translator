"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MicIcon, PlayIcon, PauseIcon } from 'lucide-react';
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
  const [isTranslating, setIsTranslating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioURL, setAudioURL] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  
  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  // Get socket connection from context
  const { socket, connected: socketConnected } = useWebSocket();
  
  // Text to speech conversion - defined as useCallback to avoid dependency issues
  const textToSpeech = useCallback(async (text: string) => {
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          language: targetLanguage,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to convert text to speech');
      }

      const audioBlob = await response.blob();
      const url = URL.createObjectURL(audioBlob);
      
      setAudioURL(url);
      
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play();
        setIsPlaying(true);
      }
    } catch (error) {
      console.error('Error converting text to speech:', error);
    }
  }, [targetLanguage]);
  
  // Setup socket event listeners
  useEffect(() => {
    if (!socket) return;
    
    // Set up socket event listeners
    socket.on('transcription', (data) => {
      console.log('Received transcription:', data);
      if (data.text) {
        setTranscription(prev => data.final ? data.text : prev + " " + data.text);
      }
    });
    
    socket.on('translation', (data) => {
      console.log('Received translation:', data);
      if (data.text) {
        setTranslation(data.text);
        
        // Convert the translation to speech
        if (data.final) {
          textToSpeech(data.text);
        }
      }
    });
    
    socket.on('error', (error) => {
      console.error('Socket error:', error);
      setIsTranslating(false);
    });
    
    // Cleanup
    return () => {
      socket.off('transcription');
      socket.off('translation');
      socket.off('error');
    };
  }, [socket, textToSpeech]);
  
  // Notify socket of language changes
  useEffect(() => {
    if (socket && socketConnected) {
      socket.emit('changeLanguage', {
        sourceLanguage,
        targetLanguage
      });
    }
  }, [sourceLanguage, targetLanguage, socketConnected, socket]);
  
  // Initialize audio analyzer for silence detection
  const setupAudioAnalyzer = (stream: MediaStream) => {
    try {
      // Make sure any previous context is closed
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
      }
      
      // Create audio context and analyzer
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      console.log('Audio context created, state:', audioContext.state);
      
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(stream);
      
      // Connect the microphone to the analyzer
      microphone.connect(analyser);
      
      // Configure the analyzer for better silence detection
      analyser.fftSize = 1024;  // Higher fft size for better frequency resolution
      analyser.smoothingTimeConstant = 0.5;  // Balanced smoothing (0-1)
      
      console.log('Audio analyzer setup complete, buffer size:', analyser.frequencyBinCount);
      
      // Store references
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      
      // Start silence detection right away
      requestAnimationFrame(detectSilence);
    } catch (error) {
      console.error('Error setting up audio analyzer:', error);
    }
  };
  
  // Check for silence in audio stream
  const detectSilence = () => {
    if (!analyserRef.current || !isListening) return;
    
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    
    // Calculate average volume level
    const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
    
    console.log('Current audio level:', average.toFixed(2));
    
    // If volume is below threshold, consider it silence
    const SILENCE_THRESHOLD = 15; // Slightly increased threshold for better detection
    
    if (average < SILENCE_THRESHOLD) {
      if (!silenceTimeoutRef.current) {
        // Set timeout to stop recording after 1.5 seconds of silence
        console.log('Silence detected, starting silence timeout');
        silenceTimeoutRef.current = setTimeout(() => {
          console.log('Silence timeout reached, stopping recording to process audio');
          if (isListening) {
            stopListening();
          }
        }, 1500);
      }
    } else {
      // If there's sound, clear the silence timeout
      if (silenceTimeoutRef.current) {
        console.log('Sound detected, clearing silence timeout');
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }
    }
    
    // Continue checking if still listening
    if (isListening) {
      requestAnimationFrame(detectSilence);
    }
  };
  
  // Handle microphone toggle
  const toggleListening = async () => {
    if (isListening) {
      stopListening();
    } else {
      try {
        // First check if socket is connected
        if (!socket || !socketConnected) {
          console.error('WebSocket not connected. Cannot start recording.');
          alert('Connection to server not established. Please refresh the page and try again.');
          return;
        }

        console.log('Starting audio recording. Socket connected:', socketConnected);
        
        // Request microphone access with detailed error logging
        console.log('Requesting microphone access...');
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        }).catch(err => {
          console.error('Microphone access error details:', err.name, err.message);
          throw err;
        });
        
        console.log('Microphone access granted! Stream tracks:', stream.getAudioTracks().length);
        console.log('Audio track settings:', stream.getAudioTracks()[0].getSettings());
        
        streamRef.current = stream;
        
        // Setup audio analyzer for silence detection
        setupAudioAnalyzer(stream);
        
        // Determine supported MIME types and log them
        console.log('Checking supported MIME types:');
        ['audio/wav', 'audio/webm', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus'].forEach(type => {
          console.log(`${type}: ${MediaRecorder.isTypeSupported(type) ? 'supported' : 'not supported'}`);
        });
        
        // Create media recorder with a format supported by Whisper API
        // Use WAV format for better compatibility with Whisper
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
          ? 'audio/webm;codecs=opus' 
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : 'audio/ogg';
        
        console.log(`Using MIME type: ${mimeType}`);
        
        const options = {
          mimeType: mimeType,
          audioBitsPerSecond: 128000
        };
        
        console.log('Creating MediaRecorder with options:', options);
        mediaRecorderRef.current = new MediaRecorder(stream, options);
        
        audioChunksRef.current = [];

        // Set up media recorder events
        mediaRecorderRef.current.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
            // console.log(`Received audio chunk: ${event.data.size} bytes, type: ${event.data.type}`);
          } else {
            console.warn('Received empty audio chunk');
          }
        };

        mediaRecorderRef.current.onstart = () => {
          console.log('MediaRecorder started');
          audioChunksRef.current = [];
        };

        mediaRecorderRef.current.onerror = (event) => {
          console.error('MediaRecorder error:', event);
        };
        
        // Set up recorder stop event
        mediaRecorderRef.current.onstop = async () => {
          console.log('MediaRecorder stopped');
          
          if (socket && socketConnected && audioChunksRef.current.length > 0) {
            console.log(`Sending complete audio file with ${audioChunksRef.current.length} chunks`);
            // Create a single blob from all chunks
            const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
            
            console.log('Audio blob created, size:', audioBlob.size, 'bytes, type:', audioBlob.type);
            
            if (audioBlob.size < 1000) {
              console.warn('Audio file too small, likely no speech detected');
              return;
            }
            
            try {
              // Convert blob to array buffer
              const arrayBuffer = await audioBlob.arrayBuffer();
              
              console.log('Converted to ArrayBuffer, size:', arrayBuffer.byteLength, 'bytes');
              
              // Debug: create a quick audio element to verify recording content
              const audioUrl = URL.createObjectURL(audioBlob);
              console.log('Debug audio URL (check in console):', audioUrl);
              
              // Add debug event listener for acknowledgment
              const ackTimeout = setTimeout(() => {
                console.error('No acknowledgment received from server after 5 seconds');
              }, 5000);
              
              // Send the complete audio file
              console.log('Emitting audioChunk event to socket:', socket.id);
              socket.emit('audioChunk', arrayBuffer, () => {
                clearTimeout(ackTimeout);
                console.log('Server acknowledged receipt of audio chunk');
              });
              
              // Notify server that stream is complete
              socket.emit('endAudioStream');
              
              // Set translating state
              setIsTranslating(true);
              
              // Clear chunks
              audioChunksRef.current = [];
            } catch (error) {
              console.error('Error sending audio to server:', error);
            }
          } else {
            console.error('Cannot send audio: Socket connected:', socketConnected, 
                         'Audio chunks:', audioChunksRef.current.length);
          }
        };

        // Start recording with a shorter time slice for continuous data collection
        console.log('Starting MediaRecorder with timeslice: 100ms');
        try {
          mediaRecorderRef.current.start(100); // Collect data every 100ms for smoother audio
          setIsListening(true);
          setIsRecording(true); // Set recording state to true to trigger silence detection
          
          // Reset transcription and translation when starting new recording
          setTranscription("");
          setTranslation("");
          
          // Add a failsafe check to make sure we're getting audio data
          // If after 2 seconds we have no chunks, we may have an issue with the recorder
          const dataCheckTimeout = setTimeout(() => {
            if (audioChunksRef.current.length === 0) {
              console.warn('No audio chunks received after 2 seconds, there may be an issue with the recorder');
              // Try requesting data manually
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                console.log('Manually requesting data from MediaRecorder');
                mediaRecorderRef.current.requestData();
              }
            } else {
              console.log('Audio recording confirmed - chunks received:', audioChunksRef.current.length);
            }
          }, 2000);
          
          // Clean up the timeout if component unmounts
          return () => clearTimeout(dataCheckTimeout);
        } catch (error) {
          console.error('Error starting MediaRecorder:', error);
          alert('Error starting audio recording: ' + (error instanceof Error ? error.message : String(error)));
        }
      } catch (error) {
        console.error('Error accessing microphone:', error);
        alert('Error accessing microphone: ' + (error instanceof Error ? error.message : String(error)));
      }
    }
  };

  const stopListening = () => {
    console.log('Stopping listening, recorder state:', mediaRecorderRef.current?.state);
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      console.log('Stopping MediaRecorder...');
      
      try {
        // Request final data chunk before stopping
        mediaRecorderRef.current.requestData();
        
        // Stop the recorder after a small delay to ensure the final chunk is processed
        setTimeout(() => {
          console.log('Finalizing MediaRecorder stop...');
          mediaRecorderRef.current?.stop();
          setIsListening(false);
          setIsRecording(false); // Immediately set recording state to false
          
          // Log final chunk count
          console.log('Final audio chunk count:', audioChunksRef.current.length);
          
          // Stop all audio tracks
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => {
              track.stop();
              console.log('Audio track stopped');
            });
            streamRef.current = null;
          }
          
          // Clear any silence detection timeout
          if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
            silenceTimeoutRef.current = null;
          }
          
          // Close audio context
          if (audioContextRef.current) {
            audioContextRef.current.close().catch(console.error);
            audioContextRef.current = null;
            analyserRef.current = null;
          }
        }, 100);
      } catch (error) {
        console.error('Error stopping MediaRecorder:', error);
      }
    } else {
      console.warn('MediaRecorder not in recording state, cannot stop');
      setIsListening(false);
    }
  };

  // Handle play/pause
  const togglePlayback = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioURL) {
        URL.revokeObjectURL(audioURL);
      }
      
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
      }
      
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
    };
  }, [audioURL]);

  const startRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      console.log("Starting audio recording");
      audioChunksRef.current = [];
      mediaRecorderRef.current.start(100); // 100ms time slices for smoother audio
      setIsRecording(true);
      setTranscription("");
      setTranslation("");
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (mediaRecorderRef.current && isRecording) {
      console.log("Stopping audio recording");
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  useEffect(() => {
    if (!socket || !socketConnected) return;

    // Initialize the MediaRecorder with the audio stream
    if (streamRef.current && !mediaRecorderRef.current) {
      try {
        // Use WAV format for better compatibility with Whisper API
        const options = { mimeType: 'audio/webm' };
        mediaRecorderRef.current = new MediaRecorder(streamRef.current, options);
        
        // Handle audio data as it becomes available
        mediaRecorderRef.current.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        // When recording stops, process the collected audio chunks
        mediaRecorderRef.current.onstop = async () => {
          if (audioChunksRef.current.length === 0) {
            console.log("No audio recorded");
            return;
          }

          try {
            // Create a blob from all the audio chunks
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            console.log(`Audio recording complete - size: ${audioBlob.size} bytes`);
            
            // Skip processing very small recordings (likely just noise)
            if (audioBlob.size < 1000) {
              console.log("Audio too small, skipping");
              return;
            }
            
            // Convert blob to array buffer for sending
            const arrayBuffer = await audioBlob.arrayBuffer();
            
            // Emit the complete audio file to the server
            socket.emit("audioChunk", arrayBuffer);
            
            console.log("Full audio sent to server for processing");
          } catch (error) {
            console.error("Error processing audio:", error);
          }
        };
      } catch (error) {
        console.error("Error setting up MediaRecorder:", error);
      }
    }

    // Set up silence detection for auto-stop
    if (streamRef.current && isRecording) {
      console.log("Setting up silence detection for isRecording:", isRecording);
      const cleanupSilenceDetection = setupSilenceDetection(streamRef.current);
      
      // Clean up when recording state changes or component unmounts
      return cleanupSilenceDetection;
    }

    // ... existing code ...
  }, [socket, socketConnected, streamRef.current, sourceLanguage, isRecording]);

  // Function to detect silence and stop recording automatically
  const setupSilenceDetection = (stream: MediaStream) => {
    console.log("Setting up silence detection for auto-stop");
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(stream);
      microphone.connect(analyser);
      
      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      let silenceTimer: NodeJS.Timeout | null = null;
      let silenceStart: number | null = null;
      const SILENCE_THRESHOLD = 10; // Adjust based on testing
      const SILENCE_DURATION = 1500; // 1.5 seconds of silence before stopping
      
      const checkSilence = () => {
        if (!isRecording) return;
        
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        
        console.log("Silence check - audio level:", average.toFixed(2));
        
        // Check if it's silent
        if (average < SILENCE_THRESHOLD) {
          if (!silenceStart) {
            console.log("Silence started");
            silenceStart = Date.now();
          } else if (Date.now() - silenceStart > SILENCE_DURATION && isRecording) {
            console.log("Silence duration threshold reached, stopping recording");
            stopRecording();
            silenceStart = null;
            return;
          }
        } else {
          // Reset silence detection on sound
          if (silenceStart) {
            console.log("Sound detected, resetting silence detection");
            silenceStart = null;
          }
        }
        
        // Continue checking while recording
        if (isRecording) {
          silenceTimer = setTimeout(checkSilence, 100);
        }
      };
      
      // Start the silence detection right away
      checkSilence();
      
      // Clean up when recording stops
      return () => {
        if (silenceTimer) {
          clearTimeout(silenceTimer);
        }
        audioContext.close().catch(console.error);
      };
    } catch (error) {
      console.error("Error setting up silence detection:", error);
      return () => {}; // Return empty cleanup function
    }
  };

  return (
    <div className="flex flex-col space-y-6 max-w-3xl mx-auto p-4">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Universal Translator</h1>
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${socketConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <ThemeToggle />
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Source Language</label>
          <Select value={sourceLanguage} onValueChange={setSourceLanguage}>
            <SelectTrigger>
              <SelectValue placeholder="Select source language" />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  {lang.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div>
          <label className="text-sm font-medium">Target Language</label>
          <Select value={targetLanguage} onValueChange={setTargetLanguage}>
            <SelectTrigger>
              <SelectValue placeholder="Select target language" />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  {lang.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      <div className="relative p-4 border rounded-lg min-h-[100px]">
        <div className="absolute top-2 right-2 text-xs text-gray-500">Source: {LANGUAGES.find(l => l.code === sourceLanguage)?.name}</div>
        <p className="whitespace-pre-wrap">{transcription || 'Speak to start translation...'}</p>
      </div>
      
      <div className="relative p-4 border rounded-lg min-h-[100px]">
        <div className="absolute top-2 right-2 text-xs text-gray-500">Target: {LANGUAGES.find(l => l.code === targetLanguage)?.name}</div>
        <p className="whitespace-pre-wrap">{translation || 'Translation will appear here...'}</p>
      </div>
      
      <div className="flex justify-center space-x-4">
        <Button 
          onClick={toggleListening} 
          variant={isListening ? "destructive" : "default"}
          className="flex items-center"
          disabled={isTranslating || !socketConnected}
        >
          <MicIcon className="mr-2 h-4 w-4" />
          {isListening ? 'Stop Recording' : 'Start Recording'}
        </Button>
        
        {audioURL && (
          <Button 
            onClick={togglePlayback} 
            variant="outline"
            className="flex items-center"
          >
            {isPlaying ? (
              <>
                <PauseIcon className="mr-2 h-4 w-4" />
                Pause
              </>
            ) : (
              <>
                <PlayIcon className="mr-2 h-4 w-4" />
                Play Translation
              </>
            )}
          </Button>
        )}
      </div>
      
      <audio ref={audioRef} onEnded={() => setIsPlaying(false)} className="hidden" />
      
      <div className="text-center text-sm text-gray-500">
        {isListening ? 'Listening... (will automatically stop when you stop speaking)' : 'Click Start Recording to begin'}
      </div>
    </div>
  );
} 