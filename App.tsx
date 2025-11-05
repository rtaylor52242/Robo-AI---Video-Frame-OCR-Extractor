import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { Frame } from './types';
import { extractFramesFromVideo } from './utils/videoUtils';
import { analyzeFramesForText } from './services/geminiService';

// --- Helper Functions ---
const formatTime = (timeInSeconds: number) => {
  const minutes = Math.floor(timeInSeconds / 60);
  const seconds = Math.floor(timeInSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

// --- SVG Icons ---
const UploadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
);

const Spinner = () => (
    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
);

const CloseIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
);

const TrashIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
);


// --- UI Components ---
const FileUploader: React.FC<{ onFileChange: (file: File) => void; disabled: boolean }> = ({ onFileChange, disabled }) => (
    <div className="w-full">
        <label htmlFor="video-upload" className={`flex items-center justify-center w-full px-4 py-6 bg-gray-800 border-2 border-dashed rounded-lg cursor-pointer hover:bg-gray-700 hover:border-gray-500 transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <UploadIcon />
            <span className="text-gray-300">{disabled ? 'Processing...' : 'Click to upload a video'}</span>
        </label>
        <input id="video-upload" type="file" accept="video/*" className="hidden" disabled={disabled} onChange={(e) => e.target.files && onFileChange(e.target.files[0])} />
    </div>
);

const RangeSlider: React.FC<{
    min: number;
    max: number;
    value: number;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    disabled: boolean;
}> = ({ min, max, value, onChange, disabled }) => (
    <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
    />
);

// --- Constants ---
const LOCAL_STORAGE_KEY = 'robo-ai-video-ocr-extractor-excluded-words';
const INITIAL_EXCLUDED_WORDS = [
    'daily', 'get', 'guest', 'host', 'id', 'join', 'list', 'live',
    'month', 'monthly', 'vip', 'weekly', 'x', 'y', 'rank', 'ranked',
    'ream', 'resting', 'roam'
];


// --- Main App Component ---
export default function App() {
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [duration, setDuration] = useState(0);
    const [selection, setSelection] = useState<[number, number]>([0, 0]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [frames, setFrames] = useState<Frame[]>([]);
    const [uniqueWords, setUniqueWords] = useState<string[]>([]);
    const [selectedFrameUrl, setSelectedFrameUrl] = useState<string | null>(null);
    const [newExcludedWord, setNewExcludedWord] = useState('');

    const [excludedWords, setExcludedWords] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
                    return parsed;
                }
            }
        } catch (e) {
            console.error("Could not load excluded words from local storage", e);
        }
        return INITIAL_EXCLUDED_WORDS;
    });

    const videoRef = useRef<HTMLVideoElement>(null);

    const getUniqueWords = (textBlocks: string[], excluded: string[]): string[] => {
        const allText = textBlocks.join(' ');
        const words = allText.match(/\b\w+\b/g) || [];
        const lowercasedWords = words.map(word => word.toLowerCase());
        const excludedSet = new Set(excluded.map(w => w.toLowerCase()));

        const filteredWords = lowercasedWords.filter(word => {
            const isNumeric = /^\d+$/.test(word);
            const isExcluded = excludedSet.has(word);
            return !isNumeric && !isExcluded;
        });
        
        return Array.from(new Set(filteredWords)).sort();
    };

    useEffect(() => {
        // Persist excluded words to local storage whenever they change
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(excludedWords));
        } catch (e) {
            console.error("Could not save excluded words to local storage", e);
        }
    }, [excludedWords]);

    useEffect(() => {
        return () => {
            if (videoUrl) {
                URL.revokeObjectURL(videoUrl);
            }
        };
    }, [videoUrl]);

    const handleFileChange = (file: File) => {
        if (isProcessing) return;
        setVideoFile(file);
        const url = URL.createObjectURL(file);
        setVideoUrl(url);
        setFrames([]);
        setUniqueWords([]);
        setStatusMessage('');
    };
    
    const handleRemoveVideo = () => {
        if (isProcessing) return;
        if (videoUrl) {
            URL.revokeObjectURL(videoUrl);
        }
        setVideoFile(null);
        setVideoUrl(null);
        setDuration(0);
        setSelection([0, 0]);
        setStatusMessage('');
        setFrames([]);
        setUniqueWords([]);
    };

    const handleLoadedMetadata = () => {
        if (videoRef.current) {
            const videoDuration = videoRef.current.duration;
            setDuration(videoDuration);
            setSelection([0, videoDuration]);
        }
    };

    const handleStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newStart = Number(e.target.value);
        if (newStart >= selection[1]) {
            setSelection([newStart, newStart]);
        } else {
            setSelection([newStart, selection[1]]);
        }
    };

    const handleEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newEnd = Number(e.target.value);
        if (newEnd <= selection[0]) {
            setSelection([newEnd, newEnd]);
        } else {
            setSelection([selection[0], newEnd]);
        }
    };

    const handleProcessVideo = useCallback(async () => {
        if (!videoFile) return;

        setIsProcessing(true);
        setFrames([]);
        setUniqueWords([]);
        setStatusMessage('Starting video processing...');

        try {
            const extractedFrames = await extractFramesFromVideo(videoFile, selection[0], selection[1], setStatusMessage);
            setFrames(extractedFrames);
            
            if(extractedFrames.length > 0) {
              const textBlocks = await analyzeFramesForText(extractedFrames, setStatusMessage);
              const words = getUniqueWords(textBlocks, excludedWords);
              setUniqueWords(words);
              setStatusMessage(`Processing complete. Found ${words.length} unique words.`);
            } else {
              setStatusMessage('No frames were extracted from the selection.');
            }
        } catch (error) {
            console.error(error);
            setStatusMessage(`An error occurred: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setIsProcessing(false);
        }
    }, [videoFile, selection, excludedWords]);

    const downloadCsv = () => {
        if (uniqueWords.length === 0) return;
        const csvContent = "data:text/csv;charset=utf-8," + "Extracted Words\n" + uniqueWords.join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "extracted_words.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleAddExcludedWord = () => {
        const wordToAdd = newExcludedWord.trim().toLowerCase();
        if (wordToAdd && !excludedWords.includes(wordToAdd)) {
            setExcludedWords([...excludedWords, wordToAdd].sort());
        }
        setNewExcludedWord('');
    };

    const handleRemoveExcludedWord = (wordToRemove: string) => {
        setExcludedWords(excludedWords.filter(word => word !== wordToRemove));
    };

    const handleWordDoubleClick = (wordToExclude: string) => {
        if (!excludedWords.includes(wordToExclude)) {
            setExcludedWords(prev => [...prev, wordToExclude].sort());
        }
        setUniqueWords(prev => prev.filter(w => w !== wordToExclude));
    };

    return (
        <div className="min-h-screen bg-gray-900 text-gray-200 p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto">
                <header className="text-center mb-8">
                    <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-600">
                        Robo AI - Video Frame OCR Extractor
                    </h1>
                    <p className="mt-2 text-lg text-gray-400">Upload a video, select a time range, and let AI find the words.</p>
                </header>

                <main className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Left Column */}
                    <div className="space-y-6 bg-gray-800/50 p-6 rounded-xl shadow-lg">
                        <h2 className="text-2xl font-bold border-b border-gray-700 pb-2">1. Upload & Select</h2>
                        
                        {!videoUrl ? (
                            <FileUploader onFileChange={handleFileChange} disabled={isProcessing} />
                        ) : (
                            <div className="space-y-4">
                                <div className="relative">
                                    <video ref={videoRef} src={videoUrl} onLoadedMetadata={handleLoadedMetadata} className="w-full rounded-lg" controls />
                                    <button 
                                        onClick={handleRemoveVideo} 
                                        disabled={isProcessing}
                                        className="absolute top-2 right-2 flex items-center px-2 py-1 bg-red-600/80 text-white text-xs font-semibold rounded-md hover:bg-red-600 disabled:bg-red-900 disabled:cursor-not-allowed transition-colors shadow-lg backdrop-blur-sm"
                                        aria-label="Remove video"
                                     >
                                        <TrashIcon /> Remove
                                     </button>
                                </div>
                                {duration > 0 && (
                                    <div className="space-y-4">
                                        <div>
                                            <div className="flex justify-between text-sm font-mono mb-2">
                                                <span>Start: {formatTime(selection[0])} (Frame: {Math.floor(selection[0])})</span>
                                                <span>End: {formatTime(selection[1])} (Frame: {Math.floor(selection[1])})</span>
                                            </div>
                                            <RangeSlider min={0} max={duration} value={selection[0]} onChange={handleStartChange} disabled={isProcessing} />
                                            <RangeSlider min={0} max={duration} value={selection[1]} onChange={handleEndChange} disabled={isProcessing} />
                                        </div>
                                        <button onClick={handleProcessVideo} disabled={isProcessing || !videoFile} className="w-full flex items-center justify-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:bg-indigo-900 disabled:cursor-not-allowed transition-all shadow-md">
                                            {isProcessing ? <><Spinner /> Processing...</> : 'Analyze Video Selection'}
                                        </button>
                                        {statusMessage && <p className="text-center text-sm text-gray-400 h-5">{statusMessage}</p>}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    
                    {/* Right Column */}
                    <div className="space-y-6 bg-gray-800/50 p-6 rounded-xl shadow-lg flex flex-col">
                        <div>
                            <h2 className="text-2xl font-bold border-b border-gray-700 pb-2 mb-4">2. Extracted Frames</h2>
                            <div className="h-48 bg-gray-900/50 rounded-lg p-2 overflow-y-auto flex flex-wrap gap-2 justify-center content-start">
                                {frames.length > 0 ? frames.map(frame => (
                                    <div key={frame.id} className="relative group" onClick={() => setSelectedFrameUrl(frame.imageDataUrl)}>
                                        <img src={frame.imageDataUrl} alt={`Frame at ${frame.id}s`} className="h-20 w-auto object-cover rounded-md cursor-pointer group-hover:scale-105 group-hover:shadow-2xl group-hover:shadow-indigo-500/50 transition-transform" />
                                        <span className="absolute bottom-0 right-0 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded-tl-md rounded-br-md font-mono">
                                            #{frame.id}
                                        </span>
                                    </div>
                                )) : <p className="text-gray-500 self-center">Frames will appear here after processing.</p>}
                            </div>
                        </div>

                        <div>
                           <h2 className="text-2xl font-bold border-b border-gray-700 pb-2 mb-4">3. Exclusion List</h2>
                           <div className="flex gap-2 mb-2">
                               <input
                                   type="text"
                                   value={newExcludedWord}
                                   onChange={(e) => setNewExcludedWord(e.target.value)}
                                   onKeyDown={(e) => e.key === 'Enter' && handleAddExcludedWord()}
                                   placeholder="Add word to exclude..."
                                   className="flex-grow bg-gray-900 border border-gray-700 rounded-md px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                               />
                               <button onClick={handleAddExcludedWord} className="px-4 py-1.5 bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 transition-colors">
                                   Add
                               </button>
                           </div>
                           <div className="min-h-[6rem] max-h-80 bg-gray-900/50 rounded-lg p-2 overflow-auto flex flex-wrap gap-2 content-start resize-y">
                               {excludedWords.length > 0 ? excludedWords.map(word => (
                                   <span key={word} className="flex items-center px-2 py-0.5 bg-red-900/70 text-red-200 rounded-full text-sm font-medium">
                                       {word}
                                       <button onClick={() => handleRemoveExcludedWord(word)} className="ml-1.5 text-red-300 hover:text-white rounded-full hover:bg-red-500/50 p-0.5">
                                            <CloseIcon />
                                       </button>
                                   </span>
                               )) : <p className="text-gray-500 text-sm flex items-center justify-center w-full h-full">No custom words to exclude.</p>}
                           </div>
                        </div>

                        <div className="flex-grow flex flex-col">
                            <div className="flex justify-between items-center border-b border-gray-700 pb-2 mb-4">
                                <h2 className="text-2xl font-bold">4. Unique Words</h2>
                                <button onClick={downloadCsv} disabled={uniqueWords.length === 0} className="px-3 py-1 text-sm bg-green-600 text-white font-semibold rounded-md hover:bg-green-700 disabled:bg-green-900 disabled:cursor-not-allowed transition-colors">
                                    Download CSV
                                </button>
                            </div>
                            <div className="flex-grow bg-gray-900/50 rounded-lg p-4 overflow-y-auto flex flex-wrap gap-2 content-start">
                                {uniqueWords.length > 0 ? uniqueWords.map(word => (
                                    <span 
                                        key={word} 
                                        onDoubleClick={() => handleWordDoubleClick(word)}
                                        className="px-3 py-1 bg-gray-700 text-gray-200 rounded-full text-sm font-medium cursor-pointer hover:bg-gray-600 transition-colors"
                                        title="Double-click to exclude"
                                    >
                                        {word}
                                    </span>
                                )) : <p className="text-gray-500 self-center">Unique words from OCR will be listed here.</p>}
                            </div>
                        </div>
                    </div>
                </main>
            </div>

            {/* Modal for viewing frames */}
            {selectedFrameUrl && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setSelectedFrameUrl(null)}>
                    <img src={selectedFrameUrl} alt="Selected Frame" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
}