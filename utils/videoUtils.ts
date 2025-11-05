
import type { Frame } from '../types';

export const extractFramesFromVideo = (
  videoFile: File,
  startTime: number,
  endTime: number,
  onProgress: (message: string) => void
): Promise<Frame[]> => {
  return new Promise((resolve, reject) => {
    const videoUrl = URL.createObjectURL(videoFile);
    const video = document.createElement('video');
    video.src = videoUrl;
    video.muted = true;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    const frames: Frame[] = [];
    let currentTime = Math.floor(startTime);
    // Ensure at least one frame is processed if start and end are the same
    const totalFrames = Math.max(1, Math.floor(endTime - startTime)); 

    const captureFrame = () => {
      if (!context) {
        reject("Canvas context is not available.");
        return;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      frames.push({ id: currentTime, imageDataUrl });
      onProgress(`Extracted frame ${frames.length} of ${totalFrames}`);

      currentTime++;
      if (currentTime <= endTime) {
        video.currentTime = currentTime;
      } else {
        URL.revokeObjectURL(videoUrl);
        resolve(frames);
      }
    };

    video.addEventListener('loadedmetadata', () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      video.currentTime = currentTime;
    });

    video.addEventListener('seeked', captureFrame);

    video.addEventListener('error', (e) => {
      URL.revokeObjectURL(videoUrl);
      const error = video.error;
      reject(`Error loading video: ${error?.message || 'Unknown error'}`);
    });

    // Handle cases where seeked event doesn't fire (e.g., for very short videos)
    video.load();
  });
};
