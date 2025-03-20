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
  const isStreamingRef = useRef(false); // Track whether we're using streaming translation
  const hasFinalized = useRef(false); // Track audio finalization to prevent duplicate playback
  
  // Get socket connection from context
  const { socket, connected: socketConnected } = useWebSocket();
  
  // Refs for streaming audio data
  const audioChunksMapRef = useRef<Map<number, Uint8Array>>(new Map());
  const audioMetadataRef = useRef<any>(null);
  
  // Text to speech conversion via WebSocket - defined as useCallback to avoid dependency issues
  const textToSpeech = useCallback(async (text: string) => {
    try {
      // Skip if text is empty or too short
      if (!text || text.trim().length < 2) {
        console.log('Text too short, skipping TTS');
        return;
      }
      
      if (!socket || !socketConnected) {
        console.error('Cannot generate speech: WebSocket not connected');
        return;
      }
      
      console.log('Converting to speech via WebSocket:', text.substring(0, 30) + (text.length > 30 ? '...' : ''));
      
      // Clean up previous audio URL if it exists
      if (audioURL) {
        URL.revokeObjectURL(audioURL);
        setAudioURL(null);
      }
      
      // Stop any currently playing audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      
      // Clear previous audio chunks and reset flags
      audioChunksMapRef.current.clear();
      audioMetadataRef.current = null;
      
      // Reset finalization flag BEFORE sending the request
      // This ensures we're in a clean state for the new audio generation
      hasFinalized.current = false;
      
      // Request speech generation via WebSocket
      // Use a small delay to ensure we don't send multiple requests in quick succession
      // This helps prevent race conditions between multiple translationStream events
      setTimeout(() => {
        if (socket && socketConnected) {
          socket.emit('generateSpeech', {
            text,
            language: targetLanguage,
          });
        }
      }, 10);
      
      // Speech events are handled in useEffect socket listener setup
    } catch (error) {
      console.error('Error requesting speech generation:', error);
    }
  }, [targetLanguage, audioURL, socket, socketConnected]);
  
  // Setup socket event listeners
  useEffect(() => {
    if (!socket) return;
    
    // Set up socket event listeners
    socket.on('transcription', (data) => {
      console.log('Received transcription:', data);
      if (data.text) {
        // Update transcription based on whether it's a partial or final update
        // For partial updates, append to existing text with proper spacing
        setTranscription(prev => {
          if (data.final) return data.text;
          if (!prev) return data.text;
          return prev + (prev.endsWith(' ') ? '' : ' ') + data.text;
        });
        
        // If we get a final transcription and it's not empty, start translating immediately
        // This creates a more conversational feel by starting translation before recording stops
        if (data.final && data.text.trim() && socket) {
          socket.emit('startTranslation', {
            text: data.text,
            sourceLanguage,
            targetLanguage
          });
        }
      }
    });
    
    // Reset streaming flag at the start of a new socket connection
    isStreamingRef.current = false;
    
    socket.on('translation', (data) => {
      console.log('Received translation:', data);
      if (data.text) {
        setTranslation(data.text);
        
        // Only convert final translations to speech if we're not using streaming
        // This prevents duplicate playback with translationStream events
        if (data.final && !isStreamingRef.current) {
          textToSpeech(data.text);
        }
      }
    });
    
    // Handle streaming translation updates
    socket.on('translationStream', (data) => {
      console.log('Received translation stream update');
      
      // Mark that we're using streaming translation
      isStreamingRef.current = true;
      
      if (data.translatedText) {
        setTranslation(data.translatedText);
        
        // Convert final translation to speech ONLY when stream is complete
        // This prevents multiple playback of partial translations
        if (!data.partial && !hasFinalized.current) {
          // Set a flag to prevent duplicate requests from multiple final chunks
          const isFinalizing = hasFinalized.current;
          hasFinalized.current = true;
          
          if (!isFinalizing) {
            console.log('Final translation received, requesting speech generation');
            textToSpeech(data.translatedText);
            
            // Reset streaming flag after the final chunk
            setTimeout(() => {
              isStreamingRef.current = false;
            }, 100);
          } else {
            console.log('Skipping duplicate speech generation request');
          }
        }
      }
    });
    
    socket.on('error', (error) => {
      console.error('Socket error:', error);
      setIsTranslating(false);
    });
    
    // Set up handlers for streaming speech
    socket.on('speechStart', (metadata) => {
      console.log('Speech generation started:', metadata);
      audioMetadataRef.current = metadata;
      audioChunksMapRef.current.clear();
      
      // Reset finalization flag when starting new speech
      hasFinalized.current = false;
      
      // We'll collect chunks and play when complete or when enough data is buffered
    });
    
    socket.on('speechChunk', (data) => {
      try {
        // Convert chunk buffer to Uint8Array
        const chunk = new Uint8Array(data.chunk);
        
        // Store chunk in map with its index
        audioChunksMapRef.current.set(data.chunkIndex, chunk);
        
        // Skip early playback - only play when complete to avoid duplicates
        // Comment out progressive playback for now to fix duplication
        /* 
        if (data.chunkIndex === 0 && audioMetadataRef.current) {
          tryPlayAudio();
        }
        */
        
        // If this is the last chunk, finalize the audio
        // But only if we haven't already done so via the speechComplete event
        if (data.isLastChunk && !hasFinalized.current) {
          console.log('Last audio chunk received, finalizing audio');
          // Calling finalizeAudio() will set hasFinalized.current = true inside the function
          finalizeAudio();
        }
      } catch (error) {
        console.error('Error processing speech chunk:', error);
      }
    });
    
    socket.on('speechComplete', () => {
      console.log('Speech generation complete');
      // Only finalize if we haven't already done so
      if (!hasFinalized.current) {
        finalizeAudio();
      } else {
        console.log('Speech already finalized, skipping duplicate playback');
      }
    });
    
    // Create function to combine chunks and play audio
    
    const finalizeAudio = () => {
      if (!audioMetadataRef.current) return;
      
      // Use an atomic check-and-set to prevent race conditions
      // This is critical for avoiding duplicate playback from parallel events
      if (hasFinalized.current) {
        console.log('Audio already finalized, skipping');
        return;
      }
      
      // Immediately set finalized flag to block any parallel calls
      hasFinalized.current = true;
      
      try {
        console.log('Finalizing audio for playback');
        const metadata = audioMetadataRef.current;
        
        // Get all chunks in order
        const orderedChunks: Uint8Array[] = [];
        const totalChunks = metadata.totalChunks;
        
        for (let i = 0; i < totalChunks; i++) {
          const chunk = audioChunksMapRef.current.get(i);
          if (chunk) {
            orderedChunks.push(chunk);
          } else {
            console.warn(`Missing audio chunk at index ${i}`);
          }
        }
        
        if (orderedChunks.length === 0) {
          console.error('No audio chunks to play');
          return;
        }
        
        // Clean up any existing audio URL
        if (audioURL) {
          URL.revokeObjectURL(audioURL);
        }
        
        // Create a blob from all chunks
        const blob = new Blob(orderedChunks, { type: metadata.contentType });
        const url = URL.createObjectURL(blob);
        
        // Update audio state
        setAudioURL(url);
        
        // Play the audio
        if (audioRef.current) {
          console.log('Setting audio source and playing');
          
          // Make sure we stop any current playback
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
          
          // Set new source and play
          audioRef.current.src = url;
          
          const playPromise = audioRef.current.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                console.log('Audio playback started successfully');
                setIsPlaying(true);
              })
              .catch(error => {
                console.error('Audio playback error:', error);
                setIsPlaying(false);
              });
          }
        }
      } catch (error) {
        console.error('Error finalizing audio:', error);
      }
    };
    
    // Function to try playing audio before all chunks are received
    const tryPlayAudio = () => {
      if (!audioMetadataRef.current) return;
      
      try {
        const metadata = audioMetadataRef.current;
        const receivedChunks = [...audioChunksMapRef.current.values()];
        
        if (receivedChunks.length > 0) {
          // Create a blob from available chunks
          const blob = new Blob(receivedChunks, { type: metadata.contentType });
          const url = URL.createObjectURL(blob);
          
          // Update audio state
          setAudioURL(url);
          
          // Play the audio
          if (audioRef.current) {
            audioRef.current.src = url;
            
            const playPromise = audioRef.current.play();
            if (playPromise !== undefined) {
              playPromise
                .then(() => setIsPlaying(true))
                .catch(error => {
                  // Likely not enough data to play yet, this is normal
                  console.log('Not enough audio data to start playing yet');
                });
            }
          }
        }
      } catch (error) {
        console.error('Error trying to play partial audio:', error);
      }
    };
    
    // Add direct transcription handler for improved STT
    socket.on('directTranscribeSuccess', (data) => {
      console.log('Direct transcription received:', data);
      if (data.text) {
        setTranscription(data.text);
      }
    });
    
    // Cleanup - make sure to remove all event listeners
    return () => {
      socket.off('transcription');
      socket.off('translation');
      socket.off('translationStream');
      socket.off('speechStart');
      socket.off('speechChunk');
      socket.off('speechComplete');
      socket.off('directTranscribeSuccess');
      socket.off('error');
      
      // Reset streaming flag
      isStreamingRef.current = false;
      
      // Clean up audio resources
      if (audioURL) {
        URL.revokeObjectURL(audioURL);
      }
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
            
            // Send incremental audio chunks for real-time feedback
            if (socket && socketConnected && isRecording && audioChunksRef.current.length > 0) {
              try {
                // Send the latest audio chunk for partial processing
                // This creates a more responsive experience
                const latestChunk = event.data;
                
                // Only process chunks that are large enough to contain speech
                if (latestChunk.size > 500) {
                  latestChunk.arrayBuffer().then(buffer => {
                    // Emit partial audio for incremental transcription using direct WebSocket method
                    socket.emit('transcribeAudio', buffer);
                  }).catch(error => {
                    console.error('Error converting audio chunk to buffer:', error);
                  });
                }
              } catch (error) {
                console.error('Error sending partial audio chunk:', error);
              }
            }
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
              
              // Use direct transcription via WebSocket
              console.log('Emitting transcribeAudio event to socket:', socket.id);
              socket.emit('transcribeAudio', arrayBuffer, () => {
                clearTimeout(ackTimeout);
                console.log('Server acknowledged receipt of audio for transcription');
              });
              
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
          
          // Reset audio finalization flag
          hasFinalized.current = false;
          
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
            try {
              // Only close if not already closed
              if (audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close().catch(err => {
                  console.error('Error closing AudioContext:', err);
                });
              } else {
                console.log('AudioContext already closed, skipping close()');
              }
              audioContextRef.current = null;
              analyserRef.current = null;
            } catch (err) {
              console.error('Error handling AudioContext cleanup:', err);
            }
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
        try {
          // Only close if not already closed
          if (audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close().catch(err => {
              console.error('Error closing AudioContext on unmount:', err);
            });
          }
        } catch (err) {
          console.error('Error handling AudioContext cleanup on unmount:', err);
        }
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
        try {
          if (audioContext.state !== 'closed') {
            audioContext.close().catch(err => {
              console.error('Error closing AudioContext in silence detection:', err);
            });
          }
        } catch (err) {
          console.error('Error handling AudioContext cleanup in silence detection:', err);
        }
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
      
      <audio 
        ref={audioRef} 
        onEnded={() => {
          console.log('Audio playback ended');
          setIsPlaying(false);
        }} 
        onError={(e) => {
          console.error('Audio error:', e);
          setIsPlaying(false);
        }}
        className="hidden" 
      />
      
      <div className="text-center text-sm text-gray-500">
        {isListening ? 'Listening... (will automatically stop when you stop speaking)' : 'Click Start Recording to begin'}
      </div>
    </div>
  );
} 