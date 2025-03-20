# Universal Translator

A real-time universal translator web application built with Next.js and OpenAI's APIs. This application allows you to speak in one language and have it translated and spoken back in another language, all in real-time.

## Features

- Speech-to-Text using OpenAI's Whisper API
- Text Translation using OpenAI's GPT-4 API
- Text-to-Speech using OpenAI's TTS API
- Real-time audio processing
- Multiple language support
- Modern UI with dark mode support
- Dockerized deployment

## Prerequisites

- Node.js 18+ 
- OpenAI API Key

## Environment Variables

Create a `.env.local` file in the root directory with:

```
OPENAI_API_KEY=your_openai_api_key
```

## Development

1. Install dependencies:

```bash
npm install
```

2. Run the development server:

```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) with your browser.

## Docker Deployment

1. Build the Docker image:

```bash
docker build -t universal-translator .
```

2. Run the container:

```bash
docker run -p 3000:3000 -e OPENAI_API_KEY=your_openai_api_key universal-translator
```

3. Access the application at [http://localhost:3000](http://localhost:3000)

## How to Use

1. Select your source and target languages from the dropdown menus
2. Click "Start Recording" and speak into your microphone
3. After you finish speaking, click "Stop Recording"
4. The application will transcribe your speech, translate it, and play back the translation
5. You can replay the translation by clicking the "Play Translation" button

## License

MIT
